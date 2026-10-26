//! Prompt templates and strict output schemas from `api/prompts/`.

use jsonschema::Validator;
use nimbytes_core::{AppError, ErrorCode};
use serde_json::Value;

fn bad(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::Internal, msg.into())
}

/// A prompt file split into its `## system` and `## user` sections.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Template {
    /// Sent unchanged as the system message (stable prefix for prompt caching).
    pub system: String,
    /// User message with `{name}` placeholders.
    pub user: String,
}

impl Template {
    /// Parses `## system` then `## user` sections.
    ///
    /// # Errors
    /// `INTERNAL` when either section is missing or out of order.
    pub fn parse(md: &str) -> Result<Self, AppError> {
        let after_system = md
            .split_once("## system\n")
            .ok_or_else(|| bad("prompt has no ## system"))?
            .1;
        let (system, user) = after_system
            .split_once("## user\n")
            .ok_or_else(|| bad("prompt has no ## user"))?;
        Ok(Self {
            system: system.trim().to_owned(),
            user: user.trim().to_owned(),
        })
    }

    /// The user message with every `{name}` replaced.
    ///
    /// # Errors
    /// `INTERNAL` when a placeholder is left unfilled.
    pub fn fill(&self, values: &[(&str, &str)]) -> Result<String, AppError> {
        let mut out = self.user.clone();
        for (name, value) in values {
            out = out.replace(&format!("{{{name}}}"), value);
        }
        if let Some(i) = out.find('{').filter(|&i| out[i..].contains('}')) {
            let rest: String = out[i..].chars().take(30).collect();
            return Err(bad(format!("unfilled placeholder near {rest}")));
        }
        Ok(out)
    }
}

/// A JSON Schema sent as strict structured output and checked again on the answer.
pub struct StrictSchema {
    /// Name sent with the schema.
    pub name: String,
    /// The schema as sent: `$schema` and `title` removed.
    pub sent: Value,
    validator: Validator,
}

impl std::fmt::Debug for StrictSchema {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StrictSchema")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

impl StrictSchema {
    /// Loads a schema file.
    ///
    /// # Errors
    /// `INTERNAL` when the file is not JSON or not a valid schema.
    pub fn parse(name: &str, json: &str) -> Result<Self, AppError> {
        let full: Value =
            serde_json::from_str(json).map_err(|e| bad(format!("{name} schema: {e}")))?;
        let validator =
            jsonschema::validator_for(&full).map_err(|e| bad(format!("{name} schema: {e}")))?;
        let mut sent = full;
        if let Some(obj) = sent.as_object_mut() {
            obj.remove("$schema");
            obj.remove("title");
        }
        Ok(Self {
            name: name.to_owned(),
            sent,
            validator,
        })
    }

    /// The `text.format` object for a Responses API request.
    pub fn format(&self) -> Value {
        serde_json::json!({ "type": "json_schema", "name": self.name, "schema": self.sent, "strict": true })
    }

    /// Parses `text` and checks it against the schema; the error lists every violation.
    ///
    /// # Errors
    /// A human-readable message for the retry prompt.
    pub fn check(&self, text: &str) -> Result<Value, String> {
        let value: Value =
            serde_json::from_str(text.trim()).map_err(|e| format!("not valid JSON: {e}"))?;
        let errors: Vec<String> = self
            .validator
            .iter_errors(&value)
            .map(|e| format!("{}: {e}", e.instance_path()))
            .collect();
        if errors.is_empty() {
            Ok(value)
        } else {
            Err(errors.join("; "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FACTS_MD: &str = include_str!("../../../../prompts/segment_facts.md");
    const FACTS_SCHEMA: &str = include_str!("../../../../prompts/segment_facts.schema.json");

    #[test]
    fn the_segment_facts_template_has_both_sections_and_fills_all_placeholders() {
        let t = Template::parse(FACTS_MD).unwrap();
        assert!(t.system.starts_with("You describe one short segment"));
        let user = t
            .fill(&[
                ("start", "8.0"),
                ("end", "14.8"),
                ("recorded_at", "2026-01-28T05:59:00.000Z"),
                ("transcript", "with food."),
            ])
            .unwrap();
        assert!(
            user.starts_with(
                "Segment from 8.0 s to 14.8 s of a clip recorded 2026-01-28T05:59:00.000Z."
            ),
            "{user}"
        );
        assert!(user.contains("Speech in this segment: with food."));
        assert!(
            t.fill(&[("start", "1")]).is_err(),
            "missing placeholders are an error"
        );
    }

    #[test]
    fn schema_is_sent_without_meta_keys_and_checks_answers() {
        let s = StrictSchema::parse("segment_facts", FACTS_SCHEMA).unwrap();
        let f = s.format();
        assert_eq!(
            (
                f["type"].as_str(),
                f["name"].as_str(),
                f["strict"].as_bool()
            ),
            (Some("json_schema"), Some("segment_facts"), Some(true))
        );
        assert!(f["schema"].get("$schema").is_none() && f["schema"].get("title").is_none());
        assert_eq!(f["schema"]["additionalProperties"], false);
        let ok = r#"{"description":"A dog sleeps.","actions":["sleeping"],"objects":["dog"],"place":"sofa","mood":"calm","quality":7,"hook_score":4}"#;
        assert!(s.check(ok).is_ok());
        let err = s
            .check(&ok.replace("\"quality\":7", "\"quality\":11"))
            .unwrap_err();
        assert!(err.contains("/quality"), "{err}");
        assert!(
            s.check("not json")
                .unwrap_err()
                .starts_with("not valid JSON")
        );
        let extra = ok.replace("{\"description\"", "{\"segment_id\":\"x\",\"description\"");
        assert!(s.check(&extra).is_err(), "model-invented ids are rejected");
    }
}
