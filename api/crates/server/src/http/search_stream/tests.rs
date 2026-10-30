use axum::http::{StatusCode, header};
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::index::DocScope;
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::search::{Rewritten, SearchFilters};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::{Catalogue, TextIndex};
use nimbytes_testkit::world::facts;

use super::*;
use crate::http::test_support::{TestApp, post_json};

/// Clip c1 of u1: c1-s0 is a dog on the sofa, c1-s1 is Sam at the beach; both indexed.
async fn library(app: &TestApp) {
    let id = ClipId::parse("c1").unwrap();
    app.catalogue.put_clip(Clip {
        id: id.clone(),
        user_id: UserId::parse("u1").unwrap(),
        filename: "a.mov".into(),
        ext: MediaExt::Mov,
        size_bytes: 1,
        status: ClipStatus::Ready,
        probe: None,
        created_at: "2026-10-27T00:00:00.000Z".into(),
        title: None,
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    });
    let segs: Vec<Segment> = (0..2u32)
        .map(|i| Segment {
            id: SegmentId::parse(format!("c1-s{i}")).unwrap(),
            clip_id: id.clone(),
            idx: i,
            span: Span {
                start_s: f64::from(i) * 7.0,
                end_s: f64::from(i + 1) * 7.0,
            },
        })
        .collect();
    app.catalogue.replace_segments(&id, &segs).await.unwrap();
    for (s, t) in segs
        .iter()
        .zip(["A dog sleeps on a sofa.", "Sam laughs at a beach."])
    {
        app.catalogue
            .set_segment_facts(&s.id, &facts(t))
            .await
            .unwrap();
    }
    let docs = app.catalogue.index_docs(DocScope::Clip(&id)).await.unwrap();
    app.text.upsert(&docs).await.unwrap();
}

fn result(seg: &str, start: u32, reason: Option<&str>) -> String {
    let reason = reason.map_or("null".to_owned(), |r| format!(r#""{r}""#));
    format!(
        r#"{{"kind":"moment","photo_id":null,"segment_id":"c1-{seg}","clip_id":"c1","start_s":{start}.0,"end_s":{end}.0,"score":0.01639344262295082,"thumb_url":"https://signed/users/u1/thumbs/c1/c1-{seg}.jpg?ttl=3600","reason":{reason},"clip_filename":"a.mov","clip_title":"a","recorded_at":null,"faces":[]}}"#,
        end = start + 7
    )
}

const NO_FILTERS: &str = r#""filters":{"people":[],"speakers":[],"place":null,"from":null,"to":null,"min_quality":null}"#;

#[tokio::test]
async fn the_stream_sends_local_then_ranked_then_done_as_exact_frames() {
    let app = TestApp::new();
    library(&app).await;
    app.reasoner.rewrites_to(Rewritten {
        keywords: vec!["beach".into()],
        filters: SearchFilters::default(),
    });
    app.reasoner
        .reranks_to(vec![("c1-s1", "Sam laughing at the beach")]);
    let cookie = app.cookie_for("u1");

    let (status, headers, body) = app
        .send(post_json(
            "/api/search/stream",
            Some(&cookie),
            r#"{"query":"  Sofa "}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(headers[header::CONTENT_TYPE], "text/event-stream");
    let local = format!(
        r#"{{"rewritten":{{"keywords":["sofa"],{NO_FILTERS}}},"results":[{}],"reranked":false,"took_ms":0,"cached":false,"cost_usd":0.0}}"#,
        result("s0", 0, None)
    );
    let ranked = format!(
        r#"{{"rewritten":{{"keywords":["beach"],{NO_FILTERS}}},"results":[{}],"reranked":true,"took_ms":0,"cached":false,"cost_usd":0.0}}"#,
        result("s1", 7, Some("Sam laughing at the beach"))
    );
    assert_eq!(
        body,
        format!(
            "event: local\ndata: {local}\n\nevent: ranked\ndata: {ranked}\n\nevent: done\ndata: {{}}\n\n"
        )
    );
    assert_eq!(app.reasoner.rerank_queries(), ["sofa"]);
}

#[tokio::test]
async fn ranked_is_byte_for_byte_what_the_plain_search_answers() {
    let app = TestApp::new();
    library(&app).await;
    app.reasoner.reranks_to(vec![("c1-s0", "Dog asleep")]);
    let cookie = app.cookie_for("u1");
    let body = r#"{"query":"dog"}"#;

    let (_, _, plain) = app
        .send(post_json("/api/search", Some(&cookie), body))
        .await;
    let (_, _, streamed) = app
        .send(post_json("/api/search/stream", Some(&cookie), body))
        .await;

    assert!(
        streamed.contains(&format!("event: ranked\ndata: {plain}\n\n")),
        "{streamed}"
    );
}

#[tokio::test]
async fn a_refused_query_or_no_session_is_a_plain_error_response_not_a_stream() {
    let app = TestApp::new();
    let cookie = app.cookie_for("u1");

    let (s1, h1, b1) = app
        .send(post_json(
            "/api/search/stream",
            Some(&cookie),
            r#"{"query":"   "}"#,
        ))
        .await;
    let (s2, _, _) = app
        .send(post_json("/api/search/stream", None, r#"{"query":"dog"}"#))
        .await;

    assert_eq!(s1, StatusCode::BAD_REQUEST);
    assert_eq!(h1[header::CONTENT_TYPE], "application/json");
    assert_eq!(
        b1,
        r#"{"error":{"code":"VALIDATION_FAILED","message":"query must be 1 to 300 characters"}}"#
    );
    assert_eq!(s2, StatusCode::UNAUTHORIZED);
}

/// The frames a finished stream sends, as the wire carries them.
async fn wire_frames(s: impl Stream<Item = Result<Event, axum::Error>> + Send + 'static) -> String {
    let body = axum::response::IntoResponse::into_response(Sse::new(s)).into_body();
    let bytes = axum::body::to_bytes(body, 1 << 20).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn empty_outcome() -> SearchOutcome {
    SearchOutcome {
        rewritten: Rewritten::default(),
        results: Vec::new(),
        reranked: false,
        took_ms: 3,
        cached: false,
        cost_usd: 0.0,
    }
}

#[tokio::test]
async fn a_ranked_stage_failure_is_an_error_event_that_hides_internal_detail() {
    let (tx, rx) = unbounded_channel();
    tx.send(Stage::Ranked(Err(AppError::new(
        ErrorCode::Internal,
        "db path /data/x",
    ))))
    .unwrap();

    let got = wire_frames(frames(empty_outcome(), rx)).await;

    assert_eq!(
        got,
        concat!(
            "event: local\n",
            r#"data: {"rewritten":{"keywords":[],"filters":{"people":[],"speakers":[],"place":null,"from":null,"to":null,"min_quality":null}},"results":[],"reranked":false,"took_ms":3,"cached":false,"cost_usd":0.0}"#,
            "\n\nevent: error\n",
            r#"data: {"error":{"code":"INTERNAL","message":"internal error"}}"#,
            "\n\nevent: done\ndata: {}\n\n"
        )
    );
}

#[tokio::test]
async fn a_search_task_that_stops_without_an_answer_is_an_error_event() {
    let (tx, rx) = unbounded_channel::<Stage>();
    drop(tx);

    let got = wire_frames(frames(empty_outcome(), rx)).await;

    assert!(
        got.contains(
            "event: error\ndata: {\"error\":{\"code\":\"INTERNAL\",\"message\":\"internal error\"}}\n\nevent: done"
        ),
        "{got}"
    );
}
