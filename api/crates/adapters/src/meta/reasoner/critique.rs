//! The critique: `critique.md` + `critique.schema.json`, effort low, the preview MP4 inline as a
//! base64 data URL after the user text (previews are about 2 MB, far under the inline limit).

use base64::Engine;
use nimbytes_core::domain::critique::Critique;
use nimbytes_core::ports::CritiqueRequest;
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::plan::moment_line;
use super::{SparkReasoner, unavailable};
use crate::meta::spark::MODEL;

/// Reasoning effort of the critique: it watches the whole preview once.
const LOW: &str = "low";

impl SparkReasoner {
    /// The Responses body: system text, then the filled user text and the video.
    pub fn critique_body(
        &self,
        r: &CritiqueRequest<'_>,
        video_url: &str,
    ) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.critique;
        let lines: Vec<String> = r.segments.iter().map(moment_line).collect();
        let timeline = serde_json::to_string(r.timeline)
            .map_err(|e| unavailable(format!("timeline to JSON: {e}")))?;
        let request = if r.prompt.trim().is_empty() {
            "(none)"
        } else {
            r.prompt
        };
        let user = template.fill(&[
            ("version", &r.version.to_string()),
            ("target_seconds", &format!("{}", r.target_s)),
            ("request", request),
            ("timeline", &timeline),
            ("segments", &lines.join("\n")),
        ])?;
        Ok(json!({
            "model": MODEL,
            "store": false,
            "reasoning": { "effort": LOW },
            "text": { "format": schema.format() },
            "input": [
                { "type": "message", "role": "system", "content": [{ "type": "input_text", "text": template.system }] },
                { "type": "message", "role": "user", "content": [
                    { "type": "input_text", "text": user },
                    { "type": "input_video", "video_url": video_url },
                ] },
            ],
        }))
    }

    pub(super) async fn critique_preview(
        &self,
        r: &CritiqueRequest<'_>,
    ) -> Result<Critique, AppError> {
        let bytes = tokio::fs::read(r.video)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("reading preview: {e}")))?;
        let data_url = format!(
            "data:video/mp4;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let body = self.critique_body(r, &data_url)?;
        let schema = &self.prompts.critique.1;
        let v = self
            .ask(("critique", self.timeouts.plan), body, schema)
            .await?;
        let critique: Critique = serde_json::from_value(v)
            .map_err(|e| unavailable(format!("critique answer unusable: {e}")))?;
        Ok(critique.settled(r.version))
    }
}

#[cfg(test)]
mod critique_tests;
