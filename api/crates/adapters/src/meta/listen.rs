//! [`ListenInterpreter`] on Muse Spark: understand (`listen_understand.md`, low effort), merge
//! (`listen_merge.md`, low), check (`listen_check.md`, medium: the checker back-translates every
//! line) and fix (`listen_fix.md`, low). All text only, `store: false`, strict structured output.
//! Turns are sent as `index [speaker] words` lines, drafts as compact JSON.

use std::time::Duration;

use nimbytes_core::domain::listen::{
    CheckAnswer, Draft, DraftTurn, FixAnswer, FixTurn, ListenTurn, Overview, TurnCheck,
};
use nimbytes_core::ports::{
    CheckRequest, FixRequest, ListenInterpreter, MergeRequest, PortResult, UnderstandRequest,
    purpose,
};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::MetaClient;
use super::prompt::{StrictSchema, Template};
use super::reasoner::{SparkReasoner, ask_spark};

/// Effort of understand, merge and fix.
const LOW: &str = "low";
/// Effort of the checker (spike 31.1: medium caught both planted errors).
const MEDIUM: &str = "medium";

/// The four prompts with their schemas.
pub struct ListenPrompts {
    /// `listen_understand.md` + schema.
    pub understand: (Template, StrictSchema),
    /// `listen_merge.md` + schema.
    pub merge: (Template, StrictSchema),
    /// `listen_check.md` + schema.
    pub check: (Template, StrictSchema),
    /// `listen_fix.md` + schema.
    pub fix: (Template, StrictSchema),
}

