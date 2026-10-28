//! Face boxes and finishes against an in-memory, migrated database.

use super::*;
use crate::sqlite::test_pool;

async fn exec(pool: &SqlitePool, sql: &'static str) {
    sqlx::query(sql).execute(pool).await.unwrap();
}

/// A clip with segments g1 (0-5 s) and g2 (5-10 s), track t0 (hidden, in both) and t1 (shown,
/// in g1).
async fn seeded() -> (SqlitePrivacyStore, SqlitePool) {
    let pool = test_pool().await;
    exec(
        &pool,
        "INSERT INTO users (id, created_at) VALUES ('u1', 't')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO clips (id, user_id, filename, ext, size_bytes, width, height, status, \
         created_at) VALUES ('c1', 'u1', 'a.mp4', 'mp4', 1, 720, 1280, 'ready', 't')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO segments (id, clip_id, idx, start_s, end_s) VALUES \
         ('g1', 'c1', 0, 0, 5), ('g2', 'c1', 1, 5, 10)",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO face_tracks (id, clip_id, ordinal, first_s, last_s, max_area, hidden) \
         VALUES ('t0', 'c1', 0, 1, 7, 0.1, 1), ('t1', 'c1', 1, 1, 2, 0.1, 0)",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO track_segments (track_id, segment_id) VALUES \
         ('t0', 'g1'), ('t0', 'g2'), ('t1', 'g1')",
    )
    .await;
    (SqlitePrivacyStore::new(pool.clone()), pool)
}

fn fb(t_s: f64) -> FaceBox {
    FaceBox {
        t_s,
        x: 0.25,
        y: 0.5,
        w: 0.125,
        h: 0.25,
    }
}

fn track(id: &str) -> TrackId {
    TrackId::parse(id).unwrap()
}

#[tokio::test]
async fn hidden_tracks_boxes_come_back_per_segment_and_a_rerun_replaces_them() {
    let (store, pool) = seeded().await;
    let clip = ClipId::parse("c1").unwrap();
    let old = [(track("t0"), vec![fb(9.0)])];
    store.replace_boxes(&clip, &old).await.unwrap();
    let boxes = [
        (track("t0"), vec![fb(1.0), fb(2.0), fb(6.0)]),
        (track("t1"), vec![fb(1.0)]),
    ];

    store.replace_boxes(&clip, &boxes).await.unwrap();
    let segments = [
        SegmentId::parse("g1").unwrap(),
        SegmentId::parse("g2").unwrap(),
    ];
    let got = store.hidden_boxes(&segments).await.unwrap();

    let seen: Vec<_> = got
        .iter()
        .map(|h| (h.segment_id.as_str(), h.track_id.as_str()))
        .collect();
    assert_eq!(seen, [("g1", "t0"), ("g2", "t0")], "t1 is not hidden");
    assert_eq!((got[1].boxes.len(), got[1].span.start_s), (3, 5.0));
    assert_eq!(got[0].aspect, Some(0.5625));
    assert_eq!(got[0].boxes[0], fb(1.0));
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM face_boxes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 4, "the rerun replaced the old box");
    exec(&pool, "DELETE FROM face_tracks WHERE id = 't0'").await;
    assert!(
        store.hidden_boxes(&segments).await.unwrap().is_empty(),
        "boxes go with their track"
    );
}

#[tokio::test]
async fn a_finish_round_trips_and_a_storys_blur_comes_from_its_production() {
    let (store, pool) = seeded().await;
    exec(
        &pool,
        "INSERT INTO shorts (id, user_id, prompt, aspect, target_s, status, created_at) VALUES \
         ('x1', 'u1', 'p', '4:5', 60, 'ready', 't'), ('x2', 'u1', 'p', '4:5', 60, 'ready', 't')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO productions (id, user_id, title, brief, format, aspect, target_s, \
         blur_bystanders, status, short_id, created_at) VALUES \
         ('p1', 'u1', 'T', 'b', 'story', '4:5', 60, 0, 'cutting', 'x1', 't')",
    )
    .await;
    let (x1, x2) = (ShortId::parse("x1").unwrap(), ShortId::parse("x2").unwrap());
    assert_eq!(store.finish(&x1).await.unwrap(), None);
    let f = ShortFinish {
        blur_bystanders: false,
        title_text: Some("Beach day".into()),
        speaker_colors: true,
        effect: Effect::BlurBg,
        keep_subject: false,
    };

    store.put_finish(&x1, &f).await.unwrap();
    store.put_finish(&x1, &f).await.unwrap();

    assert_eq!(store.finish(&x1).await.unwrap(), Some(f));
    assert_eq!(store.production_blur(&x1).await.unwrap(), Some(false));
    assert_eq!(store.production_blur(&x2).await.unwrap(), None);
}
