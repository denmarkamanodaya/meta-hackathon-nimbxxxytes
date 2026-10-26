//! [`SegmentDescriber`] on Muse Spark: one Responses API call per segment with the segment's
//! 360p snippet inline, strict structured output, `store: false`, low reasoning effort.

use std::time::Duration;

use base64::Engine;
use futures_util::{StreamExt, stream};
use nimbytes_core::domain::cost::Usage;
use nimbytes_core::domain::facts::{FactsStatus, SegmentFacts};
use nimbytes_core::ports::{BoxFuture, FactsAttempt, PortResult, SegmentDescriber, SegmentPrompt};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::prompt::{StrictSchema, Template};
use super::{MetaCall, MetaClient, json_body};

/// Model id: the standard tier only (the contributor tier trains on prompts).
pub const MODEL: &str = "muse-spark-1.3";

/// Per-attempt timeout and calls in flight.
#[derive(Debug, Clone, Copy)]
pub struct SparkLimits {
    /// One attempt's timeout.
    pub timeout: Duration,
    /// Calls in flight at once (at least 1).
    pub concurrency: usize,
}

/// Spark segment describer.
pub struct SparkDescriber {
    client: MetaClient,
    template: Template,
    schema: StrictSchema,
    timeout: Duration,
    concurrency: usize,
}

impl SparkDescriber {
    /// Uses the segment-facts prompt and schema within `limits`.
    pub fn new(client: MetaClient, prompt: (Template, StrictSchema), limits: SparkLimits) -> Self {
        let (template, schema) = prompt;
        Self {
            client,
            template,
            schema,
            timeout: limits.timeout,
            concurrency: limits.concurrency.max(1),
        }
    }

    /// The request body without the video part, plus the user text it carries.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn body(&self, p: &SegmentPrompt, video_url: &str) -> Result<Value, AppError> {
        let (start, end) = (format!("{:.1}", p.start_s), format!("{:.1}", p.end_s));
        let mut user = self.template.fill(&[
            ("start", &start),
            ("end", &end),
            ("recorded_at", &p.recorded_at),
            ("transcript", &p.transcript),
        ])?;
        if let Some(err) = &p.previous_error {
            user.push_str(&format!(
                "\n\nYour previous answer did not match the schema ({err}). Answer again with JSON that matches it."
            ));
        }
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

    async fn describe_one(&self, p: &SegmentPrompt) -> Result<FactsAttempt, AppError> {
        let bytes = tokio::fs::read(&p.snippet)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("reading snippet: {e}")))?;
        // The cache key covers the request without the base64 copy, plus the raw video bytes.
        let keyed = self.body(p, "")?.to_string();
        let data_url = format!(
            "data:video/mp4;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        let body = self.body(p, &data_url)?;
        let build = |http: &reqwest::Client, base: &str| {
            Ok(http.post(format!("{base}/responses")).json(&body))
        };
        let call = MetaCall {
            model: MODEL,
            purpose: "segment_facts",
            timeout: self.timeout,
            fingerprint: &[keyed.as_bytes(), &bytes],
            build: &build,
            usage: token_usage,
        };
        let text = output_text(&json_body(&self.client.call(call).await?)?);
        Ok(match self.schema.check(&text) {
            Ok(v) => FactsAttempt::Valid(facts_from(&v)),
            Err(error) => FactsAttempt::Invalid { text, error },
        })
    }
}

impl SegmentDescriber for SparkDescriber {
    fn describe_all<'a>(
        &'a self,
        prompts: &'a [SegmentPrompt],
    ) -> PortResult<'a, Vec<FactsAttempt>> {
        Box::pin(async move {
            // Boxing each future up front keeps the stream's item type free of closure lifetimes.
            let calls: Vec<BoxFuture<'_, Result<FactsAttempt, AppError>>> = prompts
                .iter()
                .map(|p| Box::pin(self.describe_one(p)) as BoxFuture<'_, _>)
                .collect();
            stream::iter(calls)
                .buffered(self.concurrency)
                .collect::<Vec<_>>()
                .await
                .into_iter()
                .collect()
        })
    }
}

/// Token usage of a Responses API body (`input_tokens` includes cached ones).
pub fn token_usage(body: &str) -> Option<Usage> {
    let v: Value = serde_json::from_str(body).ok()?;
    let u = &v["usage"];
    Some(Usage::Tokens {
        input: u["input_tokens"].as_u64()?,
        cached: u["input_tokens_details"]["cached_tokens"]
            .as_u64()
            .unwrap_or(0),
        output: u["output_tokens"].as_u64()?,
    })
}

/// Concatenated `output_text` parts of the assistant message(s).
pub fn output_text(v: &Value) -> String {
    v["output"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["content"].as_array())
        .flatten()
        .filter(|part| part["type"] == "output_text")
        .filter_map(|part| part["text"].as_str())
        .collect()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn score(v: &Value) -> Option<u8> {
    v.as_u64()
        .and_then(|n| u8::try_from(n).ok())
        .filter(|n| *n <= 10)
}

/// Facts from a schema-valid answer; ids and times are ours and never read from the model.
fn facts_from(v: &Value) -> SegmentFacts {
    SegmentFacts {
        description: v["description"]
            .as_str()
            .unwrap_or_default()
            .trim()
            .to_owned(),
        actions: strings(&v["actions"]),
        objects: strings(&v["objects"]),
        place: v["place"].as_str().map(str::to_owned),
        mood: v["mood"].as_str().map(str::to_owned),
        quality: score(&v["quality"]),
        hook_score: score(&v["hook_score"]),
        status: FactsStatus::Ok,
    }
}

#[cfg(test)]
mod spark_tests;
