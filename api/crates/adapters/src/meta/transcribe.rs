//! [`Transcriber`] on Muse Voice Transcribe: `POST /asr/transcribe`, multipart with a `request`
//! JSON part (`mode: DIARIZATION`) and an `audio` WAV part.

use std::path::Path;
use std::time::Duration;

use nimbytes_core::domain::cost::Usage;
use nimbytes_core::domain::transcript::RawTurn;
use nimbytes_core::ports::{PortResult, Transcriber};
use nimbytes_core::{AppError, ErrorCode};
use reqwest::multipart::{Form, Part};
use serde_json::{Value, json};

use super::{MetaCall, MetaClient, json_body};

/// Model id.
pub const MODEL: &str = "muse-voice-transcribe-1.0";

/// Diarized file transcription.
#[derive(Clone)]
pub struct MetaTranscriber {
    client: MetaClient,
    timeout: Duration,
}

impl MetaTranscriber {
    /// Uses `client`, giving each attempt `timeout`.
    pub fn new(client: MetaClient, timeout: Duration) -> Self {
        Self { client, timeout }
    }
}

/// The `request` part.
pub fn request_json() -> String {
    json!({ "mode": "DIARIZATION", "model": MODEL, "audioEncoding": "WAV" }).to_string()
}

fn form(request: &str, wav: &[u8]) -> Result<Form, reqwest::Error> {
    Ok(Form::new()
        .part(
            "request",
            Part::text(request.to_owned()).mime_str("application/json")?,
        )
        .part(
            "audio",
            Part::bytes(wav.to_vec())
                .file_name("audio.wav")
                .mime_str("audio/wav")?,
        ))
}

fn usage(body: &str) -> Option<Usage> {
    let v: Value = serde_json::from_str(body).ok()?;
    v["audioDurationMs"]
        .as_u64()
        .map(|ms| Usage::AudioSeconds(ms as f64 / 1000.0))
}

/// Maps the response's `turns` to raw turns (times stay chunk-relative).
///
/// # Errors
/// `MODEL_UNAVAILABLE` when `turns` is missing or a turn lacks its times or text.
pub fn turns(v: &Value) -> Result<Vec<RawTurn>, AppError> {
    let bad = || {
        AppError::new(
            ErrorCode::ModelUnavailable,
            "transcribe response has no valid turns",
        )
    };
    v["turns"]
        .as_array()
        .ok_or_else(bad)?
        .iter()
        .map(|t| {
            Ok(RawTurn {
                start_ms: t["startMs"].as_u64().ok_or_else(bad)?,
                end_ms: t["endMs"].as_u64().ok_or_else(bad)?,
                text: t["transcript"].as_str().ok_or_else(bad)?.to_owned(),
                speaker: t["speaker"].as_str().map(str::to_owned),
            })
        })
        .collect()
}

impl Transcriber for MetaTranscriber {
    fn transcribe<'a>(&'a self, wav: &'a Path) -> PortResult<'a, Vec<RawTurn>> {
        Box::pin(async move {
            let bytes = tokio::fs::read(wav)
                .await
                .map_err(|e| AppError::new(ErrorCode::Internal, format!("reading wav: {e}")))?;
            let request = request_json();
            let build = |http: &reqwest::Client, base: &str| {
                let form = form(&request, &bytes).map_err(|e| e.to_string())?;
                Ok(http.post(format!("{base}/asr/transcribe")).multipart(form))
            };
            let call = MetaCall {
                model: MODEL,
                purpose: "transcribe",
                timeout: self.timeout,
                fingerprint: &[request.as_bytes(), &bytes],
                build: &build,
                usage,
            };
            turns(&json_body(&self.client.call(call).await?)?)
        })
    }
}
