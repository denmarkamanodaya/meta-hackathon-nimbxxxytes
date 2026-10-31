//! The switch, vectors, proposals, verdicts and links on SQLite, and the cleanups other writes
//! make (hide, duplicate, delete, re-ingest).

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::face_match::FaceKind;
use nimbytes_core::domain::segment::TrackRow;
use nimbytes_core::ports::{Catalogue, PeopleStore, TrackUpdate};

use super::*;
use crate::sqlite::SqliteCatalogue;
use crate::sqlite::catalogue::views_tests::{add_clip, fixture};

fn t(id: &str) -> TrackId {
    TrackId::parse(id).unwrap()
}

fn row(clip: &str, n: u32) -> TrackRow {
    TrackRow {
        id: t(&format!("{clip}-f{n}")),
        ordinal: n,
        first_s: 1.0,
        last_s: 2.0,
        crop_key: format!("users/u1/faces/{clip}/{clip}-f{n}.jpg"),
        max_area: 0.1,
    }
}

/// A unit vector at angle `deg` in the plane of the first two axes.
fn at(deg: f32) -> Vec<f32> {
    let mut v = vec![0.0f32; 1024];
    let r = deg.to_radians();
    (v[0], v[1]) = (r.cos(), r.sin());
    v
}

fn same(confidence: f64) -> FaceVerdict {
    FaceVerdict {
        same: true,
        confidence,
        kind: FaceKind::Pet,
    }
}

/// u1 with matching on; clip c1 holds tracks c1-f0..f2, clip c2 holds c2-f0.
async fn world() -> (SqliteCatalogue, SqliteFaceStore, UserId) {
    let (cat, pool, user, c1) = fixture().await;
    let c2 = ClipId::parse("c2").unwrap();
    add_clip(&cat, &user, (&c2, "2026-10-27T02:00:00.000Z")).await;
    cat.replace_face_tracks(&c1, &[row("c1", 0), row("c1", 1), row("c1", 2)], &[])
        .await
        .unwrap();
    cat.replace_face_tracks(&c2, &[row("c2", 0)], &[])
        .await
        .unwrap();
    let store = SqliteFaceStore::new(pool);
    store.set_matching(&user, true).await.unwrap();
    (cat, store, user)
}

async fn embedded(store: &SqliteFaceStore, user: &UserId) -> Vec<String> {
    let mut ids: Vec<String> =
        sqlx::query_scalar("SELECT track_id FROM face_vectors WHERE user_id = ?")
            .bind(user.as_str())
            .fetch_all(&store.pool)
            .await
            .unwrap();
    ids.sort();
    ids
}

