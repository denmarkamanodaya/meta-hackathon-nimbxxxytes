//! The Mac app's sync API over fakes: exact wire shapes, the etag and `304`, ready-only clips and
//! the owner-only original.

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, ShortId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::short::{Short, ShortStatus};
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::keys;
use nimbytes_core::ports::{BlobStore, Catalogue, PutFile, ShortStore};
use nimbytes_core::usecases::sync::{ManifestOutcome, SyncDeps, sync_manifest};
use nimbytes_testkit::shorts_world::user;
use nimbytes_testkit::world::probe;
use nimbytes_testkit::{
    FakeBlobStore, InMemoryCatalogue, InMemoryDocuments, InMemoryListens, InMemoryPhotos,
    InMemoryShorts,
};

use super::test_support::{TestApp, get};

fn clip(id: &str, owner: &str, status: ClipStatus, created: &str) -> Clip {
    Clip {
        id: ClipId::parse(id).unwrap(),
        user_id: UserId::parse(owner).unwrap(),
        filename: "IMG_7.MOV".into(),
        ext: MediaExt::Mov,
        size_bytes: 900,
        status,
        probe: Some(probe(12.5, true)),
        created_at: created.into(),
        title: None,
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    }
}

fn short(id: &str, owner: &str, created: &str) -> Short {
    Short {
        id: ShortId::parse(id).unwrap(),
        user_id: UserId::parse(owner).unwrap(),
        prompt: "calm".into(),
        aspect: Aspect::Portrait,
        target_s: 10.0,
        status: ShortStatus::Ready,
        best_version: Some(2),
        render: None,
        created_at: created.into(),
    }
}

/// One ready clip of `u1` with a stored proxy, plus clips the manifest must leave out.
fn seed_clips(catalogue: &InMemoryCatalogue) {
    let day = "2026-10-26T00:00:00.000Z";
    catalogue.put_clip(clip("c1", "u1", ClipStatus::Ready, day));
    catalogue.put_clip(clip("c2", "u1", ClipStatus::Duplicate, day));
    catalogue.put_clip(clip("c3", "u1", ClipStatus::Processing, day));
    catalogue.put_clip(clip("c4", "u2", ClipStatus::Ready, day));
}

async fn store_proxy(blobs: &FakeBlobStore, clip: &str) {
    let key = keys::proxy_720p(&user("u1"), &ClipId::parse(clip).unwrap());
    let put = PutFile {
        key: &key,
        path: std::path::Path::new("/tmp/proxy.mp4"),
        content_type: "video/mp4",
        class: None,
        cache_control: None,
    };
    blobs.put_file(put).await.unwrap();
}

/// Two shorts of `u1`, the older one with a final render, and one of `u2`.
async fn seed_shorts(shorts: &InMemoryShorts) {
    let old = short("x1", "u1", "2026-10-27T01:00:00.000Z");
    let new = short("x2", "u1", "2026-10-27T02:00:00.000Z");
    let theirs = short("x3", "u2", "2026-10-27T03:00:00.000Z");
    for s in [&old, &new, &theirs] {
        shorts.create(s, &[]).await.unwrap();
    }
    let key = keys::render(&user("u1"), &old.id);
    shorts.set_render(&old.id, Some((&key, 2))).await.unwrap();
}

