//! `GET /api/clips`.

use nimbytes_core::domain::clip::ClipStatus;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One library row. Fields unknown until processing are `null`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ClipSummary {
    /// Clip id.
    pub clip_id: String,
    /// File name on the phone.
    pub filename: String,
    /// Length in seconds.
    pub duration_s: Option<f64>,
    /// Recording time, ISO-8601 UTC.
    pub recorded_at: Option<String>,
    /// Lifecycle status.
    #[schemars(with = "String")]
    pub status: ClipStatus,
    /// Presigned thumbnail URL.
    pub thumb_url: Option<String>,
    /// Number of segments.
    pub segment_count: u32,
    /// Names of the people seen in the clip.
    pub people: Vec<String>,
}