/// Spark understanding and checking transcripts.
pub struct SparkListenInterpreter {
    client: MetaClient,
    prompts: ListenPrompts,
    timeout: Duration,
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn index(v: &Value) -> Option<u32> {
    v["index"].as_u64().and_then(|n| u32::try_from(n).ok())
}

fn items(v: &Value) -> impl Iterator<Item = &Value> {
    v.as_array().into_iter().flatten()
}

/// One `index [speaker] words` line per turn.
pub fn turn_lines(turns: &[ListenTurn]) -> String {
    turns
        .iter()
        .map(|t| {
            let speaker = t.speaker.as_deref().unwrap_or("-");
            format!("{} [{speaker}] {}", t.index, t.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The draft as the checker sees it: every line's language and translation, the summary and
/// key points.
fn check_draft(d: &Draft) -> String {
    let turns: Vec<Value> = d
        .turns
        .iter()
        .map(|t| json!({ "index": t.index, "lang": t.lang, "translation": t.translation }))
        .collect();
    json!({ "turns": turns, "summary": d.summary, "key_points": d.key_points }).to_string()
}

/// The draft as the fixer sees it: the shape it answers in.
fn fix_draft(d: &Draft) -> String {
    let turns: Vec<Value> = d
        .turns
        .iter()
        .map(|t| json!({ "index": t.index, "translation": t.translation }))
        .collect();
    json!({ "turns": turns, "summary": d.summary, "key_points": d.key_points }).to_string()
}

/// Each part's overview as one block.
fn part_blocks(parts: &[Overview]) -> String {
    parts
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let points: Vec<String> = p.key_points.iter().map(|k| format!("- {k}")).collect();
            format!(
                "Part {}: {}\n{}\n{}",
                i + 1,
                p.title,
                p.summary,
                points.join("\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// A schema-valid understand answer as a draft (untidied: the core tidies it).
pub fn draft_from(v: &Value) -> Draft {
    Draft {
        title: text(&v["title"]),
        turns: items(&v["turns"])
            .filter_map(|t| {
                Some(DraftTurn {
                    index: index(t)?,
                    lang: text(&t["lang"]),
                    translation: text(&t["translation"]),
                })
            })
            .collect(),
        summary: text(&v["summary"]),
        key_points: strings(&v["key_points"]),
    }
}

/// A schema-valid check answer; scores are clamped to 0-100.
pub fn check_from(v: &Value) -> CheckAnswer {
    let score = |s: &Value| {
        s.as_i64()
            .map_or(0, |n| u32::try_from(n.clamp(0, 100)).unwrap_or(0))
    };
    CheckAnswer {
        turns: items(&v["turns"])
            .filter_map(|t| {
                Some(TurnCheck {
                    index: index(t)?,
                    back_translation: text(&t["back_translation"]),
                    score: score(&t["score"]),
                    issue: text(&t["issue"]),
                    heard_as: text(&t["heard_as"]),
                })
            })
            .collect(),
        summary_score: score(&v["summary_score"]),
        summary_issues: strings(&v["summary_issues"]),
    }
}

/// A schema-valid fix answer.
pub fn fix_from(v: &Value) -> FixAnswer {
    FixAnswer {
        turns: items(&v["turns"])
            .filter_map(|t| {
                Some(FixTurn {
                    index: index(t)?,
                    translation: text(&t["translation"]),
                })
            })
            .collect(),
        summary: text(&v["summary"]),
        key_points: strings(&v["key_points"]),
    }
}

impl SparkListenInterpreter {
    /// Uses `prompts`; each call, retries included, must finish within `timeout`.
    pub fn new(client: MetaClient, prompts: ListenPrompts, timeout: Duration) -> Self {
        Self {
            client,
            prompts,
            timeout,
        }
    }

    /// The understand body.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn understand_body(&self, r: UnderstandRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.understand;
        let user = template.fill(&[("target", r.target.name), ("turns", &turn_lines(r.turns))])?;
        Ok(SparkReasoner::body(LOW, &template.system, &user, schema))
    }

    /// The merge body.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn merge_body(&self, r: MergeRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.merge;
        let user = template.fill(&[("target", r.target.name), ("parts", &part_blocks(r.parts))])?;
        Ok(SparkReasoner::body(LOW, &template.system, &user, schema))
    }

    /// The check body.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn check_body(&self, r: CheckRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.check;
        let user = template.fill(&[
            ("part", r.part),
            ("turns", &turn_lines(r.turns)),
            ("draft", &check_draft(r.draft)),
        ])?;
        Ok(SparkReasoner::body(MEDIUM, &template.system, &user, schema))
    }

    /// The fix body.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn fix_body(&self, r: FixRequest<'_>) -> Result<Value, AppError> {
        let (template, schema) = &self.prompts.fix;
        let user = template.fill(&[
            ("target", r.target.name),
            ("turns", &turn_lines(r.turns)),
            ("draft", &fix_draft(r.draft)),
            ("notes", &r.notes.join("\n")),
        ])?;
        Ok(SparkReasoner::body(LOW, &template.system, &user, schema))
    }

    async fn ask(
        &self,
        purpose: &str,
        body: Result<Value, AppError>,
        schema: &StrictSchema,
    ) -> Result<Value, AppError> {
        ask_spark(&self.client, (purpose, self.timeout), &body?, schema).await
    }

    async fn understood(&self, r: UnderstandRequest<'_>) -> Result<Draft, AppError> {
        let schema = &self.prompts.understand.1;
        let v = self
            .ask(purpose::LISTEN_UNDERSTAND, self.understand_body(r), schema)
            .await?;
        Ok(draft_from(&v))
    }

    async fn merged(&self, r: MergeRequest<'_>) -> Result<Overview, AppError> {
        let schema = &self.prompts.merge.1;
        let v = self
            .ask(purpose::LISTEN_MERGE, self.merge_body(r), schema)
            .await?;
        Ok(Overview {
            title: text(&v["title"]),
            summary: text(&v["summary"]),
            key_points: strings(&v["key_points"]),
        })
    }

    async fn checked(&self, r: CheckRequest<'_>) -> Result<CheckAnswer, AppError> {
        let schema = &self.prompts.check.1;
        let v = self
            .ask(purpose::LISTEN_CHECK, self.check_body(r), schema)
            .await?;
        Ok(check_from(&v))
    }

    async fn fixed(&self, r: FixRequest<'_>) -> Result<FixAnswer, AppError> {
        let schema = &self.prompts.fix.1;
        let v = self
            .ask(purpose::LISTEN_FIX, self.fix_body(r), schema)
            .await?;
        let answer = fix_from(&v);
        if answer.turns.is_empty() && answer.summary.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::ModelUnavailable,
                "listen_fix answered nothing",
            ));
        }
        Ok(answer)
    }
}

impl ListenInterpreter for SparkListenInterpreter {
    fn understand<'a>(&'a self, request: UnderstandRequest<'a>) -> PortResult<'a, Draft> {
        Box::pin(self.understood(request))
    }

    fn merge<'a>(&'a self, request: MergeRequest<'a>) -> PortResult<'a, Overview> {
        Box::pin(self.merged(request))
    }

    fn check<'a>(&'a self, request: CheckRequest<'a>) -> PortResult<'a, CheckAnswer> {
        Box::pin(self.checked(request))
    }

    fn fix<'a>(&'a self, request: FixRequest<'a>) -> PortResult<'a, FixAnswer> {
        Box::pin(self.fixed(request))
    }
}

#[cfg(test)]
mod listen_tests;
