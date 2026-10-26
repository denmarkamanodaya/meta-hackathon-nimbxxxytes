//! The edit plan: `plan_edit.md` + `timeline.schema.json`, effort low, the picked moments as one
//! line each, and `clips.items.properties.segment_id` limited to their ids for this call.

use nimbytes_core::AppError;
use nimbytes_core::domain::critique::previous_text;
use nimbytes_core::domain::short::ShortSegment;
use nimbytes_core::domain::timeline::Timeline;
use nimbytes_core::ports::{PlanRequest, PlannerToolCall, PlannerTools};
use serde_json::{Value, json};

use super::{SparkReasoner, one_line, unavailable};
use crate::meta::prompt::StrictSchema;
use crate::meta::spark::output_text;

/// Reasoning effort of the plan: it shapes the whole cut, and no one waits on it.
const LOW: &str = "low";
/// Longest description and speech excerpt per moment line, characters.
const DESCRIPTION_CHARS: usize = 300;
const SPEECH_CHARS: usize = 200;
/// Rounds of one plan call: up to three of tool calls, then one that must answer.
pub const MAX_TOOL_TURNS: u32 = 4;
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
    /// The filled user message: request, target, moment lines and the version being revised.
    fn plan_user(&self, r: &PlanRequest<'_>) -> Result<String, AppError> {
        let template = &self.prompts.plan.0;
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
        template.fill(&[
            ("request", request),
            ("target_seconds", &format!("{}", r.target_s)),
            ("aspect", r.aspect.as_str()),
            ("segments", &lines.join("\n")),
            ("previous", &previous),
        ])
    }

    /// Asks for a timeline; while the model calls tools (at most [`MAX_TOOL_TURNS`] rounds) the
    /// calls are answered and the whole exchange is sent again (`store: false` keeps nothing
    /// server side), then the last round offers no tools so the model must answer.
    pub(super) async fn plan_timeline(&self, r: &PlanRequest<'_>) -> Result<Timeline, AppError> {
        let (template, raw) = &self.prompts.plan;
        let allowed: Vec<&str> = if r.allowed_ids.is_empty() {
            r.segments.iter().map(|s| s.segment_id.as_str()).collect()
        } else {
            r.allowed_ids.iter().map(|id| id.as_str()).collect()
        };
        let schema =
            StrictSchema::from_value("timeline", with_segment_enum(raw.clone(), &allowed))?;
        let mut body = Self::body(LOW, &template.system, &self.plan_user(r)?, &schema);
        for round in 1..=MAX_TOOL_TURNS {
            let offer = r.tools.filter(|_| round < MAX_TOOL_TURNS);
            match offer {
                Some(_) => body["tools"] = self.prompts.tools.clone(),
                None => drop(body.as_object_mut().and_then(|o| o.remove("tools"))),
            }
            let answer = self.send(("plan_edit", self.timeouts.plan), &body).await?;
            let calls = function_calls(&answer);
            let (Some(tools), false) = (offer, calls.is_empty()) else {
                let v = schema
                    .check(&output_text(&answer))
                    .map_err(|e| unavailable(format!("plan_edit answer invalid: {e}")))?;
                return serde_json::from_value(v)
                    .map_err(|e| unavailable(format!("plan_edit answer unusable: {e}")));
            };
            let input = body["input"]
                .as_array_mut()
                .ok_or_else(|| unavailable("no input"))?;
            input.extend(answer["output"].as_array().cloned().unwrap_or_default());
            for (call_id, name, args) in calls {
                let output = run_tool(tools, &name, &args).await;
                input.push(
                    json!({ "type": "function_call_output", "call_id": call_id, "output": output }),
                );
            }
        }
        Err(unavailable("plan_edit kept calling tools"))
    }
}

/// `(call_id, name, arguments)` of every `function_call` item in a response.
fn function_calls(answer: &Value) -> Vec<(String, String, String)> {
    let items = answer["output"].as_array().into_iter().flatten();
    items
        .filter(|o| o["type"] == "function_call")
        .filter_map(|o| {
            Some((
                o["call_id"].as_str()?.to_owned(),
                o["name"].as_str()?.to_owned(),
                o["arguments"].as_str().unwrap_or("{}").to_owned(),
            ))
        })
        .collect()
}

/// The typed call for a tool name and its JSON arguments, or why it cannot be run.
pub fn parse_tool_call(name: &str, args: &str) -> Result<PlannerToolCall, String> {
    let v: Value =
        serde_json::from_str(args).map_err(|_| format!("{name}: arguments are not JSON"))?;
    let field = |key: &str| {
        v[key]
            .as_str()
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("{name}: {key} is required"))
    };
    match name {
        "search_moments" => Ok(PlannerToolCall::SearchMoments {
            query: field("query")?,
        }),
        "get_segment" => Ok(PlannerToolCall::GetSegment {
            segment_id: field("segment_id")?,
        }),
        other => Err(format!(
            "unknown tool {other}; use search_moments or get_segment"
        )),
    }
}

/// Runs one call and returns the JSON text sent back as its output; errors go back to the model
/// as `{"error": …}` so it can carry on.
async fn run_tool(tools: &dyn PlannerTools, name: &str, args: &str) -> String {
    let answer = match parse_tool_call(name, args) {
        Ok(call) => tools.call(call).await,
        Err(why) => Err(why),
    };
    match answer {
        Ok(moments) => json!({ "moments": moments }).to_string(),
        Err(error) => json!({ "error": error }).to_string(),
    }
}

#[cfg(test)]
mod plan_tests;
#[cfg(test)]
mod plan_tools_tests;
