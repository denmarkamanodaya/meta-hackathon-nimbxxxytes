//! Library and clip-screen handlers over fakes: wire shapes, presigned URLs, ownership.

use axum::http::{StatusCode, header};
use nimbytes_core::domain::facts::{FactsStatus, SegmentFacts};
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::Catalogue;

use super::test_support::{PASSCODE, TestApp, get, post_json};

/// Signs in, then uploads and completes clip `id-2`; returns the cookie.
async fn uploaded_clip(app: &TestApp) -> String {
    let body = format!(r#"{{"passcode":"{PASSCODE}"}}"#);
    let (_, headers, _) = app.send(post_json("/api/session", None, &body)).await;
    let cookie = headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let create = r#"{"filename":"a.mp4","size_bytes":10,"content_type":"video/mp4"}"#;
    app.send(post_json("/api/uploads", Some(&cookie), create))
        .await;
    app.blobs.set_completed_size(10);
    app.send(post_json(
        "/api/uploads/id-3/complete",
        Some(&cookie),
        r#"{"parts":[{"n":1,"etag":"\"e\""}]}"#,
    ))
    .await;
    cookie
}

/// Clip `id-2` with two segments, facts on the first; returns the cookie.
async fn described_clip(app: &TestApp) -> String {
    let cookie = uploaded_clip(app).await;
    let clip = ClipId::parse("id-2").unwrap();
    let seg = |i: u32, a: f64, b: f64| Segment {
        id: SegmentId::parse(format!("id-2-s{i}")).unwrap(),
        clip_id: clip.clone(),
        idx: i,
        span: Span {
            start_s: a,
            end_s: b,
        },
    };
    app.catalogue
        .replace_segments(&clip, &[seg(0, 0.0, 7.0), seg(1, 7.0, 10.0)])
        .await
        .unwrap();
    let facts = SegmentFacts {
        description: "A dog sleeps.".into(),
        actions: vec!["sleeping".into()],
        objects: vec![],
        place: Some("sofa".into()),
        mood: None,
        quality: Some(6),
        hook_score: Some(3),
        status: FactsStatus::Ok,
    };
    app.catalogue
        .set_segment_facts(&SegmentId::parse("id-2-s0").unwrap(), &facts)
        .await
        .unwrap();
    cookie
}

#[tokio::test]
async fn the_library_card_has_the_first_thumb_and_the_segment_count() {
    let app = TestApp::new();
    let cookie = described_clip(&app).await;

    let (status, _, body) = app.send(get("/api/clips", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK);
    let rows: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        rows[0]["thumb_url"],
        "https://signed/users/id-1/thumbs/id-2/id-2-s0.jpg?ttl=3600"
    );
    assert_eq!(rows[0]["segment_count"], 2);
    assert_eq!(rows[0]["people"], serde_json::json!([]));
}

#[tokio::test]
async fn the_clip_screen_is_the_agreed_shape_with_one_hour_urls() {
    let app = TestApp::new();
    let cookie = described_clip(&app).await;

    let (status, _, body) = app.send(get("/api/clips/id-2", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let want = concat!(
        r#"{"clip":{"clip_id":"id-2","filename":"a.mp4","duration_s":null,"recorded_at":null,"status":"uploaded","#,
        r#""thumb_url":"https://signed/users/id-1/thumbs/id-2/id-2-s0.jpg?ttl=3600","segment_count":2,"people":[]},"#,
        r#""proxy_url":"https://signed/users/id-1/proxies/id-2_720p.mp4?ttl=3600","#,
        r#""segments":[{"segment_id":"id-2-s0","idx":0,"start_s":0.0,"end_s":7.0,"description":"A dog sleeps.","#,
        r#""actions":["sleeping"],"objects":[],"place":"sofa","mood":null,"quality":6,"hook_score":3,"#,
        r#""thumb_url":"https://signed/users/id-1/thumbs/id-2/id-2-s0.jpg?ttl=3600"},"#,
        r#"{"segment_id":"id-2-s1","idx":1,"start_s":7.0,"end_s":10.0,"description":null,"actions":[],"objects":[],"#,
        r#""place":null,"mood":null,"quality":null,"hook_score":null,"#,
        r#""thumb_url":"https://signed/users/id-1/thumbs/id-2/id-2-s1.jpg?ttl=3600"}],"#,
        r#""turns":[],"speakers":[],"tracks":[]}"#
    );
    assert_eq!(body, want);
}

#[tokio::test]
async fn another_users_clip_is_403_an_unknown_one_404_and_no_cookie_401() {
    let app = TestApp::new();
    described_clip(&app).await;
    let mallory = app.cookie_for("mallory");

    let (s1, _, b1) = app.send(get("/api/clips/id-2", Some(&mallory))).await;
    let (s2, _, _) = app.send(get("/api/clips/nope", Some(&mallory))).await;
    let (s3, _, _) = app.send(get("/api/clips/id-2", None)).await;

    assert_eq!(
        (s1, s2, s3),
        (
            StatusCode::FORBIDDEN,
            StatusCode::NOT_FOUND,
            StatusCode::UNAUTHORIZED
        )
    );
    assert!(
        !b1.contains("https://"),
        "no URL leaks to another user: {b1}"
    );
}
