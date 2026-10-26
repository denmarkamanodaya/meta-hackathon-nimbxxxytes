use axum::http::{StatusCode, header};
use futures_util::StreamExt;
use nimbytes_core::ports::{JobQueue, ProgressSink};

use super::*;
use crate::http::test_support::{PASSCODE, TestApp, get, post_json};
use crate::progress::BroadcastProgress;

fn ev(step: &str, status: StepStatus) -> ClipEvent {
    ClipEvent {
        step: step.into(),
        status,
    }
}

/// Collects the `data:` payloads of a finished stream.
async fn drain(s: impl Stream<Item = Result<Event, axum::Error>>) -> Vec<String> {
    let events: Vec<_> = s.collect().await;
    events
        .into_iter()
        .map(|e| format!("{:?}", e.unwrap()))
        .collect()
}

#[tokio::test]
async fn stream_sends_the_snapshot_then_this_clips_events_until_ready_done() {
    let progress = BroadcastProgress::new(16);
    let rx = progress.subscribe();
    progress.emit("other", "probe", StepStatus::Running);
    progress.emit("c1", "probe", StepStatus::Done);
    progress.emit("c1", "ready", StepStatus::Done);
    progress.emit("c1", "probe", StepStatus::Running);

    let got = drain(clip_stream(
        "c1".into(),
        Some(ev("probe", StepStatus::Running)),
        rx,
    ))
    .await;

    assert_eq!(got.len(), 3, "{got:?}");
    assert!(
        got[0].contains(r#"{\"step\":\"probe\",\"status\":\"running\"}"#),
        "{got:?}"
    );
    assert!(
        got[1].contains(r#"{\"step\":\"probe\",\"status\":\"done\"}"#),
        "{got:?}"
    );
    assert!(
        got[2].contains(r#"{\"step\":\"ready\",\"status\":\"done\"}"#),
        "{got:?}"
    );
}

#[tokio::test]
async fn a_failed_step_ends_the_stream_and_a_closed_channel_ends_it_quietly() {
    let progress = BroadcastProgress::new(16);
    let rx = progress.subscribe();
    progress.emit("c1", "transcribe", StepStatus::Failed);
    progress.emit("c1", "describe", StepStatus::Running);
    assert_eq!(drain(clip_stream("c1".into(), None, rx)).await.len(), 1);

    let rx = progress.subscribe();
    drop(progress);
    assert!(drain(clip_stream("c1".into(), None, rx)).await.is_empty());
}

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
    let parts = r#"{"parts":[{"n":1,"etag":"\"e\""}]}"#;
    app.send(post_json(
        "/api/uploads/id-3/complete",
        Some(&cookie),
        parts,
    ))
    .await;
    cookie
}

#[tokio::test]
async fn a_finished_clip_gets_one_ready_done_event_and_the_stream_closes() {
    let app = TestApp::new();
    let cookie = uploaded_clip(&app).await;
    let job = app.jobs.all()[0].job.id.clone();
    app.jobs.done(&job, 0).await.unwrap();

    let (status, headers, body) = app.send(get("/api/clips/id-2/events", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_TYPE], "text/event-stream");
    assert_eq!(body, "data: {\"step\":\"ready\",\"status\":\"done\"}\n\n");
}

#[tokio::test]
async fn events_for_another_users_or_an_unknown_clip_or_without_a_cookie_are_refused() {
    let app = TestApp::new();
    uploaded_clip(&app).await;
    let mallory = app.cookie_for("mallory");

    let (s1, _, _) = app
        .send(get("/api/clips/id-2/events", Some(&mallory)))
        .await;
    let (s2, _, _) = app
        .send(get("/api/clips/nope/events", Some(&mallory)))
        .await;
    let (s3, _, _) = app.send(get("/api/clips/id-2/events", None)).await;

    assert_eq!(
        (s1, s2, s3),
        (
            StatusCode::FORBIDDEN,
            StatusCode::NOT_FOUND,
            StatusCode::UNAUTHORIZED
        )
    );
}
