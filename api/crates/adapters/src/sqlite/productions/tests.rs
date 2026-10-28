//! The production store against an in-memory, migrated database.

use super::*;
use crate::sqlite::test_pool;

async fn exec(pool: &SqlitePool, sql: &'static str) {
    sqlx::query(sql).execute(pool).await.unwrap();
}

#[tokio::test]
async fn a_story_short_is_linked_once_and_found_back_until_it_is_deleted() {
    let (store, pool) = store_with_user().await;
    exec(
        &pool,
        "INSERT INTO shorts (id, user_id, prompt, aspect, target_s, status, created_at) VALUES \
         ('x1', 'u1', 'p', '4:5', 60, 'planning', 't'), ('x2', 'u1', 'p', '4:5', 60, 'planning', 't')",
    )
    .await;
    let p = production("p1", "t");
    store.create(&p).await.unwrap();
    let (x1, x2) = (ShortId::parse("x1").unwrap(), ShortId::parse("x2").unwrap());

    assert!(store.set_cut(&p.id, &x1).await.unwrap());
    assert!(
        !store.set_cut(&p.id, &x2).await.unwrap(),
        "the first link stays"
    );

    let got = store.by_short(&x1).await.unwrap().unwrap();
    assert_eq!(got.status, ProductionStatus::Cutting);
    assert_eq!(got.short_id, Some(x1.clone()));
    assert_eq!(store.by_short(&x2).await.unwrap(), None);

    exec(&pool, "DELETE FROM shorts WHERE id = 'x1'").await;
    assert_eq!(store.by_short(&x1).await.unwrap(), None);
    assert!(
        store.set_cut(&p.id, &x2).await.unwrap(),
        "a deleted short frees the link"
    );
}

fn production(id: &str, created_at: &str) -> Production {
    Production {
        id: ProductionId::parse(id).unwrap(),
        user_id: UserId::parse("u1").unwrap(),
        title: "Beach day".into(),
        brief: "A morning at the beach".into(),
        format: Format::Story,
        aspect: Aspect::Portrait,
        target_s: 60.0,
        blur_bystanders: true,
        status: ProductionStatus::Planning,
        short_id: None,
        coverage_checked_at: None,
        error: None,
        created_at: created_at.into(),
        art_key: None,
    }
}

fn shot(id: &str, ord: u32, act: Act) -> Shot {
    Shot {
        id: ShotId::parse(id).unwrap(),
        ord,
        act,
        title: format!("Shot {ord}"),
        direction: "Eye level".into(),
        tips: vec!["Hold still".into(), "Face the light".into()],
        query: "waves on the shore".into(),
        duration_s: 6.5,
        board_key: None,
        matched_segment_id: None,
        match_reason: None,
        take_count: 0,
        footage_board_key: None,
        footage_board_segment: None,
    }
}

async fn store_with_user() -> (SqliteProductionStore, SqlitePool) {
    let pool = test_pool().await;
    exec(
        &pool,
        "INSERT INTO users (id, created_at) VALUES ('u1', 't')",
    )
    .await;
    (SqliteProductionStore::new(pool.clone()), pool)
}

#[tokio::test]
async fn a_production_and_its_plan_round_trip_and_a_second_plan_is_ignored() {
    let (store, _pool) = store_with_user().await;
    let p = production("p1", "2026-10-27T10:00:00.000Z");
    store.create(&p).await.unwrap();
    store
        .create(&production("p2", "2026-10-27T11:00:00.000Z"))
        .await
        .unwrap();
    let shots = [shot("s1", 1, Act::Hook), shot("s2", 2, Act::Outro)];

    assert!(
        store
            .save_plan(&p.id, "Waves at dawn", &shots)
            .await
            .unwrap()
    );
    assert!(
        !store
            .save_plan(&p.id, "Other", &[shot("s9", 1, Act::Story)])
            .await
            .unwrap(),
        "stored shots are kept"
    );

    let got = store.get(&p.id).await.unwrap().unwrap();
    assert_eq!(got.title, "Waves at dawn");
    assert_eq!(got.format, Format::Story);
    assert!(got.blur_bystanders);
    assert_eq!(store.shots(&p.id).await.unwrap(), shots);
    let order: Vec<String> = store
        .list(&p.user_id)
        .await
        .unwrap()
        .into_iter()
        .map(|p| p.id.to_string())
        .collect();
    assert_eq!(order, ["p2", "p1"], "newest first");
}

