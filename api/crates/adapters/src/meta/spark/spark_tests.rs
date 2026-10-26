//! Spark describer wire format and answer handling against a local fake API.

use std::time::Duration;

use nimbytes_core::domain::facts::FactsStatus;
use nimbytes_core::ports::{FactsAttempt, SegmentDescriber, SegmentPrompt};
use serde_json::{Value, json};

use super::*;
use crate::meta::fake_api::{client, fake_api};

/// Recorded Responses API body (reasoning low, strict schema) from the prompt spike.
const OK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/spark/segment_facts_low_response.json"
));
const MD: &str = include_str!("../../../../../prompts/segment_facts.md");
const SCHEMA: &str = include_str!("../../../../../prompts/segment_facts.schema.json");

async fn describer(base: String) -> (SparkDescriber, sqlx::SqlitePool, tempfile::TempDir) {
    let (client, pool) = client(base).await;
    let t = Template::parse(MD).unwrap();
    let s = StrictSchema::parse("segment_facts", SCHEMA).unwrap();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("snippet_1.mp4"), b"\x00\x01\x02mp4").unwrap();
    (
        SparkDescriber::new(
            client,
            (t, s),
            SparkLimits {
                timeout: Duration::from_secs(5),
                concurrency: 4,
            },
        ),
        pool,
        dir,
    )
}

fn prompt(dir: &tempfile::TempDir) -> SegmentPrompt {
    SegmentPrompt {
        snippet: dir.path().join("snippet_1.mp4"),
        start_s: 8.0,
        end_s: 14.75,
        recorded_at: "2026-01-28T05:59:00.000Z".into(),
        transcript: "with food.".into(),
        previous_error: None,
    }
}

/// Wraps `answer` as the assistant output text of a minimal Responses body.
fn reply(answer: &str) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text", "text": answer}]}],
           "usage": {"input_tokens": 100, "output_tokens": 10}})
    .to_string()
}

#[tokio::test]
async fn request_is_spark_standard_tier_store_false_low_effort_strict_schema_with_inline_video() {
    let (base, seen) = fake_api(vec![(200, OK)]).await;
    let (d, _pool, dir) = describer(base).await;

    d.describe_all(&[prompt(&dir)]).await.unwrap();

    let req = seen.lock().unwrap()[0].clone();
    assert_eq!(
        (req.path.as_str(), req.auth.as_str()),
        ("/v1/responses", "Bearer test-key")
    );
    let body: Value = serde_json::from_slice(&req.body).unwrap();
    assert_eq!(body["model"], "muse-spark-1.3");
    assert_eq!(body["store"], false);
    assert_eq!(body["reasoning"], json!({"effort": "low"}));
    let format = &body["text"]["format"];
    assert_eq!(
        (
            format["type"].as_str(),
            format["name"].as_str(),
            format["strict"].as_bool()
        ),
        (Some("json_schema"), Some("segment_facts"), Some(true))
    );
    assert!(format["schema"].get("$schema").is_none() && format["schema"].get("title").is_none());
    assert_eq!(body["input"][0]["role"], "system");
    assert!(
        body["input"][0]["content"][0]["text"]
            .as_str()
            .unwrap()
            .starts_with("You describe one short segment")
    );
    let user = &body["input"][1]["content"];
    assert_eq!(
        user[0]["text"].as_str().unwrap().lines().next().unwrap(),
        "Segment from 8.0 s to 14.8 s of a clip recorded 2026-01-28T05:59:00.000Z."
    );
    assert_eq!(
        user[1],
        json!({"type": "input_video", "video_url": "data:video/mp4;base64,AAECbXA0"})
    );
}

#[tokio::test]
async fn a_valid_recorded_answer_becomes_ok_facts_and_logs_token_cost() {
    let (base, _seen) = fake_api(vec![(200, OK)]).await;
    let (d, pool, dir) = describer(base).await;

    let got = d.describe_all(&[prompt(&dir)]).await.unwrap();

    let FactsAttempt::Valid(f) = &got[0] else {
        panic!("{got:?}")
    };
    assert!(
        f.description.starts_with("An older tan dog"),
        "{}",
        f.description
    );
    assert_eq!(f.status, FactsStatus::Ok);
    let (tokens_in, tokens_out, cost): (i64, i64, f64) =
        sqlx::query_as("SELECT input_tokens, output_tokens, cost_usd FROM model_calls")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((tokens_in, tokens_out), (1924, 611));
    assert!(
        (cost - (1924.0 * 1.25 + 611.0 * 4.25) / 1e6).abs() < 1e-12,
        "{cost}"
    );
}

#[tokio::test]
async fn an_invalid_answer_reports_the_schema_error_and_the_retry_prompt_carries_it() {
    let bad = reply(
        r#"{"description":"x","actions":[],"objects":[],"place":"p","mood":"m","quality":11,"hook_score":1}"#,
    );
    let (base, seen) = fake_api(vec![(200, bad.as_str())]).await;
    let (d, _pool, dir) = describer(base).await;

    let got = d.describe_all(&[prompt(&dir)]).await.unwrap();
    let FactsAttempt::Invalid { error, .. } = &got[0] else {
        panic!("{got:?}")
    };
    assert!(error.contains("/quality"), "{error}");
    let retry = SegmentPrompt {
        previous_error: Some(error.clone()),
        ..prompt(&dir)
    };
    d.describe_all(&[retry]).await.unwrap();

    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[1].body).unwrap();
    let text = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert!(
        text.contains("did not match the schema") && text.contains("/quality"),
        "{text}"
    );
}

#[tokio::test]
async fn the_same_segment_again_is_served_from_the_cache_and_answers_keep_prompt_order() {
    let (base, seen) = fake_api(vec![(200, OK)]).await;
    let (d, _pool, dir) = describer(base).await;
    let p = prompt(&dir);
    let later = SegmentPrompt {
        start_s: 14.75,
        end_s: 21.5,
        ..prompt(&dir)
    };

    let first = d.describe_all(&[p.clone(), later.clone()]).await.unwrap();
    let again = d.describe_all(&[p, later]).await.unwrap();

    assert_eq!(first, again);
    assert_eq!(
        seen.lock().unwrap().len(),
        2,
        "two distinct prompts, then two cache hits"
    );
}
