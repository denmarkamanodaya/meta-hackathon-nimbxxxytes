//! [`ListenCoverArtist`] on Muse Image: one text-to-image generation (no anchor) per recording,
//! 1080x1080 JPEG, from `listen_cover.md` (the brief, a blank line, then `Scene: {summary}`).
//! Billed flat per image and logged under `listen_cover`.

use std::time::Duration;

use nimbytes_core::ports::{ListenCoverArtist, ListenCoverRequest, PortResult, purpose};
use nimbytes_core::{AppError, ErrorCode};
use serde_json::Value;

use super::MetaClient;
use super::image::{image_body, image_bytes, send_image};
use super::prompt::Template;

/// Size asked of the model.
pub const COVER_SIZE: &str = "1080x1080";

/// Muse Image recording covers.
pub struct MuseListenCover {
    client: MetaClient,
    template: Template,
    timeout: Duration,
}

impl MuseListenCover {
    /// Uses `listen_cover.md`; one call, retries included, must finish within `timeout`.
    pub fn new(client: MetaClient, template: Template, timeout: Duration) -> Self {
        Self {
            client,
            template,
            timeout,
        }
    }

    /// The generation body for `scene`.
    ///
    /// # Errors
    /// `INTERNAL` for an unfilled template.
    pub fn body(&self, scene: &str) -> Result<Value, AppError> {
        let user = self.template.fill(&[("scene", scene.trim())])?;
        let prompt = format!("{}\n\n{user}", self.template.system);
        Ok(image_body(&prompt, (COVER_SIZE, "jpeg"), &[]))
    }

    async fn draw(&self, r: ListenCoverRequest<'_>) -> Result<(), AppError> {
        let body = self.body(r.scene)?;
        let keyed = body.to_string();
        let raw = send_image(
            (&self.client, self.timeout),
            &body,
            (purpose::LISTEN_COVER, false),
            &[keyed.as_bytes()],
        )
        .await?;
        let bytes = image_bytes(&raw)?;
        tokio::fs::write(r.out, bytes)
            .await
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("writing cover: {e}")))
    }
}

impl ListenCoverArtist for MuseListenCover {
    fn draw_listen_cover<'a>(&'a self, request: ListenCoverRequest<'a>) -> PortResult<'a, ()> {
        Box::pin(self.draw(request))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::fake_api::{client, fake_api};
    use base64::Engine;
    use serde_json::json;

    const PROMPT: &str = include_str!("../../../../prompts/listen_cover.md");

    async fn costs(pool: &sqlx::SqlitePool) -> Vec<(String, f64)> {
        sqlx::query_as("SELECT purpose, cost_usd FROM model_calls ORDER BY rowid")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    /// The one request sent: its path and JSON body.
    fn only_request(seen: &std::sync::Mutex<Vec<crate::meta::fake_api::Seen>>) -> (String, Value) {
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        (
            seen[0].path.clone(),
            serde_json::from_slice(&seen[0].body).unwrap(),
        )
    }

    #[tokio::test]
    async fn one_jpeg_generation_from_the_summary_is_written_and_logged() {
        let jpeg = base64::engine::general_purpose::STANDARD.encode(b"\xff\xd8jpeg");
        let ok = json!({"data": [{"b64_json": jpeg}]}).to_string();
        let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
        let (c, pool) = client(base).await;
        let artist =
            MuseListenCover::new(c, Template::parse(PROMPT).unwrap(), Duration::from_secs(5));
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("cover.jpg");

        let request = ListenCoverRequest {
            scene: " 会议在十点开始。 ",
            out: &out,
        };
        artist.draw_listen_cover(request).await.unwrap();

        assert_eq!(std::fs::read(&out).unwrap(), b"\xff\xd8jpeg");
        let (path, body) = only_request(&seen);
        assert_eq!(path, "/v1/images/generations", "text to image, no anchor");
        assert_eq!(
            [
                &body["model"],
                &body["size"],
                &body["output_format"],
                &body["n"]
            ],
            [
                &json!("muse-image-1.0"),
                &json!("1080x1080"),
                &json!("jpeg"),
                &json!(1)
            ]
        );
        assert!(body.get("images").is_none());
        let prompt = body["prompt"].as_str().unwrap();
        assert!(prompt.starts_with("Cover art for an audio recording in a personal library."));
        assert!(prompt.contains("no text, letters, numbers"));
        assert!(prompt.ends_with("\n\nScene: 会议在十点开始。"), "{prompt}");
        let logged = costs(&pool).await;
        assert_eq!(logged, [("listen_cover".to_owned(), 0.01)]);
    }

    #[tokio::test]
    async fn a_failed_generation_is_model_unavailable_and_writes_nothing() {
        let (base, _seen) = fake_api(vec![(500, "{}")]).await;
        let (c, _pool) = client(base).await;
        let artist =
            MuseListenCover::new(c, Template::parse(PROMPT).unwrap(), Duration::from_secs(5));
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("cover.jpg");
        let request = ListenCoverRequest {
            scene: "x",
            out: &out,
        };
        let err = artist.draw_listen_cover(request).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ModelUnavailable);
        assert!(!out.exists());
    }
}