async fn verdict_count(store: &SqliteFaceStore) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM face_matches")
        .fetch_one(&store.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn turning_off_deletes_the_users_vectors_and_verdicts_and_drops_later_writes() {
    let (_, store, user) = world().await;
    store
        .put_vector(&t("c1-f0"), &user, &at(0.0))
        .await
        .unwrap();
    store
        .put_vector(&t("c1-f1"), &user, &at(10.0))
        .await
        .unwrap();
    store
        .put_verdict(&user, (&t("c1-f1"), &t("c1-f0")), &same(0.9))
        .await
        .unwrap();
    assert!(store.matching(&user).await.unwrap());

    store.set_matching(&user, false).await.unwrap();
    store
        .put_vector(&t("c1-f2"), &user, &at(0.0))
        .await
        .unwrap();
    store
        .put_verdict(&user, (&t("c1-f0"), &t("c1-f2")), &same(0.9))
        .await
        .unwrap();

    assert!(!store.matching(&user).await.unwrap());
    assert!(embedded(&store, &user).await.is_empty());
    assert_eq!(verdict_count(&store).await, 0);
    let stranger = UserId::parse("u9").unwrap();
    assert!(
        !store.matching(&stranger).await.unwrap(),
        "unknown users are off"
    );
}

#[tokio::test]
async fn faces_to_embed_leave_out_hidden_duplicate_and_already_embedded_tracks() {
    let (cat, store, user) = world().await;
    store
        .put_vector(&t("c1-f0"), &user, &at(0.0))
        .await
        .unwrap();
    let hide = TrackUpdate {
        person: None,
        hidden: Some(true),
    };
    cat.update_track(&t("c1-f1"), &hide).await.unwrap();
    cat.mark_duplicate(&ClipId::parse("c2").unwrap(), &ClipId::parse("c1").unwrap())
        .await
        .unwrap();

    let todo: Vec<String> = store
        .unembedded(&user)
        .await
        .unwrap()
        .into_iter()
        .map(|f| f.track.to_string())
        .collect();

    assert_eq!(todo, ["c1-f2"]);
}

#[tokio::test]
async fn proposals_are_unjudged_pairs_at_or_above_the_similarity_most_similar_first() {
    let (_, store, user) = world().await;
    for (id, deg) in [
        ("c1-f0", 0.0),
        ("c1-f1", 30.0),
        ("c1-f2", 80.0),
        ("c2-f0", 5.0),
    ] {
        store.put_vector(&t(id), &user, &at(deg)).await.unwrap();
    }
    // cos 5° ≈ 0.996, cos 25° ≈ 0.906, cos 30° ≈ 0.866; cos 50° ≈ 0.643 and wider stay out.
    let all = store.proposals(&user, 0.85, 8).await.unwrap();
    store
        .put_verdict(&user, (&t("c2-f0"), &t("c1-f0")), &same(0.9))
        .await
        .unwrap();
    let open = store.proposals(&user, 0.85, 8).await.unwrap();

    let ids = |p: &[FacePair]| -> Vec<(String, String)> {
        p.iter()
            .map(|x| (x.a.0.to_string(), x.b.0.to_string()))
            .collect()
    };
    let pair = |a: &str, b: &str| (a.to_owned(), b.to_owned());
    assert_eq!(
        ids(&all),
        [
            pair("c1-f0", "c2-f0"),
            pair("c1-f1", "c2-f0"),
            pair("c1-f0", "c1-f1")
        ]
    );
    assert_eq!(all[0].a.1, "users/u1/faces/c1/c1-f0.jpg");
    assert_eq!(
        ids(&open),
        [pair("c1-f1", "c2-f0"), pair("c1-f0", "c1-f1")],
        "judged pairs are not proposed again"
    );
}

#[tokio::test]
async fn links_are_confident_same_verdicts_between_visible_tracks_outside_duplicates() {
    let (cat, store, user) = world().await;
    let no = FaceVerdict {
        same: false,
        confidence: 0.99,
        kind: FaceKind::Person,
    };
    for (a, b, v) in [
        ("c1-f0", "c1-f1", same(0.9)),
        ("c1-f0", "c1-f2", same(0.69)),
        ("c1-f1", "c1-f2", no),
        ("c1-f1", "c2-f0", same(0.95)),
    ] {
        store.put_verdict(&user, (&t(a), &t(b)), &v).await.unwrap();
    }

    let before = store.links(&user, 0.7).await.unwrap();
    cat.mark_duplicate(&ClipId::parse("c2").unwrap(), &ClipId::parse("c1").unwrap())
        .await
        .unwrap();
    // A job that was already running writes the copy's verdict back after the marking.
    store
        .put_verdict(&user, (&t("c1-f1"), &t("c2-f0")), &same(0.95))
        .await
        .unwrap();
    let after = store.links(&user, 0.7).await.unwrap();

    let ids = |l: &[FaceLink]| -> Vec<(String, String)> {
        l.iter()
            .map(|x| (x.a.to_string(), x.b.to_string()))
            .collect()
    };
    let pair = |a: &str, b: &str| (a.to_owned(), b.to_owned());
    assert_eq!(
        ids(&before),
        [pair("c1-f0", "c1-f1"), pair("c1-f1", "c2-f0")]
    );
    assert_eq!(ids(&after), [pair("c1-f0", "c1-f1")]);
}

#[tokio::test]
async fn hiding_a_track_deletes_its_vector_and_verdicts_in_the_same_change() {
    let (cat, store, user) = world().await;
    store
        .put_vector(&t("c1-f0"), &user, &at(0.0))
        .await
        .unwrap();
    store
        .put_vector(&t("c1-f1"), &user, &at(1.0))
        .await
        .unwrap();
    store
        .put_verdict(&user, (&t("c1-f0"), &t("c1-f1")), &same(0.9))
        .await
        .unwrap();

    let name_only = TrackUpdate {
        person: None,
        hidden: Some(false),
    };
    cat.update_track(&t("c1-f0"), &name_only).await.unwrap();
    let kept = (
        embedded(&store, &user).await.len(),
        verdict_count(&store).await,
    );
    let hide = TrackUpdate {
        person: None,
        hidden: Some(true),
    };
    cat.update_track(&t("c1-f0"), &hide).await.unwrap();

    assert_eq!(kept, (2, 1), "only hiding forgets the face");
    assert_eq!(embedded(&store, &user).await, ["c1-f1"]);
    assert_eq!(verdict_count(&store).await, 0);
}

#[tokio::test]
async fn deleting_marking_or_reingesting_a_clip_forgets_its_faces() {
    let (cat, store, user) = world().await;
    for id in ["c1-f0", "c2-f0"] {
        store.put_vector(&t(id), &user, &at(0.0)).await.unwrap();
    }
    store
        .put_verdict(&user, (&t("c1-f0"), &t("c2-f0")), &same(0.9))
        .await
        .unwrap();
    let c1 = ClipId::parse("c1").unwrap();

    cat.replace_face_tracks(&c1, &[row("c1", 0)], &[])
        .await
        .unwrap();
    let after_reingest = (embedded(&store, &user).await, verdict_count(&store).await);
    store
        .put_vector(&t("c1-f0"), &user, &at(0.0))
        .await
        .unwrap();
    cat.set_clip_status(&c1, ClipStatus::Ready, None)
        .await
        .unwrap();
    cat.delete_clip(&c1).await.unwrap();

    assert_eq!(after_reingest, (vec!["c2-f0".to_owned()], 0));
    assert_eq!(embedded(&store, &user).await, ["c2-f0"]);
}

#[tokio::test]
async fn named_tracks_are_the_visible_named_ones_of_the_user() {
    let (cat, store, user) = world().await;
    let ana = cat
        .upsert_person(&user, &PersonId::parse("p-ana").unwrap(), "Ana")
        .await
        .unwrap();
    for (id, hidden) in [("c1-f0", None), ("c1-f1", Some(true))] {
        let u = TrackUpdate {
            person: Some(ana.clone()),
            hidden,
        };
        cat.update_track(&t(id), &u).await.unwrap();
    }

    let named = store.named_tracks(&user).await.unwrap();

    assert_eq!(
        named,
        [NamedTrack {
            track: t("c1-f0"),
            person_id: ana,
            name: "Ana".into()
        }]
    );
}

#[tokio::test]
async fn naming_many_tracks_reuses_the_person_by_name_and_takes_the_new_spelling() {
    let (cat, _, user) = world().await;
    let ana = cat
        .upsert_person(&user, &PersonId::parse("p-ana").unwrap(), "Ana")
        .await
        .unwrap();

    let got = cat
        .name_tracks(
            &user,
            (&PersonId::parse("p-new").unwrap(), "ana"),
            &[t("c1-f1"), t("c2-f0")],
        )
        .await
        .unwrap();

    assert_eq!(got, ana, "case-insensitive: the existing person");
    for id in ["c1-f1", "c2-f0"] {
        let view = cat.track(&t(id)).await.unwrap().unwrap();
        assert_eq!(
            view.person_name.as_deref(),
            Some("ana"),
            "{id}: the newest spelling"
        );
    }
}
