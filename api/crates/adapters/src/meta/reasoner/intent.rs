//! The ask box: `intent.md` + `intent.schema.json`, effort minimal, text only (the request, the
//! caller's projects, the added clips and the library size). The answer is a raw draft; the
//! domain rules check it.

use nimbytes_core::AppError;
use nimbytes_core::domain::intent::{AskClip, AskProject, Choice, IntentDraft, IntentRequest};
use nimbytes_core::ports::{IntentReader, PortResult, purpose};
use serde_json::Value;

use super::{MINIMAL, SparkReasoner, one_line};

/// Longest project name or clip title sent, characters.
const NAME_CHARS: usize = 80;

/// `id | name | N clips`, one per line; `(none)` when empty.
pub fn project_lines(projects: &[AskProject]) -> String {
    lines(projects.iter().map(|p| {
        format!(
            "{} | {} | {} clips",
            p.id,
            one_line(&p.name, NAME_CHARS),
            p.clip_count
        )
    }))
}

/// `id | title | 12.3 s` (or `unknown length`), one per line; `(none)` when empty.
pub fn clip_lines(clips: &[AskClip]) -> String {
    lines(clips.iter().map(|c| {
        let length = c
            .duration_s
            .map_or_else(|| "unknown length".to_owned(), |d| format!("{d:.1} s"));
        format!("{} | {} | {length}", c.id, one_line(&c.title, NAME_CHARS))
    }))
}

fn lines(rows: impl Iterator<Item = String>) -> String {
    let all: Vec<String> = rows.collect();
    if all.is_empty() {
        "(none)".to_owned()
    } else {
        all.join("\n")
    }
}

fn opt(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

/// A schema-valid answer as a draft.
fn draft_from(v: &Value) -> IntentDraft {
    let strings = |v: &Value| -> Vec<String> {
        v.as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    };
    let choices = v["choices"].as_array().into_iter().flatten();
    IntentDraft {
        kind: v["kind"].as_str().unwrap_or_default().to_owned(),
        title: v["title"].as_str().unwrap_or_default().to_owned(),
        query: opt(&v["query"]),
        source: opt(&v["source"]),
        project_id: opt(&v["project_id"]),
        new_project_name: opt(&v["new_project_name"]),
        clip_ids: strings(&v["clip_ids"]),
        target_s: v["target_s"].as_f64(),
        aspect: opt(&v["aspect"]),
        choices: choices
            .filter_map(|c| {
                Some(Choice {
                    label: c["label"].as_str()?.to_owned(),
                    text: c["text"].as_str()?.to_owned(),
                })
            })
            .collect(),
    }
}

impl SparkReasoner {
    async fn read_request(&self, r: &IntentRequest) -> Result<IntentDraft, AppError> {
        let (template, schema) = &self.prompts.intent;
        let user = template.fill(&[
            ("projects", &project_lines(&r.projects)),
            ("clips", &clip_lines(&r.clips)),
            ("library", &r.library_clips.to_string()),
            ("text", &r.text),
        ])?;
        let body = Self::body(MINIMAL, &template.system, &user, schema);
        let v = self
            .ask((purpose::INTENT, self.timeouts.search), body, schema)
            .await?;
        Ok(draft_from(&v))
    }
}

impl IntentReader for SparkReasoner {
    fn read_intent<'a>(&'a self, request: &'a IntentRequest) -> PortResult<'a, IntentDraft> {
        Box::pin(self.read_request(request))
    }
}

#[cfg(test)]
mod intent_tests;
