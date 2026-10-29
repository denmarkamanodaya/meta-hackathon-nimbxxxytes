//! [`ImageMaker`] on Muse Image: one image per call, WebP as base64 JSON, low reasoning strength.
//! A frame without anchors is a generation (`POST /images/generations`); an image with anchors is
//! an edit (`POST /images/edits`) that sends each anchor as a base64 data URL, in order. `size`
//! sets the aspect only. Each image is billed flat, so the call logs `Usage::Images`. Covers,
//! redrawn covers, cut-out cover scenes and key art each log under their own purpose.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use futures_util::{StreamExt, stream};
use nimbytes_core::domain::cost::Usage;
use nimbytes_core::ports::{
    ArtRequest, BoxFuture, CoverRequest, ImageMaker, PortResult, RedrawRequest, SceneRequest,
    purpose,
};
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
    /// `cover.md`: the cover brief and styles (system) and the platform, post, style and
    /// variation (user).
    pub cover: Template,
    /// `cover_redraw.md`: how to redraw a cover (system) and the shape and instruction (user).
    pub cover_redraw: Template,
    /// `key_art.md`: the key art brief (system) and the shape, theme and accent (user).
    pub key_art: Template,
    /// `cutout_scene.md`: the place behind a cut-out cover's subject (system) and the shape
    /// (user).
    pub cutout_scene: Template,
}

/// Longest post caption a cover prompt carries, characters.
const COVER_CAPTION_CHARS: usize = 300;

/// Muse Image covers and key art.
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

    /// The prompt of a cover: the cover brief, a blank line, then the platform, shape, post,
    /// accent, whether a logo is attached, and the variation. The brief itself says how to use
    /// the logo and style references.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn cover_prompt(&self, r: &CoverRequest) -> Result<String, AppError> {
        let cover = &self.prompts.cover;
        let n = r.n.to_string();
        let caption: String = r.caption.chars().take(COVER_CAPTION_CHARS).collect();
        let logo = if r.has_logo { "attached" } else { "none" };
        let user = cover.fill(&[
            ("platform", r.platform.as_str()),
            ("shape", r.aspect.as_str()),
            ("caption", &caption),
            ("accent", &r.accent),
            ("logo", logo),
            ("style", r.style.as_str()),
            ("n", &n),
        ])?;
        Ok(format!("{}\n\n{user}", cover.system))
    }

    /// The prompt of a redrawn cover: how to redraw, a blank line, the shape, then the owner's
    /// instruction last.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn redraw_prompt(&self, r: &RedrawRequest) -> Result<String, AppError> {
        let t = &self.prompts.cover_redraw;
        let user = t.fill(&[
            ("shape", r.aspect.as_str()),
            ("instruction", &r.instruction),
        ])?;
        Ok(format!("{}\n\n{user}", t.system))
    }

    /// The prompt of key art: the brief, a blank line, the shape, theme, accent and variation.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn art_prompt(&self, r: &ArtRequest) -> Result<String, AppError> {
        let t = &self.prompts.key_art;
        let take = r.take.to_string();
        let user = t.fill(&[
            ("shape", r.shape),
            ("theme", &r.theme),
            ("accent", &r.accent),
            ("take", &take),
        ])?;
        Ok(format!("{}\n\n{user}", t.system))
    }

    async fn draw_cover(&self, r: &CoverRequest) -> Result<(), AppError> {
        let prompt = self.cover_prompt(r)?;
        let image = (purpose::COVER, r.aspect.image_size());
        self.draw(&prompt, image, (&r.anchors, &r.out)).await
    }

    async fn draw_redraw(&self, r: &RedrawRequest) -> Result<(), AppError> {
        let prompt = self.redraw_prompt(r)?;
        let image = (purpose::COVER_REDRAW, r.aspect.image_size());
        self.draw(&prompt, image, (&r.anchors, &r.out)).await
    }

    /// The prompt of a cut-out cover's scene: the brief, a blank line, then the shape.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn scene_prompt(&self, r: &SceneRequest) -> Result<String, AppError> {
        let t = &self.prompts.cutout_scene;
        let user = t.fill(&[("shape", r.aspect.as_str())])?;
        Ok(format!("{}\n\n{user}", t.system))
    }

    async fn draw_cutout_scene(&self, r: &SceneRequest) -> Result<(), AppError> {
        let prompt = self.scene_prompt(r)?;
        let image = (purpose::CUTOUT_SCENE, r.aspect.image_size());
        let frame = [r.frame.clone()];
        self.draw(&prompt, image, (&frame, &r.out)).await
    }

    async fn draw_key_art(&self, r: &ArtRequest) -> Result<(), AppError> {
        let prompt = self.art_prompt(r)?;
        let image = (purpose::KEY_ART, r.size);
        self.draw(&prompt, image, (&r.anchors, &r.out)).await
    }

    /// One image for `prompt` at `size`, anchored on `anchors` when there are any, written to
    /// `out`; logged under `purpose`.
    async fn draw(
        &self,
        prompt: &str,
        (purpose, size): (&str, &str),
        (anchor_paths, out): (&[PathBuf], &Path),
    ) -> Result<(), AppError> {
        let mut anchor_bytes = Vec::with_capacity(anchor_paths.len());
        for path in anchor_paths {
            anchor_bytes.push(read(path).await?);
        }
        // The cache key covers the body without the base64 copies, plus each anchor's bytes.
        let keyed = Self::body(prompt, size, &[]).to_string();
        let anchors: Vec<String> = anchor_paths
            .iter()
            .zip(&anchor_bytes)
            .map(|(p, b)| data_url(p, b))
            .collect();
        let body = Self::body(prompt, size, &anchors);
        let mut fingerprint: Vec<&[u8]> = vec![keyed.as_bytes()];
        fingerprint.extend(anchor_bytes.iter().map(Vec::as_slice));
        let raw = self
            .send(&body, (purpose, !anchors.is_empty()), &fingerprint)
            .await?;
        let bytes = image_bytes(&raw)?;
        tokio::fs::write(out, bytes)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("writing image: {e}")))
    }

    /// Sends `body` to the edits endpoint when it carries anchors, else to generations, through
    /// the client (cache, cost log, retries), capped at the timeout.
    async fn send(
        &self,
        body: &Value,
        (purpose, edit): (&str, bool),
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
            purpose,
            timeout: self.timeout,
            fingerprint,
            build: &build,
            usage: image_usage,
        };
        tokio::time::timeout(self.timeout, self.client.call(call))
            .await
            .map_err(|_| unavailable(format!("{purpose} timed out after {:?}", self.timeout)))?
    }
}

