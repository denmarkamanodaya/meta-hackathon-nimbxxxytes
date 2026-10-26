//! Spike 0.3 (throwaway): Muse Voice Transcribe file transcription in `DIARIZATION` mode. Any input
//! media is first converted to RIFF/WAVE mono 16-bit PCM 16 kHz with ffmpeg (the only accepted
//! audio format). Writes the raw response to `data/spikes/transcribe.json`.
//!
//! Run from `api/`: `cargo run -p nimbytes-server --bin spike_transcribe -- <clip.mp4|audio.wav>`

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use nimbytes_server::spike_meta::{
    BASE_URL, Spike, SpikeResult, path_and_flag, read_json, save_json, spikes_dir,
    transcribe_request,
};
use reqwest::multipart::{Form, Part};

#[tokio::main]
async fn main() -> SpikeResult<()> {
    let (input, _) = path_and_flag("usage: spike_transcribe <clip.mp4|audio.wav>", "--none")?;
    let spike = Spike::from_env()?;
    let wav = to_wav(&input).await?;
    let bytes = tokio::fs::read(&wav).await?;
    println!("wav: {} bytes", bytes.len());

    let form = Form::new()
        .part(
            "request",
            Part::text(transcribe_request().to_string()).mime_str("application/json")?,
        )
        .part(
            "audio",
            Part::bytes(bytes)
                .file_name("audio.wav")
                .mime_str("audio/wav")?,
        );
    let started = Instant::now();
    let response = spike
        .http
        .post(format!("{BASE_URL}/asr/transcribe"))
        .bearer_auth(&spike.key)
        .multipart(form)
        .send()
        .await?;
    let json = read_json(response).await?;
    println!("latency: {} ms", started.elapsed().as_millis());
    save_json("transcribe", &json)?;
    println!("audioDurationMs: {}", json["audioDurationMs"]);
    for turn in json["turns"].as_array().into_iter().flatten() {
        println!(
            "[{}-{} ms] {}: {}",
            turn["startMs"], turn["endMs"], turn["speaker"], turn["transcript"]
        );
    }
    Ok(())
}

/// Converts any media to `data/spikes/transcribe_input.wav` (mono, s16le, 16 kHz).
async fn to_wav(input: &Path) -> SpikeResult<PathBuf> {
    let wav = spikes_dir()?.join("transcribe_input.wav");
    let status = tokio::time::timeout(
        Duration::from_secs(120),
        tokio::process::Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(input)
            .args([
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
            ])
            .arg(&wav)
            .kill_on_drop(true)
            .status(),
    )
    .await??;
    if !status.success() {
        return Err(format!("ffmpeg wav conversion failed: {status}").into());
    }
    Ok(wav)
}