fn with_etag(uri: &str, cookie: &str, etag: &str) -> Request<Body> {
    Request::get(uri)
        .header(header::COOKIE, cookie)
        .header(header::IF_NONE_MATCH, etag)
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn the_manifest_answers_the_agreed_shape_with_ready_clips_and_newest_shorts_first() {
    let app = TestApp::new();
    seed_clips(&app.catalogue);
    store_proxy(&app.blobs, "c1").await;
    seed_shorts(&app.shorts).await;

    let (status, headers, body) = app
        .send(get("/api/sync/manifest", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK);
    let tag = headers[header::ETAG].to_str().unwrap().to_owned();
    let etag = tag.trim_matches('"');
    assert_eq!(tag, format!("\"{etag}\""), "the ETag header is quoted");
    assert_eq!(etag.len(), 64, "SHA-256 hex: {etag}");
    assert!(
        etag.chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
    let want = [
        format!(r#"{{"etag":"{etag}","clips":[{{"clip_id":"c1","title":"IMG_7","#),
        r#""filename":"IMG_7.MOV","ext":"mov","size_bytes":900,"duration_s":12.5,"fps":30.0,"#
            .into(),
        r#""width":720,"height":1280,"recorded_at":"2026-01-28T05:59:00.000Z","#.into(),
        r#""proxy_url":"https://signed/users/u1/proxies/c1_720p.mp4?ttl=3600","#.into(),
        r#""proxy_size_bytes":1}],"shorts":["#.into(),
        r#"{"short_id":"x2","prompt":"calm","aspect":"4:5","status":"ready","best_version":2,"#
            .into(),
        r#""render_url":null,"created_at":"2026-10-27T02:00:00.000Z"},"#.into(),
        r#"{"short_id":"x1","prompt":"calm","aspect":"4:5","status":"ready","best_version":2,"#
            .into(),
        r#""render_url":"https://signed/users/u1/renders/x1.mp4?ttl=3600","#.into(),
        r#""created_at":"2026-10-27T01:00:00.000Z"}],"items":[]}"#.into(),
    ]
    .concat();
    assert_eq!(body, want);
}

#[tokio::test]
async fn a_missing_proxy_size_is_null_not_an_error() {
    let app = TestApp::new();
    seed_clips(&app.catalogue);

    let (status, _, body) = app
        .send(get("/api/sync/manifest", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body.contains(r#""proxy_size_bytes":null"#), "{body}");
}

#[tokio::test]
async fn a_known_etag_answers_304_with_an_empty_body_until_a_title_changes() {
    let app = TestApp::new();
    seed_clips(&app.catalogue);
    seed_shorts(&app.shorts).await;
    let cookie = app.cookie_for("u1");
    let (_, headers, _) = app.send(get("/api/sync/manifest", Some(&cookie))).await;
    let tag = headers[header::ETAG].to_str().unwrap().to_owned();

    let (quoted, again, empty) = app
        .send(with_etag("/api/sync/manifest", &cookie, &tag))
        .await;
    let bare = tag.trim_matches('"');
    let listed = format!("\"stale\", W/{tag}");
    let (bare_status, _, _) = app
        .send(with_etag("/api/sync/manifest", &cookie, bare))
        .await;
    let (listed_status, _, _) = app
        .send(with_etag("/api/sync/manifest", &cookie, &listed))
        .await;
    let c1 = ClipId::parse("c1").unwrap();
    app.catalogue.set_title(&c1, "Beach walk").await.unwrap();
    let (changed, after, body) = app
        .send(with_etag("/api/sync/manifest", &cookie, &tag))
        .await;

    assert_eq!(quoted, StatusCode::NOT_MODIFIED);
    assert_eq!(
        (again[header::ETAG].to_str().unwrap(), empty.as_str()),
        (tag.as_str(), "")
    );
    assert_eq!(
        (bare_status, listed_status),
        (StatusCode::NOT_MODIFIED, StatusCode::NOT_MODIFIED)
    );
    assert_eq!(changed, StatusCode::OK);
    assert_ne!(after[header::ETAG].to_str().unwrap(), tag);
    assert!(body.contains(r#""title":"Beach walk""#), "{body}");
}

#[tokio::test]
async fn the_etag_stays_the_same_when_urls_are_re_signed() {
    let (catalogue, shorts, blobs) = (
        InMemoryCatalogue::default(),
        InMemoryShorts::default(),
        FakeBlobStore::default(),
    );
    let (listens, documents, photos) = (
        InMemoryListens::default(),
        InMemoryDocuments::default(),
        InMemoryPhotos::default(),
    );
    seed_clips(&catalogue);
    seed_shorts(&shorts).await;
    let deps = |ttl: u64| SyncDeps {
        catalogue: &catalogue,
        shorts: &shorts,
        listens: &listens,
        documents: &documents,
        photos: &photos,
        blobs: &blobs,
        url_ttl: Duration::from_secs(ttl),
        // The digest input itself, so any URL that leaked into it would show.
        digest: |b| String::from_utf8_lossy(b).into_owned(),
    };

    let hour = sync_manifest(&deps(3600), &user("u1"), &[]).await.unwrap();
    let later = sync_manifest(&deps(7200), &user("u1"), &[]).await.unwrap();

    let (ManifestOutcome::Changed(hour), ManifestOutcome::Changed(later)) = (hour, later) else {
        unreachable!("no etag was sent");
    };
    assert_ne!(hour.clips[0].proxy_url, later.clips[0].proxy_url);
    assert_eq!(hour.etag, later.etag);
}

#[tokio::test]
async fn the_original_is_a_download_of_the_owners_ready_clip_only() {
    let app = TestApp::new();
    seed_clips(&app.catalogue);
    let c1 = ClipId::parse("c1").unwrap();
    app.catalogue.set_title(&c1, "Beach").await.unwrap();
    let mine = app.cookie_for("u1");
    let post = |uri: &str, cookie: &str| {
        Request::post(uri)
            .header(header::COOKIE, cookie)
            .body(Body::empty())
            .unwrap()
    };

    let (status, _, body) = app.send(post("/api/sync/clips/c1/original", &mine)).await;
    let theirs = app
        .send(post("/api/sync/clips/c1/original", &app.cookie_for("u2")))
        .await;
    let duplicate = app.send(post("/api/sync/clips/c2/original", &mine)).await;
    let processing = app.send(post("/api/sync/clips/c3/original", &mine)).await;
    let unknown = app.send(post("/api/sync/clips/c9/original", &mine)).await;
    let (signed_out, _, _) = app
        .send(
            Request::post("/api/sync/clips/c1/original")
                .body(Body::empty())
                .unwrap(),
        )
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        r#"{"url":"https://signed/users/u1/originals/c1.mov?ttl=3600&download=Beach.mov"}"#
    );
    let not_found = r#"{"error":{"code":"NOT_FOUND","message":"no such clip"}}"#;
    for (status, _, body) in [theirs, duplicate, processing, unknown] {
        assert_eq!((status, body.as_str()), (StatusCode::NOT_FOUND, not_found));
    }
    assert_eq!(signed_out, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_manifest_needs_a_session() {
    let app = TestApp::new();

    let (status, _, _) = app.send(get("/api/sync/manifest", None)).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
