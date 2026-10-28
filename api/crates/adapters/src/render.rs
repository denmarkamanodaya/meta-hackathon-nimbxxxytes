//! [`Renderer`] over HTTP: the renderer service on the compose network renders the composition
//! with Remotion and uploads the MP4 to the presigned URL it is given (`POST /render`), and renders
//! cover stills the same way (`POST /still`, a JPEG).

use std::time::Duration;

use nimbytes_core::domain::render::{CoverStillProps, Quality, ShortProps};
use nimbytes_core::ports::{PortResult, RenderOutput, Renderer};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

/// How long each render may take, upload included.
#[derive(Debug, Clone, Copy)]
pub struct RenderTimeouts {
    /// Low-res preview from proxies.
    pub preview: Duration,
    /// Full-size final from originals.
    pub final_render: Duration,
}

/// Client of the renderer's `POST /render` and `POST /still`.
#[derive(Debug, Clone)]
pub struct RemotionRenderer {
    http: reqwest::Client,
    base_url: String,
    timeouts: RenderTimeouts,
}

fn failed(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::RenderFailed, msg.into())
}

impl RemotionRenderer {
    /// Talks to the renderer at `base_url` (for example `http://renderer:3001`).
    pub fn new(
        http: reqwest::Client,
        base_url: impl Into<String>,
        timeouts: RenderTimeouts,
    ) -> Self {
        Self {
            http,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            timeouts,
        }
    }

    async fn call(
        &self,
        props: &ShortProps,
        quality: Quality,
        out_url: &str,
    ) -> Result<RenderOutput, AppError> {
        let timeout = match quality {
            Quality::Preview => self.timeouts.preview,
            Quality::Final => self.timeouts.final_render,
        };
        let body = json!({ "props": props, "quality": quality, "out_url": out_url });
        let response = self
            .http
            .post(format!("{}/render", self.base_url))
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(|e| failed(format!("renderer unreachable or too slow: {e}")))?;
        let (status, text) = answer(response).await?;
        read_reply(status, &text)
    }

    /// A cover still; stills queue behind renders, so they get the final render's time.
    async fn call_still(&self, props: &CoverStillProps, out_url: &str) -> Result<(), AppError> {
        let body = json!({ "props": props, "out_url": out_url });
        let response = self
            .http
            .post(format!("{}/still", self.base_url))
            .timeout(self.timeouts.final_render)
            .json(&body)
            .send()
            .await
            .map_err(|e| failed(format!("renderer unreachable or too slow: {e}")))?;
        let (status, text) = answer(response).await?;
        refused(status, &text).map_or(Ok(()), Err)
    }
}

async fn answer(response: reqwest::Response) -> Result<(u16, String), AppError> {
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|e| failed(format!("renderer answer lost: {e}")))?;
    Ok((status, text))
}

/// `RENDER_FAILED` with the renderer's code and message for an answer outside 2xx.
fn refused(status: u16, text: &str) -> Option<AppError> {
    if (200..300).contains(&status) {
        return None;
    }
    let reply: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let detail = match (
        reply["error"]["code"].as_str(),
        reply["error"]["message"].as_str(),
    ) {
        (Some(code), Some(message)) => format!("{code}: {message}"),
        _ => text.chars().take(200).collect(),
    };
    Some(failed(format!("renderer answered {status}: {detail}")))
}

/// The render result from a 2xx answer, or `RENDER_FAILED` with the renderer's code and
/// message.
fn read_reply(status: u16, text: &str) -> Result<RenderOutput, AppError> {
    if let Some(err) = refused(status, text) {
        return Err(err);
    }
    let reply: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    match (reply["duration_s"].as_f64(), reply["bytes"].as_u64()) {
        (Some(duration_s), Some(bytes)) => Ok(RenderOutput { duration_s, bytes }),
        _ => Err(failed(format!("renderer answer unreadable: {text}"))),
    }
}

impl Renderer for RemotionRenderer {
    fn render<'a>(
        &'a self,
        props: &'a ShortProps,
        quality: Quality,
        out_url: &'a str,
    ) -> PortResult<'a, RenderOutput> {
        Box::pin(self.call(props, quality, out_url))
    }

    fn still<'a>(&'a self, props: &'a CoverStillProps, out_url: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.call_still(props, out_url))
    }
}

#[cfg(test)]
mod tests;