fn verdict(shot: &Shot, segment: Option<&str>, take_count: u32) -> CoverageMatch {
    CoverageMatch {
        shot_id: shot.id.clone(),
        segment_id: segment.map(|s| SegmentId::parse(s).unwrap()),
        reason: segment.map(|_| "waves".to_owned()),
        take_count,
    }
}

#[tokio::test]
async fn boards_and_coverage_are_recorded() {
    let (store, pool) = store_with_user().await;
    exec(&pool, "INSERT INTO clips (id, user_id, filename, ext, size_bytes, status, created_at) VALUES ('c1', 'u1', 'a.mp4', 'mp4', 1, 'ready', 't')").await;
    exec(
        &pool,
        "INSERT INTO segments (id, clip_id, idx, start_s, end_s) VALUES ('g1', 'c1', 0, 0, 5)",
    )
    .await;
    let p = production("p1", "t");
    store.create(&p).await.unwrap();
    let shots = [shot("s1", 1, Act::Hook), shot("s2", 2, Act::Outro)];
    store.save_plan(&p.id, "T", &shots).await.unwrap();
    let key = ObjectKey::from_stored("users/u1/productions/p1/boards/s1.webp".into());

    store.set_board(&shots[0].id, &key).await.unwrap();
    let matches = [
        verdict(&shots[0], Some("g1"), 2),
        verdict(&shots[1], None, 0),
    ];
    store
        .set_coverage(&p.id, &matches, "2026-10-27T10:00:00.000Z")
        .await
        .unwrap();

    let got = store.shots(&p.id).await.unwrap();
    assert_eq!(got[0].board_key, Some(key));
    assert_eq!(
        got[0].matched_segment_id.as_ref().map(SegmentId::as_str),
        Some("g1")
    );
    assert_eq!(
        (got[0].take_count, got[0].match_reason.as_deref()),
        (2, Some("waves"))
    );
    assert_eq!(got[1].matched_segment_id, None);
    let p2 = store.get(&p.id).await.unwrap().unwrap();
    assert_eq!(
        p2.coverage_checked_at.as_deref(),
        Some("2026-10-27T10:00:00.000Z")
    );
}

#[tokio::test]
async fn status_notes_are_set_and_a_delete_takes_the_shots() {
    let (store, _pool) = store_with_user().await;
    let p = production("p1", "t");
    store.create(&p).await.unwrap();
    store
        .save_plan(&p.id, "T", &[shot("s1", 1, Act::Hook)])
        .await
        .unwrap();

    store
        .set_status(&p.id, ProductionStatus::Shooting, Some("1 frame failed"))
        .await
        .unwrap();
    let p2 = store.get(&p.id).await.unwrap().unwrap();
    assert_eq!(p2.status, ProductionStatus::Shooting);
    assert_eq!(p2.error.as_deref(), Some("1 frame failed"));

    store.delete(&p.id).await.unwrap();
    assert_eq!(store.get(&p.id).await.unwrap(), None);
    assert!(
        store.shots(&p.id).await.unwrap().is_empty(),
        "shots cascade"
    );
}

#[tokio::test]
async fn only_planning_productions_fail_at_start() {
    let (store, _pool) = store_with_user().await;
    store.create(&production("p1", "t")).await.unwrap();
    let mut shooting = production("p2", "t");
    shooting.status = ProductionStatus::Shooting;
    store.create(&shooting).await.unwrap();

    assert_eq!(store.fail_planning("restarted").await.unwrap(), 1);

    let p1 = store
        .get(&ProductionId::parse("p1").unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (p1.status, p1.error.as_deref()),
        (ProductionStatus::Failed, Some("restarted"))
    );
    let p2 = store.get(&shooting.id).await.unwrap().unwrap();
    assert_eq!(p2.status, ProductionStatus::Shooting);
}

