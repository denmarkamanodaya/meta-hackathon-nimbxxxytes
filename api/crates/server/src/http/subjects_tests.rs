//! Find this, Cut out, reframe and the screens-and-plates switch over fakes: wire shapes, the SAM
//! request each sends, ownership, the deadline.

use axum::http::StatusCode;
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::sam::{Propagation, SamPrompt};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::Catalogue;
use nimbytes_testkit::sam_record;
use nimbytes_testkit::world::{clip, probe};
use serde_json::{Value, json};

use super::test_support::{TestApp, get, post_json, put_json};

/// u1's clip c1 (10 s, probed) with moments c1-s0 (0–5 s) and c1-s1 (5–10 s).
async fn world() -> (TestApp, String) {
    let app = TestApp::new();
    app.catalogue
        .put_clip(clip(Some(probe(10.0, false))).unwrap());
    let c1 = ClipId::parse("c1").unwrap();
    let seg = |i: u32| Segment {
        id: SegmentId::parse(format!("c1-s{i}")).unwrap(),
        clip_id: c1.clone(),
        idx: i,
        span: Span {
            start_s: f64::from(i) * 5.0,
            end_s: f64::from(i + 1) * 5.0,
        },
    };
    app.catalogue
        .replace_segments(&c1, &[seg(0), seg(1)])
        .await
        .unwrap();
    let cookie = app.cookie_for("u1");
    (app, cookie)
}

const TAP: &str = r#"{"t_s":4.2,"x":0.5,"y":0.25}"#;

/// Find this on c1 with SAM following object 1 in seconds 3, 4 and 6; the answer body.
async fn found() -> (TestApp, StatusCode, String) {
    let (app, cookie) = world().await;
    app.tracker.point(vec![
        sam_record(3, 1, (300.0, 280.0, 420.0, 360.0)),
        sam_record(4, 1, (290.0, 270.0, 440.0, 380.0)),
        sam_record(6, 1, (280.0, 260.0, 400.0, 350.0)),
    ]);
    let (status, _, body) = app
        .send(post_json("/api/clips/c1/find", Some(&cookie), TAP))
        .await;
    (app, status, body)
}

#[tokio::test]
async fn find_this_answers_label_outline_view_and_the_moments() {
    let (_app, status, body) = found().await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["label"], "red mug");
    assert_eq!(v["in_view"], json!({"start_s": 3.0, "end_s": 7.0}));
    assert_eq!(
        v["outline"],
        json!({"path": "M290 270Z", "frame_w": 480, "frame_h": 640}),
        "the tapped frame's outline"
    );
    assert_eq!(v["hits"][0]["clip_id"], "c1");
    assert_eq!(v["hits"][0]["segment_id"], "c1-s0");
    assert_eq!(v["hits"][0]["start_s"], 3.0);
}

#[tokio::test]
async fn find_this_sends_a_point_at_the_tap_both_ways_and_stores_the_object() {
    let (app, _, _) = found().await;
    let seen = app.tracker.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].media, "sam_fps1.mp4");
    assert_eq!(
        seen[0].prompt,
        SamPrompt::Point {
            frame: 4,
            id: 1,
            x: 360,
            y: 320,
            w: 720,
            h: 1280
        },
        "the tap in pixels of the 1 fps copy, at the tapped second"
    );
    assert_eq!(
        (seen[0].propagation, seen[0].purpose.as_str()),
        (Some(Propagation::Both), "find_object")
    );
    let stored = app.subjects.stored_objects();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        (
            stored[0].0.label.as_str(),
            stored[0].0.start_s,
            stored[0].0.end_s
        ),
        ("red mug", 3.0, 7.0)
    );
}

#[tokio::test]
async fn nothing_at_the_tap_searches_a_tap_centred_crop_without_outline_or_storing() {
    let (app, cookie) = world().await;

    let (status, _, body) = app
        .send(post_json("/api/clips/c1/find", Some(&cookie), TAP))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert!(v["outline"].is_null());
    assert_eq!(v["in_view"], json!({"start_s": 4.0, "end_s": 5.0}));
    assert!(
        app.media
            .calls()
            .iter()
            .any(|c| c.starts_with("crop@4.2 270x230+180")),
        "{:?}",
        app.media.calls()
    );
    assert!(app.subjects.stored_objects().is_empty());
}

