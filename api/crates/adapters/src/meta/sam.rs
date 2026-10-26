//! [`FaceTracker`] on SAM 3.1: the noun phrase `face` over the 1 fps copy, streamed. Each
//! `response.output_text.delta` carries detection text such as
//! `<12f>0<|box;x1=430;y1=169;x2=454;y2=196;w=480;h=640;c=0.71|><|mask;…|>` (one line per
//! detection, only frames with detections); [`DetectionParser`] turns that text into detections
//! however the deltas split it.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use nimbytes_core::domain::cost::Usage;
use nimbytes_core::domain::faces::{BoxPx, Detection};
use nimbytes_core::ports::{FaceTracker, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::{MetaCall, MetaClient};

/// Model id.
pub const MODEL: &str = "sam-3.1";
/// Noun phrase sent as the concept prompt.
pub const CONCEPT: &str = "face";

/// SAM face tracker.
#[derive(Clone)]
pub struct SamFaceTracker {
    client: MetaClient,
    timeout: Duration,
}

impl SamFaceTracker {
    /// Uses `client`, giving each attempt `timeout`.
    pub fn new(client: MetaClient, timeout: Duration) -> Self {
        Self { client, timeout }
    }
}

/// Request body for `video_url` (a data URL in production).
pub fn body(video_url: &str) -> Value {
    json!({
        "model": MODEL,
        "stream": true,
        "metadata": { "include_confidence": "true" },
        "input": [{ "type": "message", "role": "user", "content": [
            { "type": "input_text", "text": CONCEPT },
            { "type": "input_video", "video_url": video_url },
        ] }],
    })
}

/// Incremental parser: feed any split of the delta text, get each detection once its line ends.
#[derive(Debug, Default)]
pub struct DetectionParser {
    pending: String,
}

impl DetectionParser {
    /// Adds text; returns detections from every line it completed.
    pub fn push(&mut self, text: &str) -> Vec<Detection> {
        self.pending.push_str(text);
        let mut out = Vec::new();
        while let Some(end) = self.pending.find('\n') {
            let line: String = self.pending.drain(..=end).collect();
            out.extend(parse_line(line.trim_end()));
        }
        out
    }

    /// Detections from a last line without a trailing newline.
    pub fn finish(mut self) -> Vec<Detection> {
        let rest = std::mem::take(&mut self.pending);
        parse_line(rest.trim_end())
    }
}

/// Parses one line: `<Nf>` frame markers, then `ordinal<|box;…|>` records (mask tokens skipped).
fn parse_line(line: &str) -> Vec<Detection> {
    let mut out = Vec::new();
    let mut frame: Option<u32> = None;
    let mut rest = line;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('<').filter(|r| !r.starts_with('|')) {
            let Some((n, tail)) = after.split_once("f>") else {
                break;
            };
            frame = n.parse().ok();
            rest = tail;
        } else if rest.starts_with("<|") {
            let Some(end) = rest.find("|>") else { break };
            rest = &rest[end + 2..];
        } else {
            let digits = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            let (ordinal, tail) = rest.split_at(digits);
            let Some(fields) = tail.strip_prefix("<|box;").and_then(|t| t.split_once("|>")) else {
                rest = rest.get(1..).unwrap_or_default();
                continue;
            };
            if let (Some(f), Ok(o)) = (frame, ordinal.parse()) {
                out.extend(detection(f, o, fields.0));
            }
            rest = fields.1;
        }
    }
    out
}

fn detection(frame: u32, ordinal: u32, fields: &str) -> Option<Detection> {
    let get = |k: &str| {
        fields
            .split(';')
            .find_map(|kv| kv.strip_prefix(k)?.strip_prefix('=')?.parse::<f64>().ok())
    };
    Some(Detection {
        frame,
        ordinal,
        bbox: BoxPx {
            x1: get("x1")?,
            y1: get("y1")?,
            x2: get("x2")?,
            y2: get("y2")?,
        },
        frame_w: get("w").and_then(|w| u32::try_from(w as i64).ok())?,
        frame_h: get("h").and_then(|h| u32::try_from(h as i64).ok())?,
        conf: get("c").unwrap_or(1.0),
    })
}

/// SSE events of the stream body: delta texts in order, and the `response.completed` event.
fn sse_events(body: &str) -> impl Iterator<Item = Value> + '_ {
    body.lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .map(str::trim)
        .filter(|d| *d != "[DONE]")
        .filter_map(|d| serde_json::from_str(d).ok())
}

/// All detections in a stream body.
pub fn detections(body: &str) -> Vec<Detection> {
    let mut parser = DetectionParser::default();
    let mut out = Vec::new();
    for e in sse_events(body).filter(|e| e["type"] == "response.output_text.delta") {
        out.extend(parser.push(e["delta"].as_str().unwrap_or_default()));
    }
    out.extend(parser.finish());
    out
}

/// Billed frames from the `response.completed` event.
pub fn frame_usage(body: &str) -> Option<Usage> {
    sse_events(body)
        .find(|e| e["type"] == "response.completed")
        .and_then(|e| e["response"]["usage"]["video_frames_processed"].as_u64())
        .map(Usage::Frames)
}

impl FaceTracker for SamFaceTracker {
    fn track_faces<'a>(&'a self, video: &'a Path) -> PortResult<'a, Vec<Detection>> {
        Box::pin(async move {
            let bytes = tokio::fs::read(video).await.map_err(|e| {
                AppError::new(ErrorCode::Internal, format!("reading 1 fps copy: {e}"))
            })?;
            let keyed = body("").to_string();
            let url = format!(
                "data:video/mp4;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            );
            let request = body(&url);
            let build = |http: &reqwest::Client, base: &str| {
                Ok(http.post(format!("{base}/responses")).json(&request))
            };
            let call = MetaCall {
                model: MODEL,
                purpose: "faces",
                timeout: self.timeout,
                fingerprint: &[keyed.as_bytes(), &bytes],
                build: &build,
                usage: frame_usage,
            };
            Ok(detections(&self.client.call(call).await?))
        })
    }
}

#[cfg(test)]
mod sam_tests;
