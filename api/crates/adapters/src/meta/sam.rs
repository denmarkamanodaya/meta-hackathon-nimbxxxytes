//! SAM 3.1. [`SamFaceTracker`] is the ingest [`FaceTracker`]: the noun phrase `face` over the
//! 1 fps copy, streamed. Each `response.output_text.delta` carries detection text such as
//! `<12f>0<|box;x1=430;y1=169;x2=454;y2=196;w=480;h=640;c=0.71|><|mask;…|>` (one line per frame
//! with detections); [`DetectionParser`] turns that text into records however the deltas split it.
//! [`SamSubjectTracker`] is the [`SubjectTracker`]: a phrase, point or box prompt over a video or
//! one image, not streamed, with one-bit masks kept opaque (only the renderer decodes them).

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use nimbytes_core::domain::cost::Usage;
use nimbytes_core::domain::faces::{BoxPx, Detection};
use nimbytes_core::domain::sam::{
    MaskEncoding, MaskRef, SamMedia, SamPrompt, SamRecord, SamRequest,
};
use nimbytes_core::ports::{FaceTracker, PortResult, SubjectTracker};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::spark::output_text;
use super::{MetaCall, MetaClient, json_body};

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

/// Incremental parser: feed any split of the delta text, get each record once its line ends.
#[derive(Debug, Default)]
pub struct DetectionParser {
    pending: String,
}

impl DetectionParser {
    /// Adds text; returns detections from every line it completed.
    pub fn push(&mut self, text: &str) -> Vec<Detection> {
        self.push_records(text).iter().map(detection).collect()
    }

    /// Detections from a last line without a trailing newline.
    pub fn finish(self) -> Vec<Detection> {
        self.finish_records().iter().map(detection).collect()
    }

    /// Adds text; returns records (ids and masks included) from every line it completed.
    pub fn push_records(&mut self, text: &str) -> Vec<SamRecord> {
        self.pending.push_str(text);
        let mut out = Vec::new();
        while let Some(end) = self.pending.find('\n') {
            let line: String = self.pending.drain(..=end).collect();
            out.extend(parse_line(line.trim_end()));
        }
        out
    }

    /// Records from a last line without a trailing newline.
    pub fn finish_records(mut self) -> Vec<SamRecord> {
        let rest = std::mem::take(&mut self.pending);
        parse_line(rest.trim_end())
    }
}

fn detection(r: &SamRecord) -> Detection {
    Detection {
        frame: r.frame,
        ordinal: r.id,
        bbox: r.bbox,
        frame_w: r.frame_w,
        frame_h: r.frame_h,
        conf: r.conf,
    }
}

/// All records in a whole (not streamed) answer text, in any frame order.
pub fn records(text: &str) -> Vec<SamRecord> {
    let mut p = DetectionParser::default();
    let mut out = p.push_records(text);
    out.extend(p.finish_records());
    out
}

/// Parses one line: `<Nf>` frame markers, then `id<|box;…|>` records, each optionally followed
/// by its `<|mask;…|>` token.
fn parse_line(line: &str) -> Vec<SamRecord> {
    let mut out: Vec<SamRecord> = Vec::new();
    let mut frame: Option<u32> = None;
    let mut rest = line;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('<').filter(|r| !r.starts_with('|')) {
            let Some((n, tail)) = after.split_once("f>") else {
                break;
            };
            frame = n.parse().ok();
            rest = tail;
        } else if let Some(after) = rest.strip_prefix("<|") {
            let Some(end) = after.find("|>") else { break };
            if let Some(fields) = after[..end].strip_prefix("mask;")
                && let Some(last) = out.last_mut()
                && last.mask.is_none()
            {
                last.mask = mask(fields);
            }
            rest = &after[end + 2..];
        } else {
            let digits = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            let (id, tail) = rest.split_at(digits);
            let Some(fields) = tail.strip_prefix("<|box;").and_then(|t| t.split_once("|>")) else {
                rest = rest.get(1..).unwrap_or_default();
                continue;
            };
            if let (Some(f), Ok(id)) = (frame, id.parse()) {
                out.extend(record(f, id, fields.0));
            }
            rest = fields.1;
        }
    }
    out
}

fn record(frame: u32, id: u32, fields: &str) -> Option<SamRecord> {
    let get = |k: &str| {
        fields
            .split(';')
            .find_map(|kv| kv.strip_prefix(k)?.strip_prefix('=')?.parse::<f64>().ok())
    };
    Some(SamRecord {
        frame,
        id,
        bbox: BoxPx {
            x1: get("x1")?,
            y1: get("y1")?,
            x2: get("x2")?,
            y2: get("y2")?,
        },
        frame_w: get("w").and_then(|w| u32::try_from(w as i64).ok())?,
        frame_h: get("h").and_then(|h| u32::try_from(h as i64).ok())?,
        conf: get("c").unwrap_or(1.0),
        mask: None,
    })
}

