//! The blur switch, reframe upserts, tapped objects and both KNN legs on SQLite.

use nimbytes_core::domain::ids::TrackId;
use nimbytes_core::domain::segment::TrackRow;
use nimbytes_core::ports::{Catalogue, FaceMatchStore};

use super::*;
use crate::sqlite::SqliteFaceStore;
use crate::sqlite::catalogue::views_tests::{add_clip, fixture};

fn unit(i: usize) -> Vec<f32> {
    let mut v = vec![0.0; 1024];
    v[i] = 1.0;
    v
}

fn reframe(n: u32, seg: &str, subject: &str, tracked: u32) -> ShotReframe {
    ShotReframe {
        short_id: ShortId::parse("x1").unwrap(),
        version_n: n,
        segment_id: SegmentId::parse(seg).unwrap(),
        subject: subject.into(),
        crop_path: vec![CropKey {
            t_s: 46.0,
            cx: 0.42,
            cy: 0.5,
        }],
        frames_tracked: tracked,
        frames_total: 72,
        lost_s: 1.5,
        updated_at: "t".into(),
    }
}

#[tokio::test]
async fn the_blur_switch_starts_off_and_follows_the_owner() {
    let (_cat, pool, user, _c1) = fixture().await;
    let store = SqliteSubjectStore::new(pool);
    assert!(!store.blur_objects(&user).await.unwrap());
    store.set_blur_objects(&user, true).await.unwrap();
    assert!(store.blur_objects(&user).await.unwrap());
    let nobody = UserId::parse("nobody").unwrap();
    assert!(!store.blur_objects(&nobody).await.unwrap());
}

#[tokio::test]
async fn reframes_upsert_per_version_and_moment_and_read_back_whole() {
    let (_cat, pool, _user, _c1) = fixture().await;
    sqlx::query(
        "INSERT INTO shorts (id, user_id, prompt, aspect, target_s, status, created_at) \
         VALUES ('x1', 'u1', 'p', '4:5', 20, 'ready', 't')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let store = SqliteSubjectStore::new(pool);
    store
        .put_reframe(&reframe(1, "s1", "dog", 10))
        .await
        .unwrap();
    store
        .put_reframe(&reframe(1, "s1", "cat", 60))
        .await
        .unwrap();
    store
        .put_reframe(&reframe(2, "s1", "cat", 70))
        .await
        .unwrap();

    let rows = store
        .reframes(&ShortId::parse("x1").unwrap())
        .await
        .unwrap();
    assert_eq!(rows.len(), 2, "one row per version and moment");
    assert_eq!(rows[0], reframe(1, "s1", "cat", 60));
    assert_eq!(rows[1].version_n, 2);
}

#[tokio::test]
async fn tapped_objects_come_back_nearest_first_as_clip_ranges() {
    let (cat, pool, user, c1) = fixture().await;
    let c2 = ClipId::parse("c2").unwrap();
    add_clip(&cat, &user, (&c2, "2026-10-27T02:00:00.000Z")).await;
    let store = SqliteSubjectStore::new(pool.clone());
    let track = |id: &str, clip: &ClipId, start_s: f64| ObjectTrack {
        id: id.into(),
        clip_id: clip.clone(),
        user_id: user.clone(),
        label: "red mug".into(),
        t_s: start_s,
        start_s,
        end_s: start_s + 3.0,
        created_at: "t".into(),
    };
    for (id, clip, start_s, axis) in [
        ("o1", &c1, 2.0, 0),
        ("o2", &c2, 5.0, 1),
        ("o2", &c2, 6.0, 1),
    ] {
        let t = track(id, clip, start_s);
        store.put_object(&t, &unit(axis)).await.unwrap();
    }

    let hits = store.nearest_objects(&user, &unit(1), 5).await.unwrap();
    assert_eq!(hits.len(), 2, "a re-put replaces, never duplicates");
    assert_eq!(
        (hits[0].clip_id.as_str(), hits[0].span.start_s),
        ("c2", 6.0)
    );
    assert!((hits[0].score - 1.0).abs() < 1e-6);
    let other = UserId::parse("u2").unwrap();
    assert!(
        store
            .nearest_objects(&other, &unit(1), 5)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn visible_face_tracks_come_back_as_clip_ranges() {
    let (cat, pool, user, c1) = fixture().await;
    let store = SqliteSubjectStore::new(pool.clone());
    let row = TrackRow {
        id: TrackId::parse("c1-f0").unwrap(),
        ordinal: 0,
        first_s: 3.0,
        last_s: 4.0,
        crop_key: "k".into(),
        max_area: 0.1,
    };
    cat.replace_face_tracks(&c1, &[row], &[]).await.unwrap();
    let faces = SqliteFaceStore::new(pool);
    faces.set_matching(&user, true).await.unwrap();
    faces
        .put_vector(&TrackId::parse("c1-f0").unwrap(), &user, &unit(2))
        .await
        .unwrap();
    let hits = store.nearest_faces(&user, &unit(2), 5).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(
        (hits[0].clip_id.as_str(), hits[0].span),
        (
            "c1",
            Span {
                start_s: 3.0,
                end_s: 5.0
            }
        )
    );
}
