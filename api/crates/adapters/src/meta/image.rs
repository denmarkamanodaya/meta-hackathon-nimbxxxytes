//! [`ImageMaker`] on Muse Image: one storyboard frame per call, WebP as base64 JSON, low reasoning
//! strength. A frame without anchors is a generation (`POST /images/generations`); a frame with
//! anchors is an edit (`POST /images/edits`) that sends each anchor as a base64 data URL. `size`
//! sets the aspect only. Each image is billed flat, so the call logs `Usage::Images`.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use futures_util::{StreamExt, stream};
use nimbytes_core::domain::cost::Usage;
use nimbytes_core::domain::production::board_size;
use nimbytes_core::ports::{BoardRequest, BoxFuture, ImageMaker, PortResult, purpose};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::prompt::Template;
use super::{MetaCall, MetaClient, json_body};

/// Model id.
pub const MODEL: &str = "muse-image-1.0";

fn unavailable(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ModelUnavailable, msg.into())
}

/// The image prompts.
pub struct ImagePrompts {
    /// `storyboard.md`: the drawing style (system) and the shot (user).
    pub storyboard: Template,
    /// `brand_style.md`: how to use attached brand images (its user text is appended).
    pub brand_style: Template,
}

/// Muse Image storyboard frames.
pub struct MuseImageMaker {
    client: MetaClient,
    prompts: ImagePrompts,
    timeout: Duration,
    concurrency: usize,
}

impl MuseImageMaker {
    /// Uses `prompts`; one call (retries included) must finish within `timeout`, and at most
    /// `concurrency` calls run at once.
    pub fn new(
        client: MetaClient,
        prompts: ImagePrompts,
        timeout: Duration,
        concurrency: usize,
    ) -> Self {
        Self {
            client,
            prompts,
            timeout,
            concurrency: concurrency.max(1),
        }
    }

    /// The prompt of a frame: the drawing style, a blank line, the shot, and with brand anchors
    /// a blank line and how to use them.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn prompt(&self, r: &BoardRequest) -> Result<String, AppError> {
        let storyboard = &self.prompts.storyboard;
        let shot = storyboard.fill(&[
            ("act", r.act.as_str()),
            ("title", &r.title),
            ("direction", &r.direction),
        ])?;
        Ok(self.with_brand(
            format!("{}\n\n{shot}", storyboard.system),
            !r.anchors.is_empty(),
        ))
    }

    /// `prompt` followed by the brand note when brand images are attached.
    fn with_brand(&self, prompt: String, anchored: bool) -> String {
        if anchored {
            format!("{prompt}\n\n{}", self.prompts.brand_style.user)
        } else {
            prompt
        }
    }

    /// The request body; `anchors` are the `images` entries of an edit (none for a generation).
    pub fn body(prompt: &str, size: &str, anchors: &[String]) -> Value {
        let mut body = json!({
            "model": MODEL,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "output_format": "webp",
            "response_format": "b64_json",
            "reasoning_strength": "low",
        });
        if !anchors.is_empty() {
            body["images"] = anchors
                .iter()
                .map(|url| json!({ "image_url": url }))
                .collect();
        }
        body
    }

    async fn draw_one(&self, r: &BoardRequest) -> Result<(), AppError> {
        let prompt = self.prompt(r)?;
        let size = board_size(r.aspect);
        let mut anchor_bytes = Vec::with_capacity(r.anchors.len());
        for path in &r.anchors {
            anchor_bytes.push(read(path).await?);
        }
        // The cache key covers the body without the base64 copies, plus each anchor's bytes.
        let keyed = Self::body(&prompt, size, &[]).to_string();
        let anchors: Vec<String> = r
            .anchors
            .iter()
            .zip(&anchor_bytes)
            .map(|(p, b)| data_url(p, b))
            .collect();
        let body = Self::body(&prompt, size, &anchors);
        let mut fingerprint: Vec<&[u8]> = vec![keyed.as_bytes()];
        fingerprint.extend(anchor_bytes.iter().map(Vec::as_slice));
        let raw = self.send(&body, !anchors.is_empty(), &fingerprint).await?;
        let bytes = image_bytes(&raw)?;
        tokio::fs::write(&r.out, bytes)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("writing frame: {e}")))
    }

    /// Sends `body` to the edits endpoint when it carries anchors, else to generations, through
    /// the client (cache, cost log, retries), capped at the timeout.
    async fn send(
        &self,
        body: &Value,
        edit: bool,
        fingerprint: &[&[u8]],
    ) -> Result<String, AppError> {
        let endpoint = if edit {
            "images/edits"
        } else {
            "images/generations"
        };
        let build = |http: &reqwest::Client, base: &str| {
            Ok(http.post(format!("{base}/{endpoint}")).json(body))
        };
        let call = MetaCall {
            model: MODEL,
            purpose: purpose::STORYBOARD,
            timeout: self.timeout,
            fingerprint,
            build: &build,
            usage: image_usage,
        };
        tokio::time::timeout(self.timeout, self.client.call(call))
            .await
            .map_err(|_| unavailable(format!("storyboard timed out after {:?}", self.timeout)))?
    }
}

async fn read(path: &Path) -> Result<Vec<u8>, AppError> {
    tokio::fs::read(path)
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("reading anchor: {e}")))
}

/// A base64 data URL for an anchor image (PNG by extension, JPEG otherwise).
fn data_url(path: &Path, bytes: &[u8]) -> String {
    let png = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("png"));
    let mime = if png { "image/png" } else { "image/jpeg" };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{encoded}")
}

/// Images in a successful response body.
pub fn image_usage(body: &str) -> Option<Usage> {
    let v: Value = serde_json::from_str(body).ok()?;
    let n = v["data"].as_array()?.len();
    Some(Usage::Images(u64::try_from(n).ok()?))
}

/// The first image of a response, decoded from `data[0].b64_json`.
///
/// # Errors
/// `MODEL_UNAVAILABLE` when the body is not JSON, has no image or the image is not base64.
pub fn image_bytes(body: &str) -> Result<Vec<u8>, AppError> {
    let v = json_body(body)?;
    let b64 = v["data"][0]["b64_json"]
        .as_str()
        .ok_or_else(|| unavailable("image response has no b64_json"))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| unavailable("image response is not base64"))?;
    if bytes.is_empty() {
        return Err(unavailable("image response is empty"));
    }
    Ok(bytes)
}

impl ImageMaker for MuseImageMaker {
    fn draw_boards<'a>(
        &'a self,
        requests: &'a [BoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        Box::pin(async move {
            let calls: Vec<BoxFuture<'_, Result<(), AppError>>> = requests
                .iter()
                .map(|r| Box::pin(self.draw_one(r)) as BoxFuture<'_, _>)
                .collect();
            Ok(stream::iter(calls)
                .buffered(self.concurrency)
                .collect::<Vec<_>>()
                .await)
        })
    }
}

#[cfg(test)]
mod image_tests;