async fn read(path: &Path) -> Result<Vec<u8>, AppError> {
    tokio::fs::read(path)
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("reading anchor: {e}")))
}

/// A base64 data URL for an anchor image (PNG or WebP by extension, JPEG otherwise).
fn data_url(path: &Path, bytes: &[u8]) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let mime = match ext.as_deref() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };
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
    fn draw_covers<'a>(
        &'a self,
        requests: &'a [CoverRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        let calls = requests
            .iter()
            .map(|r| Box::pin(self.draw_cover(r)) as BoxFuture<'_, _>)
            .collect();
        Box::pin(self.all(calls))
    }

    fn redraw_cover<'a>(&'a self, request: &'a RedrawRequest) -> PortResult<'a, ()> {
        Box::pin(self.draw_redraw(request))
    }

    fn draw_scene<'a>(&'a self, request: &'a SceneRequest) -> PortResult<'a, ()> {
        Box::pin(self.draw_cutout_scene(request))
    }

    fn draw_art<'a>(&'a self, request: &'a ArtRequest) -> PortResult<'a, ()> {
        Box::pin(self.draw_key_art(request))
    }
}

impl MuseImageMaker {
    /// Runs `calls` a few at a time; results in call order.
    async fn all<'a>(
        &'a self,
        calls: Vec<BoxFuture<'a, Result<(), AppError>>>,
    ) -> Result<Vec<Result<(), AppError>>, AppError> {
        Ok(stream::iter(calls)
            .buffered(self.concurrency)
            .collect::<Vec<_>>()
            .await)
    }
}

#[cfg(test)]
mod image_tests;
