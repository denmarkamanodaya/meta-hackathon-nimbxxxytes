use std::sync::Arc;

use axum::http::StatusCode;
use futures_util::StreamExt;
use nimbytes_core::domain::short::NewStep;
use nimbytes_testkit::InMemoryShorts;
use nimbytes_testkit::shorts_world::{moment, user};

use super::*;
use crate::http::test_support::{TestApp, get, post_json};

fn step(kind: StepKind, summary: &str) -> NewStep {
    NewStep {
        kind,
        tool: None,
        version: Some(1),
        summary: summary.into(),
        at: "2026-10-27T03:00:01.000Z".into(),
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
async fn the_stream_sends_the_log_so_far_then_new_rows_until_the_final_one() {
    let store = Arc::new(InMemoryShorts::default());
    let id = ShortId::parse("x1").unwrap();
    store
        .add_step(&id, &step(StepKind::Plan, "Open on the pour."))
        .await
        .unwrap();
    let first = store.steps(&id).await.unwrap();
    let writer = store.clone();
    let id2 = id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        let rows = [
            step(StepKind::ToolCall, "Rendering a preview of version 1"),
            step(StepKind::Final, "Showing version 1"),
            step(StepKind::ToolCall, "after the end"),
        ];
        for row in rows {
            writer.add_step(&id2, &row).await.unwrap();
        }
    });

    let got = drain(step_stream(store, id, first, Duration::from_millis(10))).await;

    assert_eq!(got.len(), 3, "{got:?}");
    assert!(
        got[0].contains(r#"{\"seq\":0,\"kind\":\"plan\",\"tool\":null,\"version\":1,\"summary\":\"Open on the pour.\",\"at\":\"2026-10-27T03:00:01.000Z\"}"#),
        "{got:?}"
    );
    assert!(
        got[1].contains(r#"\"seq\":1,\"kind\":\"tool_call\""#),
        "{got:?}"
    );
    assert!(
        got[2].contains(r#"\"seq\":2,\"kind\":\"final\""#),
        "{got:?}"
    );
}

#[tokio::test]
async fn only_the_owner_may_watch_a_short() {
    let app = TestApp::new();
    app.shorts
        .add_moment(moment("s0", "c1", (0.0, 8.0), None), &user("u1"));
    let body = r#"{"segment_ids":["s0"],"aspect":"1:1","target_s":6}"#;
    let cookie = app.cookie_for("u1");
    let (status, _, _) = app
        .send(post_json("/api/shorts", Some(&cookie), body))
        .await;
    assert_eq!(status, StatusCode::OK);

    let other = app.cookie_for("u2");
    let (status, _, _) = app.send(get("/api/shorts/id-1/events", Some(&other))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = app.send(get("/api/shorts/id-1/events", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
