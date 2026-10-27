//! Face match wire format and answer handling against a local fake API.

use std::time::Duration;

use nimbytes_core::ErrorCode;
use serde_json::{Value, json};

use super::*;
use crate::meta::fake_api::fake_api;
use crate::meta::reasoner::reasoner_tests::reasoner;

fn answer(v: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": v.to_string()}]}]})
    .to_string()
}

fn crops() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (dir.path().join("a.jpg"), dir.path().join("b.jpg"));
    std::fs::write(&a, b"AAA").unwrap();
    std::fs::write(&b, b"BB").unwrap();
    (dir, a, b)
}

/// The question, then crop A, then crop B.
fn assert_question_then_crops(body: &Value) {
    let content = body["input"][1]["content"].as_array().unwrap();
    assert_eq!(content.len(), 3);
    assert_eq!(content[0]["type"], "input_text");
    assert!(
        content[0]["text"]
            .as_str()
            .unwrap()
            .starts_with("Are these two crops")
    );
    assert_eq!(
        content[1],
        json!({"type": "input_image", "image_url": "data:image/jpeg;base64,QUFB"})
    );
    assert_eq!(
        content[2],
        json!({"type": "input_image", "image_url": "data:image/jpeg;base64,QkI="})
    );
}

#[tokio::test]
async fn both_crops_go_as_input_images_after_the_question_with_minimal_effort() {
    let ok =
        answer(&json!({"same": true, "confidence": 0.92, "kind": "pet", "reason": "same spots"}));
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let (_dir, a, b) = crops();

    let v = r.same_face(&a, &b).await.unwrap();

    assert_eq!(
        v,
        FaceVerdict {
            same: true,
            confidence: 0.92,
            kind: FaceKind::Pet
        }
    );
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    assert_eq!(
        (
            body["model"].as_str(),
            body["store"].as_bool(),
            body["reasoning"]["effort"].as_str()
        ),
        (Some("muse-spark-1.3"), Some(false), Some("minimal"))
    );
    assert_eq!(body["text"]["format"]["name"], "face_match");
    assert_eq!(body["text"]["format"]["strict"], true);
    assert_question_then_crops(&body);
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(system.contains("Never name or guess who it is"), "{system}");
}

#[tokio::test]
async fn an_answer_outside_the_schema_is_model_unavailable() {
    let bad = answer(&json!({"same": true, "confidence": 0.9, "kind": "robot", "reason": "x"}));
    let (base, _seen) = fake_api(vec![(200, bad.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let (_dir, a, b) = crops();

    let err = r.same_face(&a, &b).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        err.message.contains("face_match answer invalid"),
        "{}",
        err.message
    );
}
