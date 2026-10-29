//! [`DocumentReader`] on Muse Spark. Reading: `document_read.md` + schema, low effort, every
//! page as an `input_image` part (a base64 JPEG data URL) after the question, in page order.
//! Answering: `document_answer.md` + schema, low effort, text only (the stored text and the
//! question). Both send `store: false` with strict structured output.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use nimbytes_core::domain::document::{Reading, kind_of};
use nimbytes_core::ports::{AnswerRequest, DocumentReader, PortResult, ReadRequest, purpose};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::MetaClient;
use super::prompt::{StrictSchema, Template};
use super::reasoner::{SparkReasoner, ask_spark};

/// Reasoning effort of both calls (the spike read a two-page PDF in about 9 s at low).
const LOW: &str = "low";

/// The two prompts with their schemas.
pub struct DocumentPrompts {
    /// `document_read.md` + schema.
    pub read: (Template, StrictSchema),
    /// `document_answer.md` + schema.
    pub answer: (Template, StrictSchema),
}

/// Whole-call caps, retries included.
#[derive(Debug, Clone, Copy)]
pub struct DocumentTimeouts {
    /// Reading up to 10 pages, in a background job.
    pub read: Duration,
    /// One answer, while the person waits.
    pub answer: Duration,
}

/// Spark reading documents.
pub struct SparkDocumentReader {
    client: MetaClient,
    prompts: DocumentPrompts,
    timeouts: DocumentTimeouts,
}

fn unavailable(msg: &str) -> AppError {
    AppError::new(ErrorCode::ModelUnavailable, msg)
}

/// A page as a base64 JPEG data URL (pages are always JPEG, see the read job).
async fn page_url(path: &Path) -> Result<String, AppError> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("document page: {e}")))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/jpeg;base64,{encoded}"))
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

impl SparkDocumentReader {
    /// Uses `prompts`; each call, retries included, must finish within its timeout.
    pub fn new(client: MetaClient, prompts: DocumentPrompts, timeouts: DocumentTimeouts) -> Self {
        Self {
            client,
            prompts,
            timeouts,
        }
    }

    /// The read body: the question, then one `input_image` part per page URL, in order.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn read_body(&self, page_urls: &[String]) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.read;
        let user = template.fill(&[("pages", &page_urls.len().to_string())])?;
        let mut body = SparkReasoner::body(LOW, &template.system, &user, schema);
        if let Some(content) = body["input"][1]["content"].as_array_mut() {
            content.extend(
                page_urls
                    .iter()
                    .map(|url| json!({ "type": "input_image", "image_url": url })),
            );
        }
        Ok(body)
    }

    /// The answer body: the document text and the question, nothing else.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn answer_body(&self, r: AnswerRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.answer;
        let user = template.fill(&[("text", r.text), ("question", r.question)])?;
        Ok(SparkReasoner::body(LOW, &template.system, &user, schema))
    }

    async fn read(&self, r: &ReadRequest) -> Result<Reading, AppError> {
        let mut urls = Vec::with_capacity(r.pages.len());
        for page in &r.pages {
            urls.push(page_url(page).await?);
        }
        let body = self.read_body(&urls)?;
        let schema = &self.prompts.read.1;
        let call = (purpose::DOCUMENT_READ, self.timeouts.read);
        let v = ask_spark(&self.client, call, &body, schema).await?;
        Ok(Reading {
            title: text(&v["title"]),
            kind: kind_of(v["kind"].as_str().unwrap_or_default()),
            sender: text(&v["sender"]),
            date: text(&v["date"]),
            text: text(&v["text"]),
            summary: text(&v["summary"]),
        })
    }

    async fn reply(&self, r: AnswerRequest<'_>) -> Result<String, AppError> {
        let body = self.answer_body(r)?;
        let schema = &self.prompts.answer.1;
        let call = (purpose::DOCUMENT_ANSWER, self.timeouts.answer);
        let v = ask_spark(&self.client, call, &body, schema).await?;
        let answer = text(&v["answer"]).trim().to_owned();
        if answer.is_empty() {
            return Err(unavailable("document_answer is empty"));
        }
        Ok(answer)
    }
}

impl DocumentReader for SparkDocumentReader {
    fn read_pages<'a>(&'a self, request: &'a ReadRequest) -> PortResult<'a, Reading> {
        Box::pin(self.read(request))
    }

    fn answer<'a>(&'a self, request: AnswerRequest<'a>) -> PortResult<'a, String> {
        Box::pin(self.reply(request))
    }
}

#[cfg(test)]
mod document_tests;
