//! Projects against an in-memory database: totals, order, idempotent adds and cascades.

use nimbytes_core::ports::Catalogue;

use super::*;
use crate::sqlite::{SqliteCatalogue, test_pool};

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_owned()))
        .execute(pool)
        .await
        .unwrap();
}

/// User u1 with clips c1 (10 s, 100 B, 2 turns, 1 shown + 1 hidden face) and c2 (no probe, 50 B).
async fn seed(pool: &SqlitePool) {
    exec(
        pool,
        "INSERT INTO users (id, created_at) VALUES ('u1', 't')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO clips (id, user_id, filename, ext, size_bytes, duration_s, status, created_at) \
         VALUES ('c1', 'u1', 'a.mp4', 'mp4', 100, 10.0, 'ready', '2026-10-27T01:00:00.000Z'), \
                ('c2', 'u1', 'b.mp4', 'mp4', 50, NULL, 'ready', '2026-10-27T02:00:00.000Z')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO transcript_turns (id, clip_id, turn_no, start_s, end_s, text) \
         VALUES ('t1', 'c1', 0, 0, 1, 'hi'), ('t2', 'c1', 1, 1, 2, 'yo')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO face_tracks (id, clip_id, ordinal, first_s, last_s, max_area, hidden) \
         VALUES ('f1', 'c1', 0, 0, 1, 0.1, 0), ('f2', 'c1', 1, 0, 1, 0.1, 1)",
    )
    .await;
}

fn project(id: &str, name: &str, at: &str) -> Project {
    Project {
        id: ProjectId::parse(id).unwrap(),
        user_id: UserId::parse("u1").unwrap(),
        name: name.into(),
        color: ProjectColor::Blue,
        created_at: at.into(),
        updated_at: at.into(),
    }
}

fn clip(id: &str) -> ClipId {
    ClipId::parse(id).unwrap()
}

#[tokio::test]
async fn projects_list_newest_first_with_totals_over_their_clips() {
    let pool = test_pool().await;
    seed(&pool).await;
    let store = SqliteProjectStore::new(pool);
    let old = project("p1", "Trip", "2026-10-27T03:00:00.000Z");
    let new = project("p2", "Empty", "2026-10-27T04:00:00.000Z");
    store.create(&old, &[clip("c1"), clip("c2")]).await.unwrap();
    store.create(&new, &[]).await.unwrap();

    let list = store.list(&UserId::parse("u1").unwrap()).await.unwrap();

    let names: Vec<&str> = list.iter().map(|s| s.project.name.as_str()).collect();
    assert_eq!(names, ["Empty", "Trip"]);
    let trip = &list[1];
    assert_eq!(
        (trip.clip_count, trip.duration_s, trip.size_bytes),
        (2, 10.0, 150)
    );
    assert_eq!(
        (list[0].clip_count, list[0].duration_s, list[0].size_bytes),
        (0, 0.0, 0)
    );
}

#[tokio::test]
async fn adding_twice_keeps_one_link_and_removing_a_clip_or_project_keeps_the_clip() {
    let pool = test_pool().await;
    seed(&pool).await;
    let store = SqliteProjectStore::new(pool.clone());
    let p = project("p1", "Trip", "2026-10-27T03:00:00.000Z");
    store.create(&p, &[clip("c1")]).await.unwrap();

    store
        .add_clips(&p.id, &[clip("c1"), clip("c2")], "later")
        .await
        .unwrap();
    assert_eq!(store.summary(&p.id).await.unwrap().unwrap().clip_count, 2);

    store.remove_clip(&p.id, &clip("c2")).await.unwrap();
    store.remove_clip(&p.id, &clip("c2")).await.unwrap();
    assert_eq!(store.summary(&p.id).await.unwrap().unwrap().clip_count, 1);

    store.delete(&p.id).await.unwrap();
    assert_eq!(store.get(&p.id).await.unwrap(), None);
    let catalogue = SqliteCatalogue::new(pool);
    assert!(catalogue.get_clip(&clip("c1")).await.unwrap().is_some());
}

