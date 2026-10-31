//! [`Reasoner`] on Muse Spark: query rewrite and rerank (minimal reasoning effort) and the edit
//! plan (low effort), all with `store: false` and strict structured output. Rerank and plan
//! constrain `segment_id` to the ids they were given with a per-call `enum`, and every call
//! (retries included) is capped by a timeout.

mod critique;
mod face_match;
pub mod intent;
mod plan;
mod title;

use std::time::Duration;

use nimbytes_core::domain::critique::Critique;
use nimbytes_core::domain::ids::SegmentId;
use nimbytes_core::domain::search::{Candidate, Found, Rewritten, SearchFilters};
use nimbytes_core::domain::timeline::Timeline;
use nimbytes_core::ports::{
    CritiqueRequest, PlanRequest, PortResult, Reasoner, RewriteRequest, purpose,
};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::prompt::{StrictSchema, Template};
use super::spark::{MODEL, output_text, token_usage};
use super::{MetaCall, MetaClient, json_body};

/// Reasoning effort of the search calls (rewrite, rerank): they sit on a person's wait.
pub(crate) const MINIMAL: &str = "minimal";

/// Longest description and speech excerpt per rerank candidate line, characters.
const DESCRIPTION_CHARS: usize = 300;
const SPEECH_CHARS: usize = 200;

/// The two prompts and their schemas.
pub struct ReasonerPrompts {
    /// `query_rewrite.md` + schema.
    pub rewrite: (Template, StrictSchema),
    /// `rerank.md` + the raw schema JSON (an id enum is added per call).
    pub rerank: (Template, Value),
    /// `plan_edit.md` + the raw `timeline.schema.json` (a segment id enum is added per call).
    pub plan: (Template, Value),
    /// `critique.md` + schema.
    pub critique: (Template, StrictSchema),
    /// `agent_tools.json`: the planner's function tools, sent as given.
    pub tools: Value,
    /// `clip_title.md` + schema.
    pub title: (Template, StrictSchema),
    /// `face_match.md` + schema.
    pub face_match: (Template, StrictSchema),
    /// `intent.md` + schema.
    pub intent: (Template, StrictSchema),
}

/// Whole-call caps, retries included.
#[derive(Debug, Clone, Copy)]
pub struct ReasonerTimeouts {
    /// Rewrite and rerank: a search waits on them.
    pub search: Duration,
    /// Edit plan and critique: they run in a background job.
    pub plan: Duration,
}

/// Spark reasoner.
pub struct SparkReasoner {
    client: MetaClient,
    prompts: ReasonerPrompts,
    timeouts: ReasonerTimeouts,
}

fn unavailable(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ModelUnavailable, msg.into())
}

impl SparkReasoner {
    /// Uses `prompts`; each call, retries included, must finish within its timeout.
    pub fn new(client: MetaClient, prompts: ReasonerPrompts, timeouts: ReasonerTimeouts) -> Self {
        Self {
            client,
            prompts,
            timeouts,
        }
    }

    /// A Responses API body: system + user text, reasoning `effort`, strict schema.
    pub fn body(effort: &str, system: &str, user: &str, schema: &StrictSchema) -> Value {
        json!({
            "model": MODEL,
            "store": false,
            "reasoning": { "effort": effort },
            "text": { "format": schema.format() },
            "input": [
                { "type": "message", "role": "system", "content": [{ "type": "input_text", "text": system }] },
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": user }] },
            ],
        })
    }

    /// Sends `body`, caps it at `timeout`, and returns the schema-checked answer.
    async fn ask(
        &self,
        call: (&str, Duration),
        body: Value,
        schema: &StrictSchema,
    ) -> Result<Value, AppError> {
        ask_spark(&self.client, call, &body, schema).await
    }

    /// Sends `body` through the client (cache, cost log, retries), capped at `timeout`, and
    /// returns the whole response.
    async fn send(&self, call: (&str, Duration), body: &Value) -> Result<Value, AppError> {
        send_spark(&self.client, call, body).await
    }
}

/// A JPEG file (`what`, for the error) as a base64 data URL, to send as an `input_image` part.
pub(crate) async fn jpeg_data_url(path: &std::path::Path, what: &str) -> Result<String, AppError> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("{what}: {e}")))?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes);
    Ok(format!("data:image/jpeg;base64,{encoded}"))
}

/// Sends a Responses API `body` through `client` (cache, cost log, retries), capped at
/// `timeout`, and returns the whole response.
pub(crate) async fn send_spark(
    client: &MetaClient,
    (purpose, timeout): (&str, Duration),
    body: &Value,
) -> Result<Value, AppError> {
    let keyed = body.to_string();
    let build =
        |http: &reqwest::Client, base: &str| Ok(http.post(format!("{base}/responses")).json(body));
    let call = MetaCall {
        model: MODEL,
        purpose,
        timeout,
        fingerprint: &[keyed.as_bytes()],
        build: &build,
        usage: token_usage,
    };
    let raw = tokio::time::timeout(timeout, client.call(call))
        .await
        .map_err(|_| unavailable(format!("{purpose} timed out after {timeout:?}")))??;
    json_body(&raw)
}

/// [`send_spark`], then the answer text checked against `schema`.
pub(crate) async fn ask_spark(
    client: &MetaClient,
    (purpose, timeout): (&str, Duration),
    body: &Value,
    schema: &StrictSchema,
) -> Result<Value, AppError> {
    let raw = send_spark(client, (purpose, timeout), body).await?;
    let text = output_text(&raw);
    schema
        .check(&text)
        .map_err(|e| unavailable(format!("{purpose} answer invalid: {e}")))
}

