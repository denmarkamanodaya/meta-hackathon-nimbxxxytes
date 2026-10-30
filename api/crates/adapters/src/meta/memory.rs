//! [`MemoryWriter`] on Muse Spark: write (`memory_write.md`) and check (`memory_check.md`), both
//! low effort, `store: false`, strict structured output, multimodal. The moments go as compact
//! JSON in the user text; after it come labelled `input_image` parts (base64 JPEG data URLs): a
//! face picture per named person ("Face of Ann:"), then a frame per moment ("Frame of moment 2:").

use std::time::Duration;

use nimbytes_core::AppError;
use nimbytes_core::domain::memory::{LineCheck, MemoryMoment, WriteAnswer, WrittenLine};
use nimbytes_core::ports::{MemoryRequest, MemoryWriter, PortResult, purpose};
use serde_json::{Value, json};

use super::MetaClient;
use super::prompt::{StrictSchema, Template};
use super::reasoner::{SparkReasoner, ask_spark, jpeg_data_url};

/// Effort of both calls (the spike's).
const LOW: &str = "low";

/// What the prompt says when nobody watching is named.
pub const NO_VIEWER: &str = "(nobody named)";

/// The two prompts with their schemas.
pub struct MemoryPrompts {
    /// `memory_write.md` + schema.
    pub write: (Template, StrictSchema),
    /// `memory_check.md` + schema.
    pub check: (Template, StrictSchema),
}

/// Spark writing and checking Memory Lane sessions.
pub struct SparkMemoryWriter {
    client: MetaClient,
    prompts: MemoryPrompts,
    timeout: Duration,
}

/// The moments as the prompts see them: index, people present, date, event, description, said.
pub fn source_json(moments: &[MemoryMoment]) -> String {
    let rows: Vec<Value> = moments
        .iter()
        .map(|m| {
            json!({
                "index": m.index,
                "people_present": m.names(),
                "date": m.recorded_at,
                "event": m.clip_title,
                "description": m.description,
                "said": m.said,
            })
        })
        .collect();
    json!({ "moments": rows }).to_string()
}

/// The session's lines as the checker sees them.
fn session_json(moments: &[MemoryMoment]) -> String {
    let rows: Vec<Value> = moments
        .iter()
        .map(|m| json!({ "index": m.index, "line": m.line, "prompt": m.prompt }))
        .collect();
    Value::Array(rows).to_string()
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

fn index(v: &Value) -> Option<u32> {
    v["index"].as_u64().and_then(|n| u32::try_from(n).ok())
}

fn items(v: &Value) -> impl Iterator<Item = &Value> {
    v.as_array().into_iter().flatten()
}

/// A schema-valid write answer.
pub fn write_from(v: &Value) -> WriteAnswer {
    WriteAnswer {
        title: text(&v["title"]),
        moments: items(&v["moments"])
            .filter_map(|m| {
                Some(WrittenLine {
                    index: index(m)?,
                    line: text(&m["line"]),
                    prompt: text(&m["prompt"]),
                })
            })
            .collect(),
    }
}

/// A schema-valid check answer.
pub fn check_from(v: &Value) -> Vec<LineCheck> {
    items(&v["moments"])
        .filter_map(|m| {
            Some(LineCheck {
                index: index(m)?,
                supported: m["supported"].as_bool()?,
                unsupported_claims: items(&m["unsupported_claims"])
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect(),
                line: text(&m["line"]),
            })
        })
        .collect()
}

/// `body` with the request's faces and frames appended to the user message, each after its label.
async fn with_images(mut body: Value, r: MemoryRequest<'_>) -> Result<Value, AppError> {
    let mut parts = Vec::new();
    for face in r.faces {
        parts.push(json!({ "type": "input_text", "text": format!("Face of {}:", face.name) }));
        let url = jpeg_data_url(&face.path, "face crop").await?;
        parts.push(json!({ "type": "input_image", "image_url": url }));
    }
    for (m, frame) in r.moments.iter().zip(r.frames) {
        let label = format!("Frame of moment {}:", m.index);
        parts.push(json!({ "type": "input_text", "text": label }));
        let url = jpeg_data_url(frame, "moment frame").await?;
        parts.push(json!({ "type": "input_image", "image_url": url }));
    }
    if let Some(content) = body["input"][1]["content"].as_array_mut() {
        content.extend(parts);
    }
    Ok(body)
}

impl SparkMemoryWriter {
    /// Uses `prompts`; each call, retries included, must finish within `timeout`.
    pub fn new(client: MetaClient, prompts: MemoryPrompts, timeout: Duration) -> Self {
        Self {
            client,
            prompts,
            timeout,
        }
    }

    /// The write body, images included.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template or an unreadable image.
    pub async fn write_body(&self, r: MemoryRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.write;
        let user = template.fill(&[
            ("viewer", r.viewer.unwrap_or(NO_VIEWER)),
            ("moments", &source_json(r.moments)),
        ])?;
        with_images(SparkReasoner::body(LOW, &template.system, &user, schema), r).await
    }

    /// The check body, images included.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template or an unreadable image.
    pub async fn check_body(&self, r: MemoryRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.check;
        let user = template.fill(&[
            ("viewer", r.viewer.unwrap_or(NO_VIEWER)),
            ("sources", &source_json(r.moments)),
            ("session", &session_json(r.moments)),
        ])?;
        with_images(SparkReasoner::body(LOW, &template.system, &user, schema), r).await
    }

    async fn written(&self, r: MemoryRequest<'_>) -> Result<WriteAnswer, AppError> {
        let body = self.write_body(r).await?;
        let schema = &self.prompts.write.1;
        let call = (purpose::MEMORY_WRITE, self.timeout);
        Ok(write_from(
            &ask_spark(&self.client, call, &body, schema).await?,
        ))
    }

    async fn checked(&self, r: MemoryRequest<'_>) -> Result<Vec<LineCheck>, AppError> {
        let body = self.check_body(r).await?;
        let schema = &self.prompts.check.1;
        let call = (purpose::MEMORY_CHECK, self.timeout);
        Ok(check_from(
            &ask_spark(&self.client, call, &body, schema).await?,
        ))
    }
}

impl MemoryWriter for SparkMemoryWriter {
    fn write<'a>(&'a self, request: MemoryRequest<'a>) -> PortResult<'a, WriteAnswer> {
        Box::pin(self.written(request))
    }

    fn check<'a>(&'a self, request: MemoryRequest<'a>) -> PortResult<'a, Vec<LineCheck>> {
        Box::pin(self.checked(request))
    }
}

#[cfg(test)]
mod memory_tests;