#[tokio::test]
async fn the_library_summary_counts_ready_clips_only() {
    let (store, pool) = store_with_user().await;
    exec(&pool, "INSERT INTO clips (id, user_id, filename, ext, size_bytes, duration_s, status, created_at) VALUES \
        ('c1', 'u1', 'a.mp4', 'mp4', 1, 120, 'ready', 't'), \
        ('c2', 'u1', 'b.mp4', 'mp4', 1, 60, 'duplicate', 't')").await;
    exec(
        &pool,
        "INSERT INTO segments (id, clip_id, idx, start_s, end_s, place, actions) VALUES \
        ('g1', 'c1', 0, 0, 5, 'Beach', '[\"walking\",\"Swimming\"]'), \
        ('g2', 'c1', 1, 5, 9, 'beach ', '[\"walking\"]'), \
        ('g3', 'c1', 2, 9, 12, 'cafe', '[]'), \
        ('g4', 'c2', 0, 0, 5, 'airport', '[\"flying\"]')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO people (id, user_id, name) VALUES ('pa', 'u1', 'Ana'), ('pb', 'u1', 'Ben')",
    )
    .await;
    exec(&pool, "INSERT INTO face_tracks (id, clip_id, ordinal, first_s, last_s, max_area, person_id) VALUES \
        ('t1', 'c1', 0, 0, 1, 0.1, 'pb'), ('t2', 'c1', 1, 0, 1, 0.1, 'pb')").await;
    exec(
        &pool,
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) VALUES \
        ('j1', 'ingest', 'c1', 'done', 't', '2026-10-27T09:00:00.000Z'), \
        ('j2', 'ingest', 'c2', 'done', 't', '2026-10-27T12:00:00.000Z')",
    )
    .await;
    let user = UserId::parse("u1").unwrap();

    let s = store.library_summary(&user).await.unwrap();

    assert_eq!((s.clips, s.minutes), (1, 2.0));
    assert_eq!(s.places, ["Beach", "cafe"]);
    assert_eq!(s.people, ["Ben", "Ana"], "most seen first");
    assert_eq!(s.actions, ["walking", "swimming"]);
    assert_eq!(
        store.last_ready_at(&user).await.unwrap().as_deref(),
        Some("2026-10-27T09:00:00.000Z"),
        "the duplicate's job does not count"
    );
    let nobody = UserId::parse("u2").unwrap();
    assert_eq!(store.last_ready_at(&nobody).await.unwrap(), None);
}

#[tokio::test]
async fn key_art_and_footage_boards_are_stored_and_the_auto_art_runs_once() {
    let (store, pool) = store_with_user().await;
    exec(
        &pool,
        "INSERT INTO clips (id, user_id, filename, ext, size_bytes, status, created_at) \
         VALUES ('c1', 'u1', 'a.mp4', 'mp4', 10, 'ready', 't')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO segments (id, clip_id, idx, start_s, end_s) VALUES ('c1-s0', 'c1', 0, 0, 7)",
    )
    .await;
    let p = production("p1", "t");
    store.create(&p).await.unwrap();
    let s = shot("sh1", 1, Act::Hook);
    store
        .save_plan(&p.id, "Beach", std::slice::from_ref(&s))
        .await
        .unwrap();
    let art = ObjectKey::from_stored("users/u1/productions/p1/art.webp".into());
    let board = ObjectKey::from_stored("users/u1/productions/p1/boards/sh1_footage.webp".into());
    let seg = SegmentId::parse("c1-s0").unwrap();

    store.set_art(&p.id, &art).await.unwrap();
    store.set_footage_board(&s.id, &board, &seg).await.unwrap();

    assert_eq!(store.get(&p.id).await.unwrap().unwrap().art_key, Some(art));
    let listed = store.list(&p.user_id).await.unwrap();
    assert!(listed[0].art_key.is_some(), "the list reads the art too");
    let got = &store.shots(&p.id).await.unwrap()[0];
    assert_eq!(got.footage_board_key, Some(board));
    assert_eq!(got.footage_board_segment, Some(seg));
    assert!(store.claim_auto_art(&p.id).await.unwrap());
    assert!(!store.claim_auto_art(&p.id).await.unwrap(), "only once");
}

#[tokio::test]
async fn a_title_is_set_and_others_are_left_alone() {
    let (store, _pool) = store_with_user().await;
    let (p1, p2) = (production("p1", "t1"), production("p2", "t2"));
    store.create(&p1).await.unwrap();
    store.create(&p2).await.unwrap();

    store.set_title(&p1.id, "Night walk").await.unwrap();

    assert_eq!(
        store.get(&p1.id).await.unwrap().unwrap().title,
        "Night walk"
    );
    assert_eq!(store.get(&p2.id).await.unwrap().unwrap().title, p2.title);
}
