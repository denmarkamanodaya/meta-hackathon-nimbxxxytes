//! Keep both, and near-copy and same-moment links on the library and clip screens: exact wire
//! shapes and status codes.

use axum::http::StatusCode;
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, JobId, SegmentId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::segment::{Segment, segment_id};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::similar::{ClipLink, LinkKind};
use nimbytes_core::ports::{Catalogue, JobQueue, NewJob};

use super::test_support::{TestApp, get, post_json};

/// A 30 s clip `id` of `user` recorded 2026-10-20 10:00, titled `title`, uploaded at `hour`.
fn clip((id, user): (&str, &str), status: ClipStatus, (hour, title): (u8, &str)) -> Clip {
    Clip {
        id: ClipId::parse(id).unwrap(),
        user_id: UserId::parse(user).unwrap(),
        filename: format!("{id}.mov"),
        ext: MediaExt::Mov,
        size_bytes: 10,
        status,
        probe: Some(ProbeInfo {
            duration_s: 30.0,
            width: 1280,
            height: 720,
            fps: 30.0,
            rotation: 0,
            codec: "h264".into(),
            recorded_at: Some("2026-10-20T10:00:00.000Z".into()),
            has_audio: false,
        }),
        created_at: format!("2026-10-27T{hour:02}:00:00.000Z"),
        title: Some(title.into()),
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    }
}

fn id(s: &str) -> ClipId {
    ClipId::parse(s).unwrap()
}

/// The finished ingest job of `c1` (it stopped at `similar` and ran its no-op steps).
async fn finished_ingest(app: &TestApp) {
    let job_id = JobId::parse("j1").unwrap();
    let job = NewJob {
        id: &job_id,
        kind: JobKind::Ingest,
        subject_id: "c1",
    };
    app.jobs.enqueue(job, 0).await.unwrap();
    app.jobs.advance(&job_id, "ready", 0).await.unwrap();
    app.jobs.done(&job_id, 0).await.unwrap();
}

/// u1: original `c0`, its near-copy `c1`, and `c2` filmed at the same moment as `c0` (with one
/// segment); u2: `z`.
async fn library(app: &TestApp) {
    for c in [
        clip(("c0", "u1"), ClipStatus::Ready, (0, "Beach walk")),
        clip(("c1", "u1"), ClipStatus::NearCopy, (1, "Beach copy")),
        clip(("c2", "u1"), ClipStatus::Ready, (2, "Other angle")),
        clip(("z", "u2"), ClipStatus::NearCopy, (1, "Theirs")),
    ] {
        app.catalogue.put_clip(c);
    }
    app.catalogue.put_segments(&[Segment {
        id: segment_id(&id("c2"), 0).unwrap(),
        clip_id: id("c2"),
        idx: 0,
        span: Span {
            start_s: 0.0,
            end_s: 6.0,
        },
    }]);
    let u1 = UserId::parse("u1").unwrap();
    let copy = ClipLink {
        clip: id("c1"),
        other: id("c0"),
        kind: LinkKind::NearCopyOf,
        score: 0.94,
    };
    app.links.put(&u1, copy);
    app.links
        .put(&u1, ClipLink::same_moment(&id("c2"), &id("c0"), 0.9));
    finished_ingest(app).await;
}

fn keep(id: &str, cookie: &str) -> axum::http::Request<axum::body::Body> {
    post_json(&format!("/api/clips/{id}/keep"), Some(cookie), "{}")
}

