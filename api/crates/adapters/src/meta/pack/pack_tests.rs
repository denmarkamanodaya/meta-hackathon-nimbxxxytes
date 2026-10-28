//! Platform pack: wire format and answer parsing against a local fake API.

use std::time::Duration;

use nimbytes_core::domain::export::Platform;
use serde_json::json;

use super::*;
use crate::meta::fake_api::{client, fake_api};

const PACK_MD: &str = include_str!("../../../../../prompts/platform_pack.md");
const PACK_SCHEMA: &str = include_str!("../../../../../prompts/platform_pack.schema.json");

async fn writer(base: String) -> SparkPackWriter {
    let (client, _pool) = client(base).await;
    let prompt = (
        Template::parse(PACK_MD).unwrap(),
        StrictSchema::parse("platform_pack", PACK_SCHEMA).unwrap(),
    );
    SparkPackWriter::new(client, prompt, Duration::from_secs(10))
}

fn answer(v: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": v.to_string()}]}],
        "usage": {"input_tokens": 900, "output_tokens": 600}})
    .to_string()
}

#[tokio::test]
async fn the_platform_pack_asks_once_for_every_platform_and_reads_each_answer() {
    let packs = json!({"packs": [
        {"platform": "tiktok", "caption": "Dawn run by the water", "hashtags": ["#run", "#dawn", "#pov"]},
        {"platform": "shorts", "caption": "Running at dawn", "hashtags": ["#run", "#shorts", "#pov"]}]});
    let ok = answer(&packs);
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let w = writer(base).await;
    let moments = vec!["A path | by the sea.".to_owned()];
    let request = PackRequest {
        platforms: &[Platform::Tiktok, Platform::Shorts],
        caption: "Morning run",
        hashtags: &["#run".to_owned()],
        moments: &moments,
    };

    let got = w.platform_pack(&request).await.unwrap();

    let platforms: Vec<Platform> = got.iter().map(|a| a.platform).collect();
    assert_eq!(platforms, [Platform::Tiktok, Platform::Shorts]);
    assert_eq!(got[1].caption, "Running at dawn");
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1, "one call for every platform");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["text"]["format"]["name"], "platform_pack");
    assert_eq!(body["reasoning"]["effort"], "low");
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert_eq!(
        user,
        "Platforms: tiktok, shorts\nThe owner's caption: Morning run\nThe owner's hashtags: #run\n\
         \nWhat the shots show, one per line:\n\
         - A path   by the sea."
    );
}