#[tokio::test]
async fn a_tap_on_someone_elses_or_a_missing_clip_or_off_the_frame_is_refused() {
    let (app, _) = world().await;
    let other = app.cookie_for("u2");
    let mine = app.cookie_for("u1");
    let send = |uri: &'static str, cookie: String, body: &'static str| {
        let app = &app;
        async move { app.send(post_json(uri, Some(&cookie), body)).await.0 }
    };
    assert_eq!(
        send("/api/clips/c1/find", other.clone(), TAP).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send("/api/clips/c1/cutout", other, TAP).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send("/api/clips/zz/find", mine.clone(), TAP).await,
        StatusCode::NOT_FOUND
    );
    let off = r#"{"t_s":4.2,"x":1.5,"y":0.25}"#;
    assert_eq!(
        send("/api/clips/c1/find", mine.clone(), off).await,
        StatusCode::BAD_REQUEST
    );
    let late = r#"{"t_s":40,"x":0.5,"y":0.25}"#;
    assert_eq!(
        send("/api/clips/c1/cutout", mine, late).await,
        StatusCode::BAD_REQUEST
    );
    assert!(
        app.tracker.seen().is_empty(),
        "no SAM call for a refused tap"
    );
}

#[tokio::test]
async fn a_tap_past_the_deadline_is_model_unavailable() {
    let (app, cookie) = world().await;
    app.tracker.hang();

    let started = std::time::Instant::now();
    let (status, _, body) = app
        .send(post_json("/api/clips/c1/find", Some(&cookie), TAP))
        .await;

    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(body.contains("MODEL_UNAVAILABLE"), "{body}");
    assert!(body.contains("took too long"), "{body}");
    assert!(started.elapsed() < std::time::Duration::from_secs(3));
}

#[tokio::test]
async fn cut_out_cuts_the_tapped_object_from_one_frame_as_a_png_and_a_sticker() {
    let (app, cookie) = world().await;
    app.tracker
        .point(vec![sam_record(0, 1, (19.0, 207.0, 290.0, 367.0))]);

    let (status, _, body) = app
        .send(post_json("/api/clips/c1/cutout", Some(&cookie), TAP))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["label"], "red mug");
    assert!(v["png_url"].as_str().unwrap().contains("cutouts/c1/id"));
    assert!(v["sticker_url"].as_str().unwrap().contains("_sticker.png"));
    let seen = app.tracker.seen();
    assert!(seen[0].image, "SAM on one image");
    assert_eq!(seen[0].propagation, None);
    assert!(matches!(
        seen[0].prompt,
        SamPrompt::Point {
            frame: 0,
            x: 360,
            y: 320,
            ..
        }
    ));
    let cuts = app.masks.cutouts();
    assert_eq!(
        cuts.iter().map(|(r, _)| r.sticker).collect::<Vec<_>>(),
        [false, true]
    );
    let r = &cuts[0].0;
    assert_eq!(
        (r.bbox.x1, r.bbox.y1, r.bbox.x2, r.bbox.y2),
        (19, 207, 290, 367)
    );
    assert_eq!((r.frame.w, r.frame.h), (480, 640));
    assert!(app.media.calls().iter().any(|c| c.starts_with("frame@4.2")));
}

#[tokio::test]
async fn cut_out_with_nothing_at_the_tap_is_validation_failed() {
    let (app, cookie) = world().await;
    let (status, _, body) = app
        .send(post_json("/api/clips/c1/cutout", Some(&cookie), TAP))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("nothing to cut out"), "{body}");
    assert!(app.masks.cutouts().is_empty());
}

#[tokio::test]
async fn the_screens_and_plates_switch_reads_and_writes_with_face_matching() {
    let (app, cookie) = world().await;
    let (_, _, before) = app.send(get("/api/settings", Some(&cookie))).await;
    let (status, _, on) = app
        .send(put_json(
            "/api/settings",
            &cookie,
            r#"{"face_matching":false,"blur_objects":true}"#,
        ))
        .await;
    let (_, _, after) = app.send(get("/api/settings", Some(&cookie))).await;

    assert_eq!(before, r#"{"face_matching":false,"blur_objects":false}"#);
    assert_eq!(status, StatusCode::OK);
    assert_eq!(on, r#"{"face_matching":false,"blur_objects":true}"#);
    assert_eq!(after, on);
}

#[tokio::test]
async fn reframing_a_missing_short_is_not_found() {
    let (app, cookie) = world().await;
    let id = "01JABCDEF0000000000000000Z";
    let (get_status, _, _) = app
        .send(get(&format!("/api/shorts/{id}/reframe"), Some(&cookie)))
        .await;
    let (post_status, _, _) = app
        .send(post_json(
            &format!("/api/shorts/{id}/reframe"),
            Some(&cookie),
            "{}",
        ))
        .await;
    assert_eq!(
        (get_status, post_status),
        (StatusCode::NOT_FOUND, StatusCode::NOT_FOUND)
    );
}
