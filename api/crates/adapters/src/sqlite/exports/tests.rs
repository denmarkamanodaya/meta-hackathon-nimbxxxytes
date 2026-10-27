//! Short exports against an in-memory, migrated database.

use super::*;
use crate::sqlite::test_pool;

async fn store() -> SqliteExportStore {
    let pool = test_pool().await;
    for sql in [
        "INSERT INTO users (id, created_at) VALUES ('u1', 't')",
        "INSERT INTO shorts (id, user_id, prompt, aspect, target_s, status, created_at) \
         VALUES ('x1', 'u1', 'p', '4:5', 20, 'ready', 't')",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }
    SqliteExportStore::new(pool)
}

fn row(platform: Platform, aspect: ExportAspect) -> ShortExport {
    ShortExport {
        id: format!("x1-{}", platform.as_str()),
        short_id: ShortId::parse("x1").unwrap(),
        platform,
        aspect,
        version_n: 2,
        status: ExportStatus::Queued,
        render_key: None,
        caption: String::new(),
        hashtags: vec![],
        cover_keys: vec![],
        cover_pick: 0,
        updated_at: "t".into(),
    }
}

fn key(raw: &str) -> ObjectKey {
    ObjectKey::from_stored(raw.into())
}

#[tokio::test]
async fn exports_keep_their_text_and_covers_when_queued_again() {
    let s = store().await;
    let id = ShortId::parse("x1").unwrap();
    s.queue_export(&row(Platform::Feed, ExportAspect::Portrait))
        .await
        .unwrap();
    s.queue_export(&row(Platform::Tiktok, ExportAspect::Vertical))
        .await
        .unwrap();
    s.set_text(&id, Platform::Tiktok, ("Go", &["#a".to_owned()]))
        .await
        .unwrap();
    s.add_covers(&id, Platform::Tiktok, &[key("c0"), key("c1")])
        .await
        .unwrap();
    s.add_covers(&id, Platform::Tiktok, &[key("c1"), key("c2")])
        .await
        .unwrap();
    s.set_cover_pick(&id, Platform::Tiktok, 2).await.unwrap();
    let ready = (ExportStatus::Ready, Some(&key("v.mp4")));
    s.set_render(&id, &[Platform::Tiktok], ready).await.unwrap();

    let mut again = row(Platform::Tiktok, ExportAspect::Vertical);
    again.version_n = 3;
    s.queue_export(&again).await.unwrap();

    let got = s.exports(&id).await.unwrap();
    let order: Vec<Platform> = got.iter().map(|e| e.platform).collect();
    assert_eq!(order, [Platform::Tiktok, Platform::Feed]);
    let t = &got[0];
    assert_eq!(
        (t.caption.as_str(), t.hashtags.clone()),
        ("Go", vec!["#a".to_owned()])
    );
    let covers: Vec<&str> = t.cover_keys.iter().map(ObjectKey::as_str).collect();
    assert_eq!(covers, ["c0", "c1", "c2"], "kept, each once");
    assert_eq!((t.cover_pick, t.version_n), (2, 3));
    assert_eq!(
        (t.status, t.render_key.clone(), t.aspect),
        (ExportStatus::Queued, None, ExportAspect::Vertical),
        "a new run renders again"
    );
}

#[tokio::test]
async fn a_restart_fails_unfinished_renders_but_not_the_feed() {
    let s = store().await;
    let id = ShortId::parse("x1").unwrap();
    s.queue_export(&row(Platform::Feed, ExportAspect::Portrait))
        .await
        .unwrap();
    s.queue_export(&row(Platform::Reels, ExportAspect::Vertical))
        .await
        .unwrap();
    s.set_render(
        &id,
        &[Platform::Reels, Platform::Feed],
        (ExportStatus::Rendering, None),
    )
    .await
    .unwrap();

    assert_eq!(s.fail_unfinished().await.unwrap(), 1);

    let got = s.exports(&id).await.unwrap();
    let statuses: Vec<(Platform, ExportStatus)> =
        got.iter().map(|e| (e.platform, e.status)).collect();
    assert_eq!(
        statuses,
        [
            (Platform::Reels, ExportStatus::Failed),
            (Platform::Feed, ExportStatus::Rendering)
        ]
    );
}