#[tokio::test]
async fn library_rows_carry_projects_speech_and_visible_faces_and_a_deleted_clip_leaves_projects() {
    let pool = test_pool().await;
    seed(&pool).await;
    let store = SqliteProjectStore::new(pool.clone());
    let a = project("pa", "A", "2026-10-27T03:00:00.000Z");
    let b = project("pb", "B", "2026-10-27T04:00:00.000Z");
    store.create(&b, &[clip("c1")]).await.unwrap();
    store.create(&a, &[clip("c1")]).await.unwrap();
    let catalogue = SqliteCatalogue::new(pool);

    let rows = catalogue
        .library(&UserId::parse("u1").unwrap())
        .await
        .unwrap();

    let c1 = rows.iter().find(|r| r.clip.id == clip("c1")).unwrap();
    let ids: Vec<&str> = c1.project_ids.iter().map(ProjectId::as_str).collect();
    assert_eq!(ids, ["pa", "pb"]);
    assert_eq!((c1.speech_count, c1.face_count), (2, 1));
    let c2 = rows.iter().find(|r| r.clip.id == clip("c2")).unwrap();
    assert!(c2.project_ids.is_empty());
    assert_eq!((c2.speech_count, c2.face_count), (0, 0));

    catalogue.delete_clip(&clip("c1")).await.unwrap();
    assert_eq!(store.summary(&a.id).await.unwrap().unwrap().clip_count, 0);
}

#[tokio::test]
async fn names_are_unique_per_user_ignoring_ascii_case_in_the_database_too() {
    let pool = test_pool().await;
    seed(&pool).await;
    let store = SqliteProjectStore::new(pool);
    store
        .create(&project("p1", "Trip", "t1"), &[])
        .await
        .unwrap();

    let dup = store.create(&project("p2", "TRIP", "t2"), &[]).await;

    assert!(dup.is_err());
}

#[tokio::test]
async fn key_art_and_its_sources_are_stored_and_the_auto_art_runs_once() {
    use nimbytes_core::domain::ids::SegmentId;
    use nimbytes_core::domain::project::ArtSource;
    let pool = test_pool().await;
    seed(&pool).await;
    let store = SqliteProjectStore::new(pool);
    let p = project("p1", "Tokyo", "t");
    store.create(&p, &[clip("c1")]).await.unwrap();
    let before = store.summary(&p.id).await.unwrap().unwrap();
    assert_eq!(before.art, ProjectArt::default());

    let key = ObjectKey::from_stored("users/u1/projects/p1/art.webp".into());
    let sources = vec![ArtSource {
        clip_id: clip("c1"),
        segment_id: SegmentId::parse("c1-s0").unwrap(),
        clip_title: "Dog nap".into(),
        title: "A dog naps in the sun".into(),
        start_s: 3.5,
    }];
    store.set_art(&p.id, &key, &sources).await.unwrap();

    let got = store.list(&p.user_id).await.unwrap().remove(0).art;
    assert_eq!(
        got,
        ProjectArt {
            key: Some(key),
            sources
        }
    );
    assert!(store.claim_auto_art(&p.id).await.unwrap());
    assert!(!store.claim_auto_art(&p.id).await.unwrap(), "only once");
}

/// A file listen l1 (5 s, 1000 B), a clip listen l2 (3 s, no file), document d1 (200 B) and photo
/// f1 (300 B), all of u1.
async fn seed_items(pool: &SqlitePool) {
    exec(
        pool,
        "INSERT INTO listens (id, user_id, source, clip_id, source_name, ext, size_bytes, status, \
         target, duration_ms, created_at, updated_at) VALUES \
         ('l1', 'u1', 'file', NULL, 'a.mp3', 'mp3', 1000, 'ready', 'en', 5000, 't', 't'), \
         ('l2', 'u1', 'clip', 'c1', 'a.mp4', '', 0, 'ready', 'en', 3000, 't', 't')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO documents (id, user_id, filename, content_type, size_bytes, status, \
         created_at, updated_at) VALUES ('d1', 'u1', 'a.pdf', 'application/pdf', 200, 'ready', \
         't', 't')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO photos (id, user_id, filename, content_type, size_bytes, status, created_at, \
         updated_at) VALUES ('f1', 'u1', 'a.jpg', 'image/jpeg', 300, 'ready', 't', 't')",
    )
    .await;
}

