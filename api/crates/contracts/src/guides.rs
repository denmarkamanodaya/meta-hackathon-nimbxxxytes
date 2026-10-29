//! MyWay: `POST /api/clips/{id}/guide`, `GET /api/guides`, `GET/DELETE /api/guides/{id}` and
//! `PATCH /api/guides/{id}/steps/{n}`. Every key is always present; empty values are `null`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `POST /api/clips/{id}/guide` (202).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StartGuideResponse {
    /// The clip's guide.
    pub guide_id: String,
    /// `queued`, `running`, `ready`, `failed` or `refused`.
    pub status: String,
}

/// One row of `GET /api/guides`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GuideSummary {
    /// Guide id.
    pub id: String,
    /// The clip it is made from.
    pub clip_id: String,
    /// Title; empty until the steps are written.
    pub title: String,
    /// `queued`, `running`, `ready`, `failed` or `refused`.
    pub status: String,
    /// `steps`, `frames`, `highlight`, `voice` or `ready`; `null` before the first stage.
    pub stage: Option<String>,
    /// Why it failed; `null` unless failed.
    pub error: Option<String>,
    /// The clip's title; `null` before it has one or when the clip is gone.
    pub clip_title: Option<String>,
    /// The clip's length, seconds; `null` when the clip is gone.
    pub clip_duration_s: Option<f64>,
    /// How many steps it has.
    pub step_count: u32,
    /// The first step's image; `null` before the frames are made.
    pub cover_url: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
}

/// The circled control of a step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Highlight {
    /// What is circled, for example `round dial`.
    pub label: String,
}

/// One step of a guide.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Step {
    /// 1-based number.
    pub n: u32,
    /// At most 6 words.
    pub title: String,
    /// At most 18 words.
    pub instruction: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// The second the image shows.
    pub key_s: f64,
    /// The step image (circled control when found).
    pub image_url: Option<String>,
    /// The spoken instruction (WAV).
    pub audio_url: Option<String>,
    /// The replay clip (720p MP4 of `start_s`–`end_s`).
    pub clip_url: Option<String>,
    /// `null` when nothing is circled.
    pub highlight: Option<Highlight>,
}

/// `GET /api/guides/{id}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct GuideResponse {
    /// Guide id.
    pub id: String,
    /// The clip it is made from.
    pub clip_id: String,
    /// Title.
    pub title: String,
    /// `queued`, `running`, `ready`, `failed` or `refused`.
    pub status: String,
    /// `steps`, `frames`, `highlight`, `voice` or `ready`; `null` before the first stage.
    pub stage: Option<String>,
    /// Why it failed; `null` unless failed.
    pub error: Option<String>,
    /// `everyday`, `caution` or `not_supported`; `null` until known.
    pub safety: Option<String>,
    /// Spark's reason for `caution` or `not_supported`; `null` for an everyday task.
    pub safety_reason: Option<String>,
    /// The clip's title; `null` before it has one or when the clip is gone.
    pub clip_title: Option<String>,
    /// The clip's length, seconds; `null` when the clip is gone.
    pub clip_duration_s: Option<f64>,
    /// `en`.
    pub language: String,
    /// The steps by number (`[]` while not made or when refused).
    pub steps: Vec<Step>,
}

/// `PATCH /api/guides/{id}`: the new title.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct GuideRename {
    /// 1–60 characters after trimming.
    pub title: String,
}

/// `PATCH /api/guides/{id}/steps/{n}`: either text or both.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StepPatch {
    /// New title, at most 6 words.
    #[serde(default)]
    pub title: Option<String>,
    /// New instruction, at most 18 words.
    #[serde(default)]
    pub instruction: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    #[test]
    fn a_step_with_nothing_made_still_carries_every_key_as_null() {
        let step = Step {
            n: 1,
            title: "Open".into(),
            instruction: "Open the door.".into(),
            start_s: 0.0,
            end_s: 2.0,
            key_s: 1.0,
            image_url: None,
            audio_url: None,
            clip_url: None,
            highlight: None,
        };

        let v: Value = serde_json::to_value(&step).unwrap();

        assert_eq!(
            v,
            json!({"n": 1, "title": "Open", "instruction": "Open the door.", "start_s": 0.0,
                   "end_s": 2.0, "key_s": 1.0, "image_url": null, "audio_url": null,
                   "clip_url": null, "highlight": null})
        );
    }

    #[test]
    fn a_patch_may_send_either_text_and_nothing_else() {
        let p: StepPatch = serde_json::from_str(r#"{"instruction":"Press start."}"#).unwrap();
        assert_eq!(
            (p.title, p.instruction.as_deref()),
            (None, Some("Press start."))
        );
        assert!(serde_json::from_str::<StepPatch>(r#"{"n":2}"#).is_err());
    }
}
