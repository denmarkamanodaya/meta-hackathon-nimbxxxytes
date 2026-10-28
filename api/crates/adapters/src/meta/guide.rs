//! [`GuideWriter`] on Muse Spark: one Responses API call with the clip's 360p copy inline, the
//! transcript in the user text, `store: false`, low reasoning effort and strict structured output
//! (`guide_steps.schema.json`). The answer is mapped to a [`GuideDraft`]; the core's rules clamp
//! and order it.

use std::time::Duration;

use base64::Engine;
use nimbytes_core::domain::guide::{DraftStep, GuideDraft, Safety};
use nimbytes_core::ports::{GuideRequest, GuideWriter, PortResult, purpose};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::prompt::{StrictSchema, Template};
use super::spark::{MODEL, output_text, token_usage};
use super::{MetaCall, MetaClient, json_body};

/// Spark writing guide steps.
pub struct SparkGuideWriter {
    client: MetaClient,
    template: Template,
    schema: StrictSchema,
    timeout: Duration,
}

fn unavailable(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ModelUnavailable, msg.into())
}

impl SparkGuideWriter {
    /// Uses the `guide_steps` prompt and schema; each attempt gets `timeout`.
    pub fn new(client: MetaClient, prompt: (Template, StrictSchema), timeout: Duration) -> Self {
        let (template, schema) = prompt;
        Self {
            client,
            template,
            schema,
            timeout,
        }
    }

    /// The request body with the video as `video_url` (a data URL in production).
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn body(&self, r: &GuideRequest<'_>, video_url: &str) -> Result<Value, AppError> {
        let user = self.template.fill(&[
            ("duration", &format!("{:.1}", r.duration_s)),
            ("transcript", &r.transcript),
        ])?;
        Ok(json!({
            "model": MODEL,
            "store": false,
            "reasoning": { "effort": "low" },
            "text": { "format": self.schema.format() },
            "input": [
                { "type": "message", "role": "system", "content": [{ "type": "input_text", "text": self.template.system }] },
                { "type": "message", "role": "user", "content": [
                    { "type": "input_text", "text": user },
                    { "type": "input_video", "video_url": video_url },
                ] },
            ],
        }))
    }

    async fn write(&self, r: &GuideRequest<'_>) -> Result<GuideDraft, AppError> {
        let bytes = tokio::fs::read(r.video)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("reading guide video: {e}")))?;
        // The cache key covers the request without the base64 copy, plus the raw video bytes.
        let keyed = self.body(r, "")?.to_string();
        let data_url = format!(
            "data:video/mp4;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let body = self.body(r, &data_url)?;
        let build = |http: &reqwest::Client, base: &str| {
            Ok(http.post(format!("{base}/responses")).json(&body))
        };
        let call = MetaCall {
            model: MODEL,
            purpose: purpose::GUIDE_STEPS,
            timeout: self.timeout,
            fingerprint: &[keyed.as_bytes(), &bytes],
            build: &build,
            usage: token_usage,
        };
        let text = output_text(&json_body(&self.client.call(call).await?)?);
        let v = self
            .schema
            .check(&text)
            .map_err(|e| unavailable(format!("guide_steps answer invalid: {e}")))?;
        draft_from(&v)
    }
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().trim().to_owned()
}

/// A schema-valid answer as a draft.
///
/// # Errors
/// `MODEL_UNAVAILABLE` for an unknown safety label.
pub fn draft_from(v: &Value) -> Result<GuideDraft, AppError> {
    let safety = Safety::parse(v["safety"].as_str().unwrap_or_default())
        .map_err(|_| unavailable("guide_steps answer has no safety label"))?;
    let steps = v["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|s| DraftStep {
            title: text(&s["title"]),
            instruction: text(&s["instruction"]),
            start_s: s["start_s"].as_f64().unwrap_or(f64::NAN),
            end_s: s["end_s"].as_f64().unwrap_or(f64::NAN),
            key_s: s["key_s"].as_f64().unwrap_or(f64::NAN),
            control: text(&s["control"]),
        })
        .collect();
    Ok(GuideDraft {
        safety,
        safety_reason: text(&v["safety_reason"]),
        title: text(&v["title"]),
        steps,
    })
}

impl GuideWriter for SparkGuideWriter {
    fn write_steps<'a>(&'a self, request: &'a GuideRequest<'a>) -> PortResult<'a, GuideDraft> {
        Box::pin(self.write(request))
    }
}

#[cfg(test)]
mod guide_tests;