#[tokio::test]
async fn keep_both_answers_202_and_resumes_the_near_copy_from_transcribe() {
    let app = TestApp::new();
    library(&app).await;

    let (status, _, body) = app.send(keep("c1", &app.cookie_for("u1"))).await;

    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(body, r#"{"clip_id":"c1","status":"processing"}"#);
    let stored = app.catalogue.get_clip(&id("c1")).await.unwrap().unwrap();
    assert_eq!(stored.status, ClipStatus::Processing);
    let job = &app.jobs.all()[0];
    assert_eq!(
        (job.status, job.job.step.as_deref()),
        ("queued", Some("similar"))
    );
    assert_eq!(
        app.links.all()[0].kind,
        LinkKind::Kept,
        "the pair never links again"
    );
}

#[tokio::test]
async fn keep_refuses_a_clip_that_is_no_copy_another_users_clip_and_an_unknown_id() {
    let app = TestApp::new();
    library(&app).await;
    let cookie = app.cookie_for("u1");

    let (plain, _, plain_body) = app.send(keep("c2", &cookie)).await;
    let (theirs, _, theirs_body) = app.send(keep("z", &cookie)).await;
    let (missing, _, _) = app.send(keep("nope", &cookie)).await;

    assert_eq!(plain, StatusCode::BAD_REQUEST);
    assert!(
        plain_body.contains(r#""code":"VALIDATION_FAILED""#),
        "{plain_body}"
    );
    assert_eq!(theirs, StatusCode::FORBIDDEN);
    assert!(
        theirs_body.contains(r#""code":"FORBIDDEN""#),
        "{theirs_body}"
    );
    assert_eq!(missing, StatusCode::NOT_FOUND);
    let z = app.catalogue.get_clip(&id("z")).await.unwrap().unwrap();
    assert_eq!(
        z.status,
        ClipStatus::NearCopy,
        "another user's clip is untouched"
    );
}

#[tokio::test]
async fn keep_on_a_ready_clip_the_backfill_linked_drops_the_link_and_stays_ready() {
    let app = TestApp::new();
    library(&app).await;
    app.catalogue
        .set_clip_status(&id("c1"), ClipStatus::Ready, None)
        .await
        .unwrap();

    let (status, _, body) = app.send(keep("c1", &app.cookie_for("u1"))).await;

    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(body, r#"{"clip_id":"c1","status":"ready"}"#);
    assert_eq!(app.jobs.all()[0].status, "done", "no ingest restarted");
}

#[tokio::test]
async fn the_library_lists_near_copy_of_and_angles() {
    let app = TestApp::new();
    library(&app).await;

    let (status, _, body) = app
        .send(get("/api/clips", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body.contains(concat!(
            r#""status":"near_copy","#,
            r#""thumb_url":null,"segment_count":0,"people":[],"duplicate_of":null,"size_bytes":10,"#,
            r#""project_ids":[],"speech_count":0,"face_count":0,"#,
            r#""near_copy_of":{"clip_id":"c0","title":"Beach walk","score":0.94},"angles":0}"#
        )),
        "{body}"
    );
    assert!(
        body.contains(r#""face_count":0,"near_copy_of":null,"angles":1}"#),
        "c0 and c2 each have one angle: {body}"
    );
    assert!(!body.contains("Theirs"), "only the caller's clips");
}

#[tokio::test]
async fn the_clip_screen_lists_every_linked_clip_from_its_side() {
    let app = TestApp::new();
    library(&app).await;

    let (status, _, body) = app
        .send(get("/api/clips/c0", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let thumb = SegmentId::parse("c2-s0").unwrap();
    let want = format!(
        concat!(
            r#""links":[{{"clip_id":"c1","title":"Beach copy","kind":"copied_by","score":0.94,"#,
            r#""recorded_at":"2026-10-20T10:00:00.000Z","thumb_url":null,"duration_s":30.0}},"#,
            r#"{{"clip_id":"c2","title":"Other angle","kind":"same_moment","score":0.9,"#,
            r#""recorded_at":"2026-10-20T10:00:00.000Z","#,
            r#""thumb_url":"https://signed/users/u1/thumbs/c2/{}.jpg?ttl=3600","duration_s":30.0}}]}}"#
        ),
        thumb.as_str()
    );
    assert!(body.ends_with(&want), "{body}");
    assert!(
        body.contains(r#""near_copy_of":null,"angles":1}"#),
        "{body}"
    );

    let (_, _, copy) = app
        .send(get("/api/clips/c1", Some(&app.cookie_for("u1"))))
        .await;
    assert!(
        copy.contains(r#""kind":"near_copy_of","score":0.94"#),
        "{copy}"
    );
}
