//! Spike 0.2 (throwaway): stream SAM 3.1 `"face"` segmentation over a 1 fps mp4. Writes every raw
//! SSE line to `data/spikes/sam_sse.txt`, the concatenated text deltas (one per frame) to
//! `data/spikes/sam_raw.txt`, and the final `response.completed` event to `data/spikes/sam.json`.
//!
//! Make the 1 fps input first (SAM bills every frame and has no fps option):
//! `ffmpeg -i clip.mp4 -vf fps=1 -c:v libx264 -an clip_fps1.mp4`
//! Run from `api/`: `cargo run -p nimbytes-server --bin spike_sam -- <clip_fps1.mp4> [--files-api]`

use std::fmt::Write as _;
use std::time::Instant;

use nimbytes_server::spike_meta::{
    BASE_URL, SAM_MODEL, Spike, SpikeResult, path_and_flag, responses_body, save_json, spikes_dir,
};
use serde_json::{Value, json};

#[tokio::main]
async fn main() -> SpikeResult<()> {
    let (path, files_api) = path_and_flag(
        "usage: spike_sam <clip_fps1.mp4> [--files-api]",
        "--files-api",
    )?;
    let spike = Spike::from_env()?;
    let video = spike.video_part(&path, files_api).await?;
    let mut body = responses_body(SAM_MODEL, "face", video, true);
    body["metadata"] = json!({ "include_confidence": "true" });

    let started = Instant::now();
    let mut response = spike
        .http
        .post(format!("{BASE_URL}/responses"))
        .bearer_auth(&spike.key)
        .json(&body)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}: {}", response.status(), response.text().await?).into());
    }
    let mut sse = String::new();
    while let Some(chunk) = response.chunk().await? {
        sse.push_str(&String::from_utf8_lossy(&chunk));
    }
    println!(
        "stream finished: {} ms, {} bytes",
        started.elapsed().as_millis(),
        sse.len()
    );
    summarise(&sse)
}

/// Splits the SSE text into events, writes the raw files and prints per-frame object ordinals.
fn summarise(sse: &str) -> SpikeResult<()> {
    let dir = spikes_dir()?;
    std::fs::write(dir.join("sam_sse.txt"), sse)?;
    let mut deltas = String::new();
    let mut frames = 0usize;
    for data in sse
        .lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .map(str::trim)
    {
        if data == "[DONE]" {
            continue;
        }
        let event: Value = serde_json::from_str(data)?;
        match event["type"].as_str() {
            Some("response.output_text.delta") => {
                let delta = event["delta"].as_str().unwrap_or_default();
                frames += 1;
                writeln!(deltas, "{delta}")?;
                println!("delta {frames}: {}", preview(delta));
            }
            Some("response.completed") => {
                save_json("sam", &event)?;
                println!("usage: {}", event["response"]["usage"]);
            }
            other => println!("event {other:?}"),
        }
    }
    std::fs::write(dir.join("sam_raw.txt"), &deltas)?;
    println!(
        "{frames} delta events -> {}",
        dir.join("sam_raw.txt").display()
    );
    Ok(())
}

/// First 160 chars with mask payloads cut, so the console shows frame markers and boxes.
fn preview(delta: &str) -> String {
    let cut: String = delta
        .split("<|mask")
        .map(|s| s.split_once("|>").map_or(s, |(_, rest)| rest))
        .collect::<Vec<_>>()
        .join("<mask>");
    cut.chars().take(160).collect()
}