/// The mask of `x=0;y=0;c=…;data=H,W,<payload>` (height first; the payload keeps its leading
/// `~` or `!`, which names the encoding).
fn mask(fields: &str) -> Option<MaskRef> {
    let (_, data) = fields.split_once("data=")?;
    let mut parts = data.splitn(3, ',');
    let height = parts.next()?.trim().parse().ok()?;
    let width = parts.next()?.trim().parse().ok()?;
    let payload = parts.next()?;
    let encoding = match payload.chars().next()? {
        '!' => MaskEncoding::OneBit,
        '~' => MaskEncoding::Lossless,
        _ => return None,
    };
    Some(MaskRef {
        encoding,
        width,
        height,
        payload: payload.to_owned(),
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

/// What a whole (not streamed) answer billed: video frames, or SAM images.
pub fn answer_usage(body: &str) -> Option<Usage> {
    let v: Value = serde_json::from_str(body).ok()?;
    let usage = &v["usage"];
    usage["video_frames_processed"]
        .as_u64()
        .map(Usage::Frames)
        .or_else(|| usage["images_processed"].as_u64().map(Usage::SamImages))
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

/// Prompt text for every object a phrase names.
pub fn concept(phrase: &str) -> String {
    phrase.trim().to_owned()
}

/// Prompt text for the object under point (x, y) of frame `frame` of a `w` × `h` frame.
pub fn point(frame: u32, id: u32, (x, y): (u32, u32), (w, h): (u32, u32)) -> String {
    format!("<{frame}f>{id}<|point;x={x};y={y};w={w};h={h}|>")
}

/// Prompt text for the object inside box (x1, y1, x2, y2) (inclusive) of frame `frame`.
pub fn boxed(
    frame: u32,
    id: u32,
    (x1, y1, x2, y2): (u32, u32, u32, u32),
    (w, h): (u32, u32),
) -> String {
    format!("<{frame}f>{id}<|box;x1={x1};y1={y1};x2={x2};y2={y2};w={w};h={h}|>")
}

/// The prompt text of `prompt`.
pub fn prompt_text(prompt: &SamPrompt) -> String {
    match prompt {
        SamPrompt::Concept(phrase) => concept(phrase),
        SamPrompt::Point {
            frame,
            id,
            x,
            y,
            w,
            h,
        } => point(*frame, *id, (*x, *y), (*w, *h)),
        SamPrompt::Boxed {
            frame,
            id,
            bbox,
            w,
            h,
        } => boxed(*frame, *id, *bbox, (*w, *h)),
    }
}

/// The request body of `request` with its media as `media_url` (a data URL in production):
/// not streamed, one-bit masks, confidences, and the propagation of a point or box prompt.
pub fn subject_body(request: &SamRequest<'_>, media_url: &str) -> Value {
    let mut metadata = json!({ "include_confidence": "true", "mask_encoding": "one_bit" });
    if let Some(p) = request.propagation {
        metadata["propagation_direction"] = json!(p.as_str());
    }
    let media = match request.media {
        SamMedia::Video(_) => json!({ "type": "input_video", "video_url": media_url }),
        SamMedia::Image(_) => json!({ "type": "input_image", "image_url": media_url }),
    };
    json!({
        "model": MODEL,
        "stream": false,
        "metadata": metadata,
        "input": [{ "type": "message", "role": "user", "content": [
            { "type": "input_text", "text": prompt_text(&request.prompt) },
            media,
        ] }],
    })
}

/// SAM over a phrase, point or box, on a video or one image.
#[derive(Clone)]
pub struct SamSubjectTracker {
    client: MetaClient,
    timeout: Duration,
}

impl SamSubjectTracker {
    /// Uses `client`, giving each attempt `timeout`.
    pub fn new(client: MetaClient, timeout: Duration) -> Self {
        Self { client, timeout }
    }

    async fn run(&self, request: &SamRequest<'_>) -> Result<Vec<SamRecord>, AppError> {
        let (path, mime) = match request.media {
            SamMedia::Video(p) => (p, "video/mp4"),
            SamMedia::Image(p) => (p, "image/jpeg"),
        };
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("reading SAM media: {e}")))?;
        let keyed = subject_body(request, "").to_string();
        let url = format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let body = subject_body(request, &url);
        let build = |http: &reqwest::Client, base: &str| {
            Ok(http.post(format!("{base}/responses")).json(&body))
        };
        let call = MetaCall {
            model: MODEL,
            purpose: request.purpose,
            timeout: self.timeout,
            fingerprint: &[keyed.as_bytes(), &bytes],
            build: &build,
            usage: answer_usage,
        };
        let raw = self.client.call(call).await?;
        Ok(records(&output_text(&json_body(&raw)?)))
    }
}

impl SubjectTracker for SamSubjectTracker {
    fn segment<'a>(&'a self, request: &'a SamRequest<'a>) -> PortResult<'a, Vec<SamRecord>> {
        Box::pin(self.run(request))
    }
}

#[cfg(test)]
mod sam_tests;
#[cfg(test)]
mod subject_tests;
