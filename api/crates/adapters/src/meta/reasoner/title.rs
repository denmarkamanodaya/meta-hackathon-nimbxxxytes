//! The clip title: `clip_title.md` + `clip_title.schema.json`, effort minimal, text only (the
//! clip's segment descriptions, one per line).

use nimbytes_core::AppError;
use nimbytes_core::ports::{PortResult, Titler, purpose};

use super::{MINIMAL, SparkReasoner, one_line, unavailable};

/// Longest description line sent, characters.
const DESCRIPTION_CHARS: usize = 300;

impl SparkReasoner {
    async fn write_title(&self, descriptions: &[String]) -> Result<String, AppError> {
        let (template, schema) = &self.prompts.title;
        let lines: Vec<String> = descriptions
            .iter()
            .map(|d| format!("- {}", one_line(d, DESCRIPTION_CHARS)))
            .collect();
        let user = template.fill(&[("descriptions", &lines.join("\n"))])?;
        let body = Self::body(MINIMAL, &template.system, &user, schema);
        let v = self
            .ask((purpose::CLIP_TITLE, self.timeouts.search), body, schema)
            .await?;
        v["title"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| unavailable("clip_title answer has no title"))
    }
}

impl Titler for SparkReasoner {
    fn title<'a>(&'a self, descriptions: &'a [String]) -> PortResult<'a, String> {
        Box::pin(self.write_title(descriptions))
    }
}

#[cfg(test)]
mod title_tests;
