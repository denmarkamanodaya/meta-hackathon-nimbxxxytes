//! Face match: `face_match.md` + `face_match.schema.json`, effort minimal, the two face crops as
//! `input_image` parts (base64 JPEG data URLs) after the question.

use std::path::Path;

use nimbytes_core::AppError;
use nimbytes_core::domain::face_match::{FaceKind, FaceVerdict};
use nimbytes_core::ports::{FaceMatcher, PortResult, purpose};
use serde_json::{Value, json};

use super::{MINIMAL, SparkReasoner, jpeg_data_url, unavailable};

impl SparkReasoner {
    async fn compare_faces(&self, a: &Path, b: &Path) -> Result<FaceVerdict, AppError> {
        let (template, schema) = &self.prompts.face_match;
        let user = template.fill(&[])?;
        let mut body = Self::body(MINIMAL, &template.system, &user, schema);
        let images = [
            jpeg_data_url(a, "face crop").await?,
            jpeg_data_url(b, "face crop").await?,
        ];
        if let Some(content) = body["input"][1]["content"].as_array_mut() {
            content.extend(
                images
                    .into_iter()
                    .map(|url| json!({ "type": "input_image", "image_url": url })),
            );
        }
        let v = self
            .ask((purpose::FACE_MATCH, self.timeouts.search), body, schema)
            .await?;
        verdict(&v)
    }
}

fn verdict(v: &Value) -> Result<FaceVerdict, AppError> {
    let bad = || unavailable("face_match answer is incomplete");
    Ok(FaceVerdict {
        same: v["same"].as_bool().ok_or_else(bad)?,
        confidence: v["confidence"].as_f64().ok_or_else(bad)?.clamp(0.0, 1.0),
        kind: FaceKind::parse(v["kind"].as_str().ok_or_else(bad)?)?,
    })
}

impl FaceMatcher for SparkReasoner {
    fn same_face<'a>(&'a self, a: &'a Path, b: &'a Path) -> PortResult<'a, FaceVerdict> {
        Box::pin(self.compare_faces(a, b))
    }
}

#[cfg(test)]
mod face_match_tests;
