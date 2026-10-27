//! Clip title wire format and answer handling against a local fake API.

use std::time::Duration;

use nimbytes_core::ErrorCode;
use serde_json::{Value, json};

use super::*;
use crate::meta::fake_api::fake_api;
use crate::meta::reasoner::reasoner_tests::reasoner;

fn answer(title: &str) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": json!({"title": title}).to_string()}]}]})
    .to_string()
}

#[tokio::test]
async fn the_title_call_sends_only_the_descriptions_with_minimal_effort() {
    let ok = answer("Morning coffee pour");
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let descriptions = vec![
        "A barista pours | milk\ninto a latte.".to_owned(),
        "Close-up of the latte art.".to_owned(),
    ];

    let title = r.title(&descriptions).await.unwrap();

    assert_eq!(title, "Morning coffee pour");
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    assert_eq!(
        (
            body["model"].as_str(),
            body["store"].as_bool(),
            body["reasoning"]["effort"].as_str()
        ),
        (Some("muse-spark-1.3"), Some(false), Some("minimal"))
    );
    assert_eq!(body["text"]["format"]["name"], "clip_title");
    assert_eq!(body["text"]["format"]["strict"], true);
    assert_eq!(
        body["text"]["format"]["schema"]["properties"]["title"]["maxLength"],
        32
    );
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert_eq!(
        user,
        "What the video shows, one moment per line:\n\
         - A barista pours   milk into a latte.\n- Close-up of the latte art."
    );
    assert_eq!(
        body["input"][1]["content"].as_array().unwrap().len(),
        1,
        "text only"
    );
}

#[tokio::test]
async fn a_title_longer_than_the_schema_allows_fails_validation() {
    let long = answer("A title that is far too long for the clip card");
    let (base, _seen) = fake_api(vec![(200, long.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let err = r.title(&["A dog sleeps.".to_owned()]).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        err.message.contains("clip_title answer invalid"),
        "{}",
        err.message
    );
}