fn items() -> Vec<ItemRef> {
    [
        ("listen", "l1"),
        ("listen", "l2"),
        ("document", "d1"),
        ("photo", "f1"),
    ]
    .into_iter()
    .map(|(k, id)| ItemRef::parse(k, id).unwrap())
    .collect()
}

#[tokio::test]
async fn items_count_per_kind_and_add_to_size_and_listen_duration() {
    let pool = test_pool().await;
    seed(&pool).await;
    seed_items(&pool).await;
    let store = SqliteProjectStore::new(pool);
    let p1 = project("p1", "Trip", "2026-10-27T03:00:00.000Z");
    store.create(&p1, &[clip("c1")]).await.unwrap();

    store.add_items(&p1.id, &items(), "t1").await.unwrap();
    store.add_items(&p1.id, &items()[..1], "t2").await.unwrap();

    let s = store.summary(&p1.id).await.unwrap().unwrap();
    assert_eq!(
        (
            s.clip_count,
            s.listen_count,
            s.document_count,
            s.photo_count
        ),
        (1, 2, 1, 1)
    );
    assert_eq!(
        s.size_bytes,
        100 + 1000 + 200 + 300,
        "a clip listen has no file"
    );
    assert!(
        (s.duration_s - 18.0).abs() < 1e-9,
        "10 s clip + 5 s + 3 s listens"
    );
}

/// Projects p1 and p2 of u1 and p3 of u2: p1 holds every item, p2 the document and the photo,
/// p3 the photo.
async fn linked(pool: &SqlitePool) -> SqliteProjectStore {
    seed(pool).await;
    seed_items(pool).await;
    exec(
        pool,
        "INSERT INTO users (id, created_at) VALUES ('u2', 't')",
    )
    .await;
    let store = SqliteProjectStore::new(pool.clone());
    let mut theirs = project("p3", "Theirs", "2026-10-27T05:00:00.000Z");
    theirs.user_id = UserId::parse("u2").unwrap();
    let all = [
        project("p1", "Trip", "2026-10-27T03:00:00.000Z"),
        project("p2", "Home", "2026-10-27T04:00:00.000Z"),
        theirs,
    ];
    for (p, from) in all.iter().zip([0, 2, 3]) {
        store.create(p, &[]).await.unwrap();
        store.add_items(&p.id, &items()[from..], "t").await.unwrap();
    }
    store
}

#[tokio::test]
async fn item_links_are_the_owners_and_go_with_the_item_or_a_removal() {
    let pool = test_pool().await;
    let store = linked(&pool).await;
    let u1 = UserId::parse("u1").unwrap();

    let mut links = store.item_links(&u1).await.unwrap();
    links.sort();
    let shown: Vec<(&str, &str, &str)> = links
        .iter()
        .map(|(i, p)| (i.kind().as_str(), i.id_str(), p.as_str()))
        .collect();
    assert_eq!(
        shown,
        [
            ("listen", "l1", "p1"),
            ("listen", "l2", "p1"),
            ("document", "d1", "p1"),
            ("document", "d1", "p2"),
            ("photo", "f1", "p1"),
            ("photo", "f1", "p2"),
        ]
    );

    let p1 = ProjectId::parse("p1").unwrap();
    store.remove_item(&p1, &items()[0]).await.unwrap();
    exec(&pool, "DELETE FROM documents WHERE id = 'd1'").await;
    let left = store.item_links(&u1).await.unwrap();
    assert_eq!(left.len(), 3, "l2 in p1, f1 in p1 and p2: {left:?}");
    assert!(left.iter().all(|(i, _)| i.kind() != ItemKind::Document));
}
