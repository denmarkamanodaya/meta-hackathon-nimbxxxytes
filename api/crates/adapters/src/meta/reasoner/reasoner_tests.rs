//! Spark reasoner: rewrite and rerank wire format and answer handling against a local fake API.

use std::time::Duration;

use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::search::Candidate;
use nimbytes_core::ports::{Reasoner, RewriteRequest};
use serde_json::{Value, json};

use super::*;
use crate::meta::fake_api::{client, fake_api};

const REWRITE_OK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/spark/query_rewrite_minimal_response.json"
));
const RERANK_OK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/spark/rerank_minimal_response.json"
));
const REWRITE_MD: &str = include_str!("../../../../../prompts/query_rewrite.md");
const REWRITE_SCHEMA: &str = include_str!("../../../../../prompts/query_rewrite.schema.json");
const RERANK_MD: &str = include_str!("../../../../../prompts/rerank.md");
const RERANK_SCHEMA: &str = include_str!("../../../../../prompts/rerank.schema.json");
const PLAN_MD: &str = include_str!("../../../../../prompts/plan_edit.md");
const PLAN_SCHEMA: &str = include_str!("../../../../../prompts/timeline.schema.json");
const CRITIQUE_MD: &str = include_str!("../../../../../prompts/critique.md");
const CRITIQUE_SCHEMA: &str = include_str!("../../../../../prompts/critique.schema.json");

/// A reasoner on the real prompt files talking to `base`; every call is capped at `timeout`.
pub(crate) async fn reasoner(base: String, timeout: Duration) -> SparkReasoner {
    let (client, _pool) = client(base).await;
    let prompts = ReasonerPrompts {
        rewrite: (
            Template::parse(REWRITE_MD).unwrap(),
            StrictSchema::parse("query_rewrite", REWRITE_SCHEMA).unwrap(),
        ),
        rerank: (
            Template::parse(RERANK_MD).unwrap(),
            serde_json::from_str(RERANK_SCHEMA).unwrap(),
        ),
        plan: (
            Template::parse(PLAN_MD).unwrap(),
            serde_json::from_str(PLAN_SCHEMA).unwrap(),
        ),
        critique: (
            Template::parse(CRITIQUE_MD).unwrap(),
            StrictSchema::parse("critique", CRITIQUE_SCHEMA).unwrap(),
        ),
    };
    let timeouts = ReasonerTimeouts {
        search: timeout,
        plan: timeout,
    };
    SparkReasoner::new(client, prompts, timeouts)
}

fn request() -> RewriteRequest {
    RewriteRequest {
        query: "my dog sleeping on the couch".into(),
        today: "2026-10-27 (Tuesday)".into(),
        people: vec!["Bruno".into(), "Ana Reyes".into()],
        speakers: vec![],
    }
}

fn cand(id: &str) -> Candidate {
    Candidate {
        segment_id: SegmentId::parse(id).unwrap(),
        clip_id: ClipId::parse("c1").unwrap(),
        clip_filename: "a.mov".into(),
        start_s: 0.0,
        end_s: 5.0,
        recorded_at: None,
        description: "An older tan dog | rests\nits head.".into(),
        place: "living room sofa".into(),
        people: vec!["Bruno".into()],
        speakers: vec![],
        speech: String::new(),
        quality: Some(5),
    }
}

#[tokio::test]
async fn rewrite_sends_minimal_effort_store_false_and_the_filled_prompt_then_parses_the_answer() {
    let (base, seen) = fake_api(vec![(200, REWRITE_OK)]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let out = r.rewrite(&request()).await.unwrap();

    assert_eq!(out.keywords, ["dog", "sleeping", "couch", "sofa"]);
    assert!(out.filters.people.is_empty() && out.filters.from.is_none());
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    assert_eq!(
        (
            body["store"].as_bool(),
            body["reasoning"]["effort"].as_str()
        ),
        (Some(false), Some("minimal"))
    );
    assert_eq!(body["model"], "muse-spark-1.3");
    assert_eq!(body["text"]["format"]["name"], "query_rewrite");
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert_eq!(
        user,
        "Today is 2026-10-27 (Tuesday).\nKnown people: Bruno, Ana Reyes\nKnown speakers: (none)\nSearch request: my dog sleeping on the couch"
    );
}

#[tokio::test]
async fn rerank_limits_ids_to_the_candidates_with_an_enum_and_sends_clean_lines() {
    let (base, seen) = fake_api(vec![(200, RERANK_OK)]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let cands = [cand("dog_0"), cand("dog_1"), cand("dog_2")];

    let picks = r.rerank("my dog sleeping", &cands).await.unwrap();

    let order: Vec<&str> = picks.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(order, ["dog_2", "dog_0", "dog_1"]);
    assert!(picks[0].1.starts_with("Tan dog"));
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    let id_schema = &body["text"]["format"]["schema"]["properties"]["results"]["items"]["properties"]
        ["segment_id"];
    assert_eq!(id_schema["enum"], json!(["dog_0", "dog_1", "dog_2"]));
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert!(
        user.contains(
            "dog_0 | unknown | An older tan dog   rests its head. | living room sofa | Bruno | -"
        ),
        "{user}"
    );
}

#[tokio::test]
async fn an_answer_with_an_id_outside_the_candidates_fails_validation() {
    let bad = json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": "{\"results\":[{\"segment_id\":\"ghost\",\"reason\":\"x\"}]}"}]}]})
    .to_string();
    let (base, _seen) = fake_api(vec![(200, bad.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let err = r.rerank("q", &[cand("dog_0")]).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        err.message.contains("rerank answer invalid"),
        "{}",
        err.message
    );
}

#[tokio::test]
async fn the_whole_call_is_capped_by_the_timeout_even_with_retries() {
    let (base, seen) = fake_api(vec![(503, "down")]).await;
    let r = reasoner(base, Duration::from_millis(1)).await;

    let err = r.rerank("q", &[cand("dog_0")]).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        seen.lock().unwrap().len() <= 1,
        "gave up instead of retrying past the cap"
    );
}
