//! The preview cleanup over fakes: which shorts and versions lose their preview, and a rerun.

#![cfg(test)]

use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::short::{Short, ShortStatus};
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::keys;
use nimbytes_core::ports::ShortStore;
use nimbytes_core::usecases::shorts::{PreviewCleanupDeps, clean_previews};
use nimbytes_testkit::shorts_world::{ShortsWorld, seg, timeline, user};

/// A short of u1 made at `created_at`, with versions 1–3 that all have a preview.
async fn short(w: &ShortsWorld, id: &str, created_at: &str, status: ShortStatus) -> ShortId {
    let id = ShortId::parse(id).unwrap();
    let s = Short {
        id: id.clone(),
        user_id: user("u1"),
        prompt: String::new(),
        aspect: Aspect::Portrait,
        target_s: 6.0,
        status,
        best_version: Some(2),
        render: None,
        created_at: created_at.into(),
    };
    w.shorts.create(&s, &[seg("s0")]).await.unwrap();
    for n in 1..=3 {
        w.shorts
            .add_version(&id, n, &timeline(&[("s0", 1.0, 4.0)]))
            .await
            .unwrap();
        let key = keys::preview(&user("u1"), &id, n);
        w.shorts.set_preview(&id, n, &key).await.unwrap();
    }
    id
}

async fn previews(w: &ShortsWorld, id: &ShortId) -> Vec<Option<String>> {
    let versions = w.shorts.versions(id).await.unwrap();
    versions
        .iter()
        .map(|v| v.preview_key.as_ref().map(|k| k.as_str().to_owned()))
        .collect()
}

#[tokio::test]
async fn previews_of_ready_shorts_older_than_7_days_go_except_the_best_versions() {
    let w = ShortsWorld::new();
    // NOW is 2026-10-27T03:00:00Z, so the cutoff is 2026-10-20T03:00:00Z.
    let old = short(&w, "old", "2026-10-20T02:59:59.999Z", ShortStatus::Ready).await;
    let young = short(&w, "young", "2026-10-20T03:00:00.000Z", ShortStatus::Ready).await;
    let busy = short(
        &w,
        "busy",
        "2026-10-01T00:00:00.000Z",
        ShortStatus::Rendering,
    )
    .await;
    let deps = PreviewCleanupDeps {
        shorts: w.shorts.as_ref(),
        blobs: w.blobs.as_ref(),
        clock: w.clock.as_ref(),
    };

    let first = clean_previews(&deps).await.unwrap();
    let again = clean_previews(&deps).await.unwrap();

    assert_eq!((first, again), (2, 0), "a rerun removes nothing more");
    assert_eq!(
        w.blobs.deleted(),
        [
            "users/u1/previews/old/v1.mp4",
            "users/u1/previews/old/v3.mp4"
        ]
    );
    assert_eq!(
        previews(&w, &old).await,
        [None, Some("users/u1/previews/old/v2.mp4".into()), None]
    );
    assert_eq!(previews(&w, &young).await.iter().flatten().count(), 3);
    assert_eq!(previews(&w, &busy).await.iter().flatten().count(), 3);
}
