//! [`PhotoDescriber`] on Muse Spark: `photo_facts.md` + strict schema, low effort, the photo as one
//! `input_image` part (a base64 JPEG data URL) after the user text, `store: false`.

use std::path::Path;
use std::time::Duration;

use base64::Engine;
use nimbytes_core::domain::photo::PhotoFacts;
use nimbytes_core::ports::{PhotoDescriber, PortResult, purpose};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::{Value, json};

use super::MetaClient;
use super::prompt::{StrictSchema, Template};
use super::reasoner::{SparkReasoner, ask_spark};

/// Reasoning effort (the spike described a photo in a few seconds at low).
const LOW: &str = "low";

/// Spark describing photos.
pub struct SparkPhotoDescriber {
    client: MetaClient,
    prompt: (Template, StrictSchema),
    timeout: Duration,
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

/// A schema-valid answer as facts (untidied: the core tidies them).
pub fn facts_from(v: &Value) -> PhotoFacts {
    PhotoFacts {
        title: text(&v["title"]),
        description: text(&v["description"]),
        things: v["things"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        place: text(&v["place"]),
        mood: text(&v["mood"]),
    }
}

impl SparkPhotoDescriber {
    /// Uses `photo_facts.md` and its schema; one call, retries included, must finish within
    /// `timeout`.
    pub fn new(client: MetaClient, prompt: (Template, StrictSchema), timeout: Duration) -> Self {
        Self {
            client,
            prompt,
            timeout,
        }
    }

    /// The body: the prompt text, then the photo as one `input_image` part.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn body(&self, image_url: &str) -> Result<Value, AppError> {
        let (template, schema) = &self.prompt;
        let user = template.fill(&[])?;
        let mut body = SparkReasoner::body(LOW, &template.system, &user, schema);
        if let Some(content) = body["input"][1]["content"].as_array_mut() {
            content.push(json!({ "type": "input_image", "image_url": image_url }));
        }
        Ok(body)
    }

    async fn facts(&self, image: &Path) -> Result<PhotoFacts, AppError> {
        let bytes = tokio::fs::read(image)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("photo: {e}")))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        let body = self.body(&format!("data:image/jpeg;base64,{encoded}"))?;
        let call = (purpose::PHOTO_FACTS, self.timeout);
        let v = ask_spark(&self.client, call, &body, &self.prompt.1).await?;
        Ok(facts_from(&v))
    }
}

impl PhotoDescriber for SparkPhotoDescriber {
    fn describe<'a>(&'a self, image: &'a Path) -> PortResult<'a, PhotoFacts> {
        Box::pin(self.facts(image))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::fake_api::{client, fake_api};

    const PROMPT: &str = include_str!("../../../../prompts/photo_facts.md");
    const SCHEMA: &str = include_str!("../../../../prompts/photo_facts.schema.json");
    const RECORDED: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/photo/photo_facts.response.json"
    ));

    async fn describer(base: String) -> (SparkPhotoDescriber, sqlx::SqlitePool) {
        let (c, pool) = client(base).await;
        let prompt = (
            Template::parse(PROMPT).unwrap(),
            StrictSchema::parse("photo_facts", SCHEMA).unwrap(),
        );
        (
            SparkPhotoDescriber::new(c, prompt, Duration::from_secs(10)),
            pool,
        )
    }

    #[tokio::test]
    async fn the_photo_goes_as_one_input_image_and_the_recorded_answer_reads_back() {
        let (base, seen) = fake_api(vec![(200, RECORDED)]).await;
        let (d, pool) = describer(base).await;
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("spark.jpg");
        std::fs::write(&image, b"JPG").unwrap();

        let f = d.describe(&image).await.unwrap();

        assert_eq!(f.title, "60th Birthday Decorated Stage");
        assert!(f.description.contains("white loveseat"));
        assert_eq!(f.things.len(), 8);
        assert_eq!(
            (f.place.as_str(), f.mood.as_str()),
            ("event hall", "festive")
        );
        let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
        assert_eq!(
            (&body["model"], &body["store"]),
            (&json!("muse-spark-1.3"), &json!(false))
        );
        assert_eq!(body["reasoning"]["effort"], "low");
        assert_eq!(body["text"]["format"]["name"], "photo_facts");
        assert_eq!(body["text"]["format"]["strict"], true);
        let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
        assert!(system.starts_with("You describe one photo from a person's own photo library"));
        assert_eq!(
            body["input"][1]["content"],
            json!([
                {"type": "input_text", "text": "One photo:"},
                {"type": "input_image", "image_url": "data:image/jpeg;base64,SlBH"}
            ])
        );
        let purposes: Vec<String> =
            sqlx::query_scalar("SELECT purpose FROM model_calls ORDER BY rowid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(purposes, ["photo_facts"]);
    }

    #[tokio::test]
    async fn an_answer_off_the_schema_is_model_unavailable() {
        let off = json!({"output": [{"type": "message", "content": [{"type": "output_text",
            "text": "{\"title\":\"x\"}"}]}]})
        .to_string();
        let (base, _seen) = fake_api(vec![(200, off.as_str())]).await;
        let (d, _pool) = describer(base).await;
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("spark.jpg");
        std::fs::write(&image, b"JPG").unwrap();
        assert_eq!(
            d.describe(&image).await.unwrap_err().code,
            ErrorCode::ModelUnavailable
        );
    }
}