impl SparkReasoner {
    async fn rewrite_query(&self, r: &RewriteRequest) -> Result<Rewritten, AppError> {
        let (template, schema) = &self.prompts.rewrite;
        let list = |names: &[String]| {
            if names.is_empty() {
                "(none)".to_owned()
            } else {
                names.join(", ")
            }
        };
        let user = template.fill(&[
            ("today", &r.today),
            ("people", &list(&r.people)),
            ("speakers", &list(&r.speakers)),
            ("query", &r.query),
        ])?;
        let v = self
            .ask(
                (purpose::QUERY_REWRITE, self.timeouts.search),
                Self::body(MINIMAL, &template.system, &user, schema),
                schema,
            )
            .await?;
        Ok(rewritten_from(&v))
    }

    async fn rerank_candidates(
        &self,
        query: &str,
        candidates: &[Found],
    ) -> Result<Vec<(SegmentId, String)>, AppError> {
        let (template, raw) = &self.prompts.rerank;
        let ids: Vec<&str> = candidates.iter().map(|c| c.key().as_str()).collect();
        let schema = StrictSchema::from_value("rerank", with_id_enum(raw.clone(), &ids))?;
        let lines: Vec<String> = candidates.iter().map(found_line).collect();
        let user = template.fill(&[("query", query), ("candidates", &lines.join("\n"))])?;
        let v = self
            .ask(
                (purpose::RERANK, self.timeouts.search),
                Self::body(MINIMAL, &template.system, &user, &schema),
                &schema,
            )
            .await?;
        let picks = v["results"].as_array().into_iter().flatten();
        Ok(picks
            .filter_map(|p| {
                Some((
                    SegmentId::parse(p["segment_id"].as_str()?).ok()?,
                    p["reason"].as_str()?.to_owned(),
                ))
            })
            .collect())
    }
}

/// Sets `results.items.properties.segment_id.enum` so the model can only return given ids.
pub fn with_id_enum(mut schema: Value, ids: &[&str]) -> Value {
    schema["properties"]["results"]["items"]["properties"]["segment_id"]["enum"] = json!(ids);
    schema
}

pub(crate) fn one_line(text: &str, max: usize) -> String {
    text.chars()
        .take(max)
        .map(|c| if c == '|' || c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_owned()
}

/// One rerank line: a moment's [`candidate_line`], or a photo's
/// `id | date | photo: title. description Things: … | place | - | -`.
pub fn found_line(f: &Found) -> String {
    match f {
        Found::Moment(c) => candidate_line(c),
        Found::Photo(p) => {
            let ph = &p.photo;
            let date = ph
                .taken_at
                .as_deref()
                .and_then(|d| d.get(..10))
                .unwrap_or("unknown");
            let what = format!(
                "photo: {}. {} Things: {}",
                ph.shown_title(),
                ph.facts.description,
                ph.facts.things.join(", ")
            );
            format!(
                "{} | {date} | {} | {} | - | -",
                p.key,
                one_line(&what, DESCRIPTION_CHARS),
                one_line(&ph.facts.place, 60)
            )
        }
    }
}

/// `id | date | description | place | people | speech`, with `|` and line breaks removed.
pub fn candidate_line(c: &Candidate) -> String {
    let date = c
        .recorded_at
        .as_deref()
        .and_then(|d| d.get(..10))
        .unwrap_or("unknown");
    let people = if c.people.is_empty() {
        "-".to_owned()
    } else {
        c.people.join(", ")
    };
    let speech = if c.speech.trim().is_empty() {
        "-".to_owned()
    } else {
        one_line(&c.speech, SPEECH_CHARS)
    };
    format!(
        "{} | {date} | {} | {} | {} | {speech}",
        c.segment_id,
        one_line(&c.description, DESCRIPTION_CHARS),
        one_line(&c.place, 60),
        one_line(&people, 120)
    )
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .collect()
}

fn text(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// A schema-valid rewrite answer as domain values.
fn rewritten_from(v: &Value) -> Rewritten {
    let f = &v["filters"];
    Rewritten {
        keywords: strings(&v["keywords"])
            .into_iter()
            .map(|k| k.to_lowercase())
            .collect(),
        filters: SearchFilters {
            people: strings(&f["people"]),
            speakers: strings(&f["speakers"]),
            place: text(&f["place"]),
            from: text(&f["from"]),
            to: text(&f["to"]),
            min_quality: f["min_quality"]
                .as_u64()
                .and_then(|q| u8::try_from(q).ok())
                .filter(|q| *q <= 10),
        },
    }
}

impl Reasoner for SparkReasoner {
    fn rewrite<'a>(&'a self, request: &'a RewriteRequest) -> PortResult<'a, Rewritten> {
        Box::pin(self.rewrite_query(request))
    }

    fn rerank<'a>(
        &'a self,
        query: &'a str,
        candidates: &'a [Found],
    ) -> PortResult<'a, Vec<(SegmentId, String)>> {
        Box::pin(self.rerank_candidates(query, candidates))
    }

    fn plan_edit<'a>(&'a self, request: &'a PlanRequest<'a>) -> PortResult<'a, Timeline> {
        Box::pin(self.plan_timeline(request))
    }

    fn critique<'a>(&'a self, request: &'a CritiqueRequest<'a>) -> PortResult<'a, Critique> {
        Box::pin(self.critique_preview(request))
    }
}

#[cfg(test)]
pub(crate) mod reasoner_tests;
