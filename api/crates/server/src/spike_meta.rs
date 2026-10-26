//! Throwaway plumbing shared by the Phase 0 Meta spike binaries (`spike_spark`, `spike_sam`,
//! `spike_transcribe`). Deleted or folded into the Meta adapter by Phase 3; production code never
//! calls it. Request bodies are built by pure functions so their wire shape is unit-tested.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{Value, json};

/// Boxed error for spike binaries.
pub type SpikeResult<T> = Result<T, Box<dyn std::error::Error>>;

/// Meta Model API base URL.
pub const BASE_URL: &str = "https://api.meta.ai/v1";
/// Muse Spark, standard tier only (never a `-contributor` id: that tier trains on prompts).
pub const SPARK_MODEL: &str = "muse-spark-1.3";
/// SAM 3.1 segmentation.
pub const SAM_MODEL: &str = "sam-3.1";
/// Muse Voice Transcribe.
pub const TRANSCRIBE_MODEL: &str = "muse-voice-transcribe-1.0";
/// Per-request timeout; a long clip through SAM streams for a while.
pub const TIMEOUT: Duration = Duration::from_secs(300);

/// API key and HTTP client, read once at spike start.
#[derive(Debug, Clone)]
pub struct Spike {
    /// Value of `MODEL_API_KEY`.
    pub key: String,
    /// Shared HTTP client with [`TIMEOUT`].
    pub http: reqwest::Client,
}

impl Spike {
    /// Reads `MODEL_API_KEY` (spike binaries only; the server reads env in `composition.rs`).
    ///
    /// # Errors
    /// When the key is missing or the client cannot be built.
    pub fn from_env() -> SpikeResult<Self> {
        let key = std::env::var("MODEL_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
            .ok_or("MODEL_API_KEY is not set (put it in .env and `set -a; . ../.env`)")?;
        let http = reqwest::Client::builder().timeout(TIMEOUT).build()?;
        Ok(Self { key, http })
    }

    /// Uploads a file through `POST /v1/files` (`purpose=user_data`) and returns its `file_id`.
    ///
    /// # Errors
    /// On IO, HTTP or a response without an `id`.
    pub async fn upload_file(&self, path: &Path, mime: &str) -> SpikeResult<String> {
        let bytes = tokio::fs::read(path).await?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("upload.bin")
            .to_owned();
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(name)
            .mime_str(mime)?;
        // The docs ask for `purpose` before the `file` part.
        let form = reqwest::multipart::Form::new()
            .text("purpose", "user_data")
            .part("file", part);
        let started = Instant::now();
        let response = self
            .http
            .post(format!("{BASE_URL}/files"))
            .bearer_auth(&self.key)
            .multipart(form)
            .send()
            .await?;
        let body = read_json(response).await?;
        println!(
            "files upload: {} ms -> {body}",
            started.elapsed().as_millis()
        );
        Ok(body["id"]
            .as_str()
            .ok_or("upload response has no id")?
            .to_owned())
    }

    /// Builds the `input_video` part: a base64 data URL, or a `file_id` when `files_api` is set.
    ///
    /// # Errors
    /// On IO or upload failure.
    pub async fn video_part(&self, path: &Path, files_api: bool) -> SpikeResult<Value> {
        if files_api {
            let file_id = self.upload_file(path, "video/mp4").await?;
            Ok(video_file_part(&file_id))
        } else {
            let bytes = tokio::fs::read(path).await?;
            println!("inline video: {} bytes before base64", bytes.len());
            Ok(video_url_part(&data_url("video/mp4", &bytes)))
        }
    }

    /// POSTs a JSON body to `/v1/responses` and returns the parsed JSON plus latency.
    ///
    /// # Errors
    /// On HTTP failure or a non-JSON body.
    pub async fn post_responses(&self, body: &Value) -> SpikeResult<(Value, Duration)> {
        let started = Instant::now();
        let response = self
            .http
            .post(format!("{BASE_URL}/responses"))
            .bearer_auth(&self.key)
            .json(body)
            .send()
            .await?;
        let json = read_json(response).await?;
        Ok((json, started.elapsed()))
    }
}

/// Returns the body as JSON, or the status and raw text as the error.
///
/// # Errors
/// On a non-2xx status or a body that is not JSON.
pub async fn read_json(response: reqwest::Response) -> SpikeResult<Value> {
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(format!("HTTP {status}: {text}").into());
    }
    Ok(serde_json::from_str(&text)?)
}

