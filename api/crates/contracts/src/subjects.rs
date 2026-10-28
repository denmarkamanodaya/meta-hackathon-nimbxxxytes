//! SAM features: `POST/GET /api/shorts/{id}/reframe` (keep subject in frame),
//! `POST /api/clips/{id}/find` (Find this) and `POST /api/clips/{id}/cutout` (Cut out). The
//! reframe status is the core's serde type, re-exported so there is one shape.

pub use nimbytes_core::domain::reframe::ReframeStatus;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One followed shot of a short.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ReframeShot {
    /// The shot's moment.
    pub segment_id: String,
    /// What the shot follows (its timeline `subject`).
    pub subject: String,
    /// Frames the subject was seen in (0 until tracked).
    pub frames_tracked: u32,
    /// Frames of the shot at 12 fps (0 until tracked).
    pub frames_total: u32,
    /// Seconds the subject was out of view.
    pub lost_s: f64,
}

/// `GET /api/shorts/{id}/reframe`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ReframeResponse {
    /// `idle`, `running`, `ready` or `failed`.
    #[schemars(with = "String")]
    pub status: ReframeStatus,
    /// The shots with a subject (at most 20) of the version exports use.
    pub shots: Vec<ReframeShot>,
}

/// `POST /api/clips/{id}/find` and `POST /api/clips/{id}/cutout`: where the owner tapped.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TapRequest {
    /// Clip second.
    pub t_s: f64,
    /// 0–1 of the displayed frame's width.
    pub x: f64,
    /// 0–1 of the displayed frame's height.
    pub y: f64,
}

/// A clip range, seconds.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct InView {
    /// Start.
    pub start_s: f64,
    /// End.
    pub end_s: f64,
}

/// The tapped object's outline in the tapped frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct OutlineBody {
    /// SVG path in frame pixels (scale it from `frame_w` × `frame_h` to the displayed video).
    pub path: String,
    /// Frame width the path refers to.
    pub frame_w: u32,
    /// Frame height the path refers to.
    pub frame_h: u32,
}

/// One moment the tapped object shows up in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct FindHitBody {
    /// The clip.
    pub clip_id: String,
    /// Its title.
    pub clip_title: String,
    /// When it was recorded, ISO-8601 UTC, if known.
    pub recorded_at: Option<String>,
    /// The moment.
    pub segment_id: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// Presigned thumbnail.
    pub thumb_url: String,
    /// Similarity 0–1.
    pub score: f64,
}

/// `POST /api/clips/{id}/find`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct FindResponse {
    /// 1–3 lowercase words.
    pub label: String,
    /// Where the object is in view in the tapped clip.
    pub in_view: InView,
    /// Its outline; null when SAM found nothing at the tap (a crop around the tap was searched).
    pub outline: Option<OutlineBody>,
    /// The tapped clip first, then other clips best first; at most 12.
    pub hits: Vec<FindHitBody>,
}

/// `POST /api/clips/{id}/cutout`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CutoutResponse {
    /// 1–3 lowercase words.
    pub label: String,
    /// Presigned transparent PNG cropped to the object.
    pub png_url: String,
    /// Presigned sticker PNG (white outline, 12 px padding).
    pub sticker_url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tap_refuses_unknown_fields_and_a_reframe_status_is_snake_case() {
        let t: TapRequest = serde_json::from_str(r#"{"t_s":4.2,"x":0.5,"y":0.25}"#).unwrap();
        assert_eq!((t.t_s, t.x, t.y), (4.2, 0.5, 0.25));
        assert!(serde_json::from_str::<TapRequest>(r#"{"t_s":1,"x":0,"y":0,"z":1}"#).is_err());
        let r = ReframeResponse {
            status: ReframeStatus::Running,
            shots: vec![],
        };
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"status":"running","shots":[]}"#
        );
    }

    #[test]
    fn a_find_without_an_outline_sends_null() {
        let f = FindResponse {
            label: "red mug".into(),
            in_view: InView {
                start_s: 3.0,
                end_s: 9.0,
            },
            outline: None,
            hits: vec![],
        };
        assert_eq!(
            serde_json::to_string(&f).unwrap(),
            r#"{"label":"red mug","in_view":{"start_s":3.0,"end_s":9.0},"outline":null,"hits":[]}"#
        );
    }
}
