//! [`ObjectNamer`] on Muse Spark: `object_label.md` + `object_label.schema.json`, low reasoning
//! effort, the crop as one `input_image` part (a base64 JPEG data URL) after the question.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use nimbytes_core::ports::{ObjectNamer, PortResult, purpose};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::json;

use super::MetaClient;
use super::prompt::{StrictSchema, Template};
use super::reasoner::{SparkReasoner, ask_spark};

/// Reasoning effort of the label call.
const LOW: &str = "low";

/// Spark names a tapped object.
pub struct SparkObjectNamer {
    client: MetaClient,
    prompt: (Template, StrictSchema),
    timeout: Duration,
}

impl SparkObjectNamer {
    /// Uses `prompt`; each call, retries included, must finish within `timeout`.
    pub fn new(client: MetaClient, prompt: (Template, StrictSchema), timeout: Duration) -> Self {
        Self {
            client,
            prompt,
            timeout,
        }
    }

    async fn name(&self, crop: &Path) -> Result<String, AppError> {
        let (template, schema) = &self.prompt;
        let user = template.fill(&[])?;
        let mut body = SparkReasoner::body(LOW, &template.system, &user, schema);
        let bytes = tokio::fs::read(crop)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("object crop: {e}")))?;
        let url = format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        if let Some(content) = body["input"][1]["content"].as_array_mut() {
            content.push(json!({ "type": "input_image", "image_url": url }));
        }
        let v = ask_spark(
            &self.client,
            (purpose::OBJECT_LABEL, self.timeout),
            &body,
            schema,
        )
        .await?;
        v["label"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| AppError::new(ErrorCode::ModelUnavailable, "object_label has no label"))
    }
}

impl ObjectNamer for SparkObjectNamer {
    fn name_object<'a>(&'a self, crop: &'a Path) -> PortResult<'a, String> {
        Box::pin(self.name(crop))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::meta::fake_api::{client, fake_api};

    const PROMPT: &str = include_str!("../../../../prompts/object_label.md");
    const SCHEMA: &str = include_str!("../../../../prompts/object_label.schema.json");

    fn answer(text: &str) -> String {
        json!({"output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]})
            .to_string()
    }

    async fn namer(base: String) -> (SparkObjectNamer, sqlx::SqlitePool) {
        let (c, pool) = client(base).await;
        let prompt = (
            Template::parse(PROMPT).unwrap(),
            StrictSchema::parse("object_label", SCHEMA).unwrap(),
        );
        (
            SparkObjectNamer::new(c, prompt, Duration::from_secs(10)),
            pool,
        )
    }

    #[tokio::test]
    async fn the_crop_goes_as_one_input_image_after_the_question_with_low_effort() {
        let ok = answer(r#"{"label":"red mug"}"#);
        let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
        let (n, _pool) = namer(base).await;
        let dir = tempfile::tempdir().unwrap();
        let crop = dir.path().join("c.jpg");
        std::fs::write(&crop, b"AAA").unwrap();

        assert_eq!(n.name_object(&crop).await.unwrap(), "red mug");

        let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
        assert_eq!(body["model"], "muse-spark-1.3");
        assert_eq!(body["reasoning"]["effort"], "low");
        assert_eq!(body["text"]["format"]["strict"], true);
        let content = body["input"][1]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert!(
            content[0]["text"]
                .as_str()
                .unwrap()
                .starts_with("What is the main thing")
        );
        assert_eq!(
            content[1],
            json!({"type": "input_image", "image_url": "data:image/jpeg;base64,QUFB"})
        );
    }

    #[tokio::test]
    async fn an_answer_outside_the_schema_is_model_unavailable() {
        let bad = answer(r#"{"name":"mug"}"#);
        let (base, _seen) = fake_api(vec![(200, bad.as_str())]).await;
        let (n, _pool) = namer(base).await;
        let dir = tempfile::tempdir().unwrap();
        let crop = dir.path().join("c.jpg");
        std::fs::write(&crop, b"A").unwrap();
        let err = n.name_object(&crop).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ModelUnavailable);
    }
}
