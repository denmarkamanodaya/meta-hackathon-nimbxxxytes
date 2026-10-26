//! Spike 0.1 (throwaway): send one short mp4 segment to Muse Spark and ask for segment-facts JSON.
//! Prints latency and `usage`; writes the raw response to `data/spikes/spark.json`.
//!
//! Run from `api/`: `set -a; . ../.env; set +a;`
//! `cargo run -p nimbytes-server --bin spike_spark -- <segment.mp4> [--files-api]`
//! Default sends the video inline as a base64 data URL; `--files-api` uploads it first and sends
//! the `file_id`.

use nimbytes_server::spike_meta::{
    SPARK_MODEL, Spike, SpikeResult, path_and_flag, responses_body, save_json,
};

const PROMPT: &str = "You are given one short segment of a first-person video. Reply with ONLY a \
JSON object, no prose, with keys: description (one or two concrete present-tense sentences), \
actions (array of short strings), objects (array of short strings), place (string), mood \
(string), quality (integer 0-10, visual quality), hook_score (integer 0-10, how strong an \
opening shot for a short video this would be).";

#[tokio::main]
async fn main() -> SpikeResult<()> {
    let (path, files_api) = path_and_flag(
        "usage: spike_spark <segment.mp4> [--files-api]",
        "--files-api",
    )?;
    let spike = Spike::from_env()?;
    let video = spike.video_part(&path, files_api).await?;
    let body = responses_body(SPARK_MODEL, PROMPT, video, false);
    let (response, latency) = spike.post_responses(&body).await?;
    save_json(
        if files_api {
            "spark_files_api"
        } else {
            "spark"
        },
        &response,
    )?;
    println!("latency: {} ms", latency.as_millis());
    println!("usage: {}", response["usage"]);
    println!("output text: {}", output_text(&response));
    Ok(())
}

/// Concatenates every `output[].content[].text`; the response shape is still unverified, so the
/// raw JSON is saved as well.
fn output_text(response: &serde_json::Value) -> String {
    if let Some(text) = response["output_text"].as_str() {
        return text.to_owned();
    }
    response["output"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["content"].as_array())
        .flatten()
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join("")
}
