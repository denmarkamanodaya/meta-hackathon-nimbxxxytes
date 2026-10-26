//! The edit plan: `plan_edit.md` + `timeline.schema.json`, effort low, the picked moments as one
//! line each, and `clips.items.properties.segment_id` limited to their ids for this call.

use nimbytes_core::AppError;
use nimbytes_core::domain::critique::previous_text;
use nimbytes_core::domain::short::ShortSegment;
use nimbytes_core::domain::timeline::Timeline;
use nimbytes_core::ports::PlanRequest;
use serde_json::{Value, json};

use super::{SparkReasoner, one_line, unavailable};
use crate::meta::prompt::StrictSchema;

/// Reasoning effort of the plan: it shapes the whole cut, and no one waits on it.
const LOW: &str = "low";
/// Longest description and speech excerpt per moment line, characters.
const DESCRIPTION_CHARS: usize = 300;
const SPEECH_CHARS: usize = 200;
/// What `{previous}` says before any version exists.
const NO_PREVIOUS: &str = "(none)";

/// Sets `clips.items.properties.segment_id.enum` so the model can only cut given moments.
pub fn with_segment_enum(mut schema: Value, ids: &[&str]) -> Value {
    schema["properties"]["clips"]["items"]["properties"]["segment_id"]["enum"] = json!(ids);
    schema
}

fn score(s: Option<u8>) -> String {
    s.map_or_else(|| "-".to_owned(), |q| q.to_string())
}

/// `id | start–end | description | hook | quality | speech`, `|` and line breaks removed.
pub fn moment_line(s: &ShortSegment) -> String {
    let speech: Vec<&str> = s.turns.iter().map(|t| t.text.as_str()).collect();
    let speech = one_line(&speech.join(" "), SPEECH_CHARS);
    let description = one_line(s.description.as_deref().unwrap_or(""), DESCRIPTION_CHARS);
    let dash = |t: String| if t.is_empty() { "-".to_owned() } else { t };
    format!(
        "{} | {:.1}–{:.1} | {} | {} | {} | {}",
        s.segment_id,
        s.span.start_s,
        s.span.end_s,
        dash(description),
        score(s.hook_score),
        score(s.quality),
        dash(speech)
    )
}

impl SparkReasoner {
    pub(super) async fn plan_timeline(&self, r: &PlanRequest<'_>) -> Result<Timeline, AppError> {
        let (template, raw) = &self.prompts.plan;
        let ids: Vec<&str> = r.segments.iter().map(|s| s.segment_id.as_str()).collect();
        let schema = StrictSchema::from_value("timeline", with_segment_enum(raw.clone(), &ids))?;
        let lines: Vec<String> = r.segments.iter().map(moment_line).collect();
        let mut previous = match r.previous {
            Some(p) => {
                let json = serde_json::to_string(p.timeline)
                    .map_err(|e| unavailable(format!("timeline to JSON: {e}")))?;
                previous_text(&json, p.critique)
            }
            None => NO_PREVIOUS.to_owned(),
        };
        if let Some(why) = r.rejection {
            previous.push_str(&format!(
                "\n\nYour last answer was refused: {why}. Answer again and fix that."
            ));
        }
        let request = if r.prompt.trim().is_empty() {
            "(none: make the best short from these moments)"
        } else {
            r.prompt
        };
        let user = template.fill(&[
            ("request", request),
            ("target_seconds", &format!("{}", r.target_s)),
            ("aspect", r.aspect.as_str()),
            ("segments", &lines.join("\n")),
            ("previous", &previous),
        ])?;
        let body = Self::body(LOW, &template.system, &user, &schema);
        let v = self
            .ask(("plan_edit", self.timeouts.plan), body, &schema)
            .await?;
        serde_json::from_value(v)
            .map_err(|e| unavailable(format!("plan_edit answer unusable: {e}")))
    }
}

#[cfg(test)]
mod plan_tests;
