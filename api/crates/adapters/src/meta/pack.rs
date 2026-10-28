//! [`PackWriter`] on Muse Spark: one call (`platform_pack.md` + schema) writes the caption and
//! hashtags of every platform, effort low, `store: false`, strict structured output, capped by one
//! timeout (retries included).

use std::time::Duration;

use nimbytes_core::AppError;
use nimbytes_core::domain::export::Platform;
use nimbytes_core::ports::{PackAnswer, PackRequest, PackWriter, PortResult, purpose};
use serde_json::Value;

use super::MetaClient;
use super::prompt::{StrictSchema, Template};
use super::reasoner::{SparkReasoner, ask_spark, one_line};

/// Reasoning effort: the pack runs in the background.
const LOW: &str = "low";
/// What a line says when there is nothing to show.
const NONE: &str = "(none yet)";

/// Spark platform pack writer.
pub struct SparkPackWriter {
    client: MetaClient,
    prompt: (Template, StrictSchema),
    timeout: Duration,
}

impl SparkPackWriter {
    /// Uses `platform_pack.md` and its schema; each call, retries included, must finish within
    /// `timeout`.
    pub fn new(client: MetaClient, prompt: (Template, StrictSchema), timeout: Duration) -> Self {
        Self {
            client,
            prompt,
            timeout,
        }
    }

    /// The platform pack request body.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn pack_body(&self, r: &PackRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompt;
        let platforms: Vec<&str> = r.platforms.iter().map(|p| p.as_str()).collect();
        let moments: Vec<String> = r
            .moments
            .iter()
            .map(|m| format!("- {}", one_line(m, 300)))
            .collect();
        let user = template.fill(&[
            ("platforms", &platforms.join(", ")),
            ("caption", &none_if_empty(r.caption)),
            ("hashtags", &list_or_none(r.hashtags)),
            ("moments", &list_or_none_lines(&moments)),
        ])?;
        Ok(SparkReasoner::body(LOW, &template.system, &user, schema))
    }

    async fn write_pack(&self, r: &PackRequest<'_>) -> Result<Vec<PackAnswer>, AppError> {
        let body = self.pack_body(r)?;
        let call = (purpose::PLATFORM_PACK, self.timeout);
        let v = ask_spark(&self.client, call, &body, &self.prompt.1).await?;
        Ok(pack_from(&v))
    }
}

fn none_if_empty(text: &str) -> String {
    if text.trim().is_empty() {
        NONE.to_owned()
    } else {
        one_line(text, 600)
    }
}

fn list_or_none(items: &[String]) -> String {
    if items.is_empty() {
        NONE.to_owned()
    } else {
        items.join(", ")
    }
}

fn list_or_none_lines(lines: &[String]) -> String {
    if lines.is_empty() {
        NONE.to_owned()
    } else {
        lines.join("\n")
    }
}

/// A schema-valid platform pack as answers (the caller fits and cleans them).
pub fn pack_from(v: &Value) -> Vec<PackAnswer> {
    v["packs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            Some(PackAnswer {
                platform: Platform::parse(p["platform"].as_str()?).ok()?,
                caption: p["caption"].as_str().unwrap_or_default().to_owned(),
                hashtags: p["hashtags"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect(),
            })
        })
        .collect()
}

impl PackWriter for SparkPackWriter {
    fn platform_pack<'a>(
        &'a self,
        request: &'a PackRequest<'a>,
    ) -> PortResult<'a, Vec<PackAnswer>> {
        Box::pin(self.write_pack(request))
    }
}

#[cfg(test)]
mod pack_tests;
