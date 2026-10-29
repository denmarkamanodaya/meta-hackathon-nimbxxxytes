//! Spark guide writer: the exact request (standard tier, `store: false`, low effort, strict
//! `guide_steps` schema, inline video, transcript) and the answer mapping, against a local fake.

use std::time::Duration;

use base64::Engine;
use serde_json::{Value, json};

use super::*;
use crate::meta::fake_api::{client, fake_api};

const MD: &str = include_str!("../../../../../prompts/guide_steps.md");
const SCHEMA: &str = include_str!("../../../../../prompts/guide_steps.schema.json");

async fn writer(base: String) -> (SparkGuideWriter, sqlx::SqlitePool, tempfile::TempDir) {
    let (client, pool) = client(base).await;
    let prompt = (
        Template::parse(MD).unwrap(),
        StrictSchema::parse("guide_steps", SCHEMA).unwrap(),
    );
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("guide_360p.mp4"), b"\x00\x01mp4").unwrap();
    (
        SparkGuideWriter::new(client, prompt, Duration::from_secs(5)),
        pool,
        dir,
    )
}

fn answer() -> Value {
    json!({
        "safety": "caution",
        "safety_reason": " Hot water. ",
        "title": "Start a quick wash",
        "steps": [
            {"title": "Choose the program", "instruction": "Turn the dial to Quick Wash.",
             "start_s": 2.5, "end_s": 9.0, "key_s": 6.0, "control": "round dial"},
            {"title": "Start", "instruction": "Press the start button.",
             "start_s": 9.0, "end_s": 14.0, "key_s": 11.0, "control": ""}
        ]
    })
}

fn reply(answer: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text", "text": answer.to_string()}]}],
           "usage": {"input_tokens": 100, "output_tokens": 10}})
    .to_string()
}

#[tokio::test]
async fn the_request_sends_the_clip_inline_with_the_transcript_and_the_strict_schema() {
    let ok = reply(&answer());
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let (w, _pool, dir) = writer(base).await;
    let video = dir.path().join("guide_360p.mp4");
    let request = GuideRequest {
        video: &video,
        duration_s: 42.0,
        transcript: "[1.0–3.0] turn it to quick".into(),
    };

    w.write_steps(&request).await.unwrap();

    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].path, "/v1/responses");
    assert_eq!(seen[0].auth, "Bearer test-key");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["model"], "muse-spark-1.3");
    assert_eq!(body["store"], false);
    assert_eq!(body["reasoning"], json!({"effort": "low"}));
    let format = &body["text"]["format"];
    assert_eq!(
        (&format["type"], &format["name"], &format["strict"]),
        (&json!("json_schema"), &json!("guide_steps"), &json!(true))
    );
    assert_eq!(format["schema"]["additionalProperties"], false);
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(
        system.starts_with("You turn a video of someone doing a familiar household task"),
        "{system}"
    );
    let user = &body["input"][1]["content"];
    assert_eq!(
        user[0]["text"],
        "The video is 42.0 seconds long.\nWhat the person says, one line per turn with its \
         seconds:\n[1.0–3.0] turn it to quick\nMake the guide."
    );
    let b64 = base64::engine::general_purpose::STANDARD.encode(b"\x00\x01mp4");
    assert_eq!(user[1]["type"], "input_video");
    assert_eq!(user[1]["video_url"], format!("data:video/mp4;base64,{b64}"));
    assert_eq!(body["input"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn the_answer_becomes_a_draft_with_trimmed_texts() {
    let ok = reply(&answer());
    let (base, _seen) = fake_api(vec![(200, ok.as_str())]).await;
    let (w, _pool, dir) = writer(base).await;
    let video = dir.path().join("guide_360p.mp4");
    let request = GuideRequest {
        video: &video,
        duration_s: 42.0,
        transcript: "(no speech)".into(),
    };

    let draft = w.write_steps(&request).await.unwrap();

    assert_eq!(draft.safety, Safety::Caution);
    assert_eq!(draft.safety_reason, "Hot water.");
    assert_eq!(draft.title, "Start a quick wash");
    assert_eq!(
        draft.steps[0],
        DraftStep {
            title: "Choose the program".into(),
            instruction: "Turn the dial to Quick Wash.".into(),
            start_s: 2.5,
            end_s: 9.0,
            key_s: 6.0,
            control: "round dial".into(),
        }
    );
    assert_eq!(draft.steps[1].control, "");
}

#[tokio::test]
async fn an_answer_outside_the_schema_is_model_unavailable() {
    let mut bad = answer();
    bad["safety"] = json!("risky");
    let bad = reply(&bad);
    let (base, _seen) = fake_api(vec![(200, bad.as_str())]).await;
    let (w, _pool, dir) = writer(base).await;
    let video = dir.path().join("guide_360p.mp4");
    let request = GuideRequest {
        video: &video,
        duration_s: 42.0,
        transcript: "(no speech)".into(),
    };

    let err = w.write_steps(&request).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(err.message.contains("/safety"), "{}", err.message);
}