/// `data:<mime>;base64,<…>` URL for inline media.
pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// `{ "type": "input_video", "video_url": url }`.
pub fn video_url_part(url: &str) -> Value {
    json!({ "type": "input_video", "video_url": url })
}

/// `{ "type": "input_video", "file_id": id }` for a Files API upload.
pub fn video_file_part(file_id: &str) -> Value {
    json!({ "type": "input_video", "file_id": file_id })
}

/// Responses API body: one user message with a text part and a video part.
pub fn responses_body(model: &str, text: &str, video: Value, stream: bool) -> Value {
    json!({
        "model": model,
        "stream": stream,
        "input": [{
            "type": "message",
            "role": "user",
            "content": [ { "type": "input_text", "text": text }, video ],
        }],
    })
}

/// The `request` part of `POST /v1/asr/transcribe` in diarization mode.
pub fn transcribe_request() -> Value {
    json!({ "mode": "DIARIZATION", "model": TRANSCRIBE_MODEL, "audioEncoding": "WAV" })
}

/// `<repo>/data/spikes/`, created if missing; spike output never lands in the source tree.
///
/// # Errors
/// When the directory cannot be created.
pub fn spikes_dir() -> SpikeResult<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/spikes");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Writes `value` pretty-printed to `data/spikes/<name>.json` and returns the path.
///
/// # Errors
/// On IO or serialisation failure.
pub fn save_json(name: &str, value: &Value) -> SpikeResult<PathBuf> {
    let path = spikes_dir()?.join(format!("{name}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(value)? + "\n")?;
    println!("raw response -> {}", path.display());
    Ok(path)
}

/// Splits CLI args into the first positional path and whether `flag` is present.
///
/// # Errors
/// When no path argument is given.
pub fn path_and_flag(usage: &str, flag: &str) -> SpikeResult<(PathBuf, bool)> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has_flag = args.iter().any(|a| a == flag);
    let path = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .ok_or(usage.to_owned())?;
    Ok((PathBuf::from(path), has_flag))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spark_body_matches_the_documented_responses_shape() {
        let body = responses_body(
            SPARK_MODEL,
            "Describe.",
            video_url_part("data:video/mp4;base64,AAEC"),
            false,
        );
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            concat!(
                r#"{"input":[{"content":[{"text":"Describe.","type":"input_text"},"#,
                r#"{"type":"input_video","video_url":"data:video/mp4;base64,AAEC"}],"#,
                r#""role":"user","type":"message"}],"model":"muse-spark-1.3","stream":false}"#
            )
        );
    }

    #[test]
    fn file_part_carries_the_file_id_on_an_input_video_part() {
        assert_eq!(
            serde_json::to_string(&video_file_part("file-1")).unwrap(),
            r#"{"file_id":"file-1","type":"input_video"}"#
        );
    }

    #[test]
    fn data_url_is_base64_with_the_mime_prefix() {
        assert_eq!(
            data_url("video/mp4", &[0, 1, 2]),
            "data:video/mp4;base64,AAEC"
        );
    }

    #[test]
    fn transcribe_request_asks_for_diarization() {
        assert_eq!(
            serde_json::to_string(&transcribe_request()).unwrap(),
            r#"{"audioEncoding":"WAV","mode":"DIARIZATION","model":"muse-voice-transcribe-1.0"}"#
        );
    }
}
