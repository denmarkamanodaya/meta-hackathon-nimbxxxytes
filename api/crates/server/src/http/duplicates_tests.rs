//! The pre-upload check, removing a clip, and a duplicate in the library list: exact wire shapes.

use axum::http::StatusCode;
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, SegmentId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::Catalogue;

use super::test_support::{TestApp, delete, get, post_json};

fn clip(id: &str, status: ClipStatus, duplicate_of: Option<&str>) -> Clip {
    Clip {
        id: ClipId::parse(id).unwrap(),
        user_id: UserId::parse("u1").unwrap(),
        filename: "att.mp4".into(),
        ext: MediaExt::Mp4,
        size_bytes: 3_732_228,
        status,
        probe: None,
        created_at: if duplicate_of.is_some() {
            "2026-10-26T21:21:00.000Z".into()
        } else {
            "2026-10-26T19:46:00.000Z".into()
        },
        title: Some("Sleepy old dog".into()),
        last_viewed_at: None,
        content_sha256: Some("abc".into()),
        duplicate_of: duplicate_of.map(|d| ClipId::parse(d).unwrap()),
    }
}

const SAME: &str = r#"{"filename":"att.mp4","size_bytes":3732228}"#;

#[tokio::test]
async fn the_upload_check_names_the_clip_a_file_would_copy() {
    let app = TestApp::new();
    app.catalogue.put_clip(clip("c0", ClipStatus::Ready, None));
    let cookie = app.cookie_for("u1");
    let check = |body: &'static str| post_json("/api/uploads/check", Some(&cookie), body);

    let (status, _, same) = app.send(check(SAME)).await;
    let (_, _, other) = app
        .send(check(r#"{"filename":"att.mp4","size_bytes":1}"#))
        .await;
    let (bad, _, _) = app.send(check(r#"{"filename":"att.mp4"}"#)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        same,
        r#"{"duplicate_of":{"clip_id":"c0","title":"Sleepy old dog"}}"#
    );
    assert_eq!(other, r#"{"duplicate_of":null}"#);
    assert_eq!(bad, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn the_upload_check_never_matches_another_users_clip_and_needs_a_session() {
    let app = TestApp::new();
    app.catalogue.put_clip(clip("c0", ClipStatus::Ready, None));
    let theirs = Some(app.cookie_for("u2"));

    let (_, _, body) = app
        .send(post_json("/api/uploads/check", theirs.as_deref(), SAME))
        .await;
    let (anon, _, _) = app.send(post_json("/api/uploads/check", None, SAME)).await;

    assert_eq!(body, r#"{"duplicate_of":null}"#);
    assert_eq!(anon, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_duplicate_lists_with_its_status_and_the_clip_it_copies() {
    let app = TestApp::new();
    app.catalogue.put_clip(clip("c0", ClipStatus::Ready, None));
    app.catalogue
        .put_clip(clip("c01", ClipStatus::Duplicate, Some("c0")));

    let (status, _, body) = app
        .send(get("/api/clips", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains(r#""status":"duplicate","thumb_url":null,"segment_count":0,"people":[],"duplicate_of":"c0","size_bytes":3732228,"project_ids":[],"speech_count":0,"face_count":0}"#),
        "{body}"
    );
    assert!(body.contains(
        r#""status":"ready","thumb_url":null,"segment_count":0,"people":[],"duplicate_of":null,"size_bytes":3732228,"project_ids":[],"speech_count":0,"face_count":0}"#
    ));
}

#[tokio::test]
async fn deleting_a_clip_answers_204_and_another_users_clip_403_and_a_missing_one_404() {
    let app = TestApp::new();
    app.catalogue
        .put_clip(clip("c01", ClipStatus::Duplicate, Some("c0")));

    let (theirs, _, _) = app
        .send(delete("/api/clips/c01", &app.cookie_for("u2")))
        .await;
    let kept = app.blobs.deleted();
    let (status, _, body) = app
        .send(delete("/api/clips/c01", &app.cookie_for("u1")))
        .await;
    let (again, _, _) = app
        .send(delete("/api/clips/c01", &app.cookie_for("u1")))
        .await;

    assert_eq!((theirs, kept.len()), (StatusCode::FORBIDDEN, 0));
    assert_eq!((status, body.as_str()), (StatusCode::NO_CONTENT, ""));
    assert_eq!(
        app.blobs.deleted(),
        [
            "users/u1/originals/c01.mp4",
            "users/u1/proxies/c01_720p.mp4",
            "users/u1/proxies/c01_fps1.mp4",
            "users/u1/audio/c01.wav",
        ]
    );
    assert_eq!(again, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn any_owned_clip_can_be_deleted_not_only_a_duplicate() {
    let app = TestApp::new();
    app.catalogue.put_clip(clip("c0", ClipStatus::Ready, None));
    let seg = Segment {
        id: SegmentId::parse("c0-s0").unwrap(),
        clip_id: ClipId::parse("c0").unwrap(),
        idx: 0,
        span: Span {
            start_s: 0.0,
            end_s: 7.0,
        },
    };
    app.catalogue
        .replace_segments(&seg.clip_id, std::slice::from_ref(&seg))
        .await
        .unwrap();

    let (status, _, _) = app
        .send(delete("/api/clips/c0", &app.cookie_for("u1")))
        .await;
    let (detail, _, _) = app
        .send(get("/api/clips/c0", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        app.blobs.deleted(),
        [
            "users/u1/originals/c0.mp4",
            "users/u1/proxies/c0_720p.mp4",
            "users/u1/proxies/c0_fps1.mp4",
            "users/u1/audio/c0.wav",
            "users/u1/snippets/c0/c0-s0.mp4",
            "users/u1/thumbs/c0/c0-s0.jpg",
        ]
    );
    assert_eq!(detail, StatusCode::NOT_FOUND);
}
