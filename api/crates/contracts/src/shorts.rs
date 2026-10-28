//! `POST /api/shorts`, `GET /api/shorts/{id}`, `PUT /api/shorts/{id}/timeline`,
//! `POST /api/shorts/{id}/render`, `GET /api/shorts/{id}/download`. The timeline and the
//! composition props are the core's serde types, re-exported so there is one shape.

pub use nimbytes_core::domain::critique::Critique;
pub use nimbytes_core::domain::render::ShortProps;
pub use nimbytes_core::domain::short::{ShortStatus, StepKind};
pub use nimbytes_core::domain::timeline::{Aspect, Timeline};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A short to make from picked moments.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateShortRequest {
    /// The owner's words (may be empty, at most 500 characters).
    #[serde(default)]
    pub prompt: String,
    /// Picked segment ids in pick order (1–20, no repeats).
    pub segment_ids: Vec<String>,
    /// `"4:5"` or `"1:1"`.
    #[schemars(with = "String")]
    pub aspect: Aspect,
    /// Wanted length, 3–90 s.
    pub target_s: f64,
}

/// The new short; its agent job is queued.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateShortResponse {
    /// Short id.
    pub short_id: String,
}

/// A short and its final render.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShortSummary {
    /// Short id.
    pub short_id: String,
    /// The owner's words.
    pub prompt: String,
    /// Output frame.
    #[schemars(with = "String")]
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// `planning`, `rendering`, `critiquing`, `revising`, `ready` or `failed`.
    #[schemars(with = "String")]
    pub status: ShortStatus,
    /// Version rated best.
    pub best_version: Option<u32>,
    /// Final render; null until one finished and while a new one runs.
    pub render_url: Option<String>,
}

/// One version of the cut.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShortVersion {
    /// 1-based.
    pub n: u32,
    /// The fitted timeline.
    #[schemars(with = "serde_json::Value")]
    pub timeline: Timeline,
    /// Preview MP4.
    pub preview_url: Option<String>,
    /// The agent's critique of the preview.
    #[schemars(with = "Option<serde_json::Value>")]
    pub critique: Option<Critique>,
    /// Sum of the critique scores.
    pub score_total: Option<f64>,
    /// Exact props a preview render receives (proxy URLs valid 1 h), for the Player.
    #[schemars(with = "Option<serde_json::Value>")]
    pub composition_props: Option<ShortProps>,
}

/// One row of the step log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct AgentStep {
    /// 0-based order.
    pub seq: u32,
    /// `plan`, `tool_call`, `tool_result`, `critique`, `revise` or `final`.
    #[schemars(with = "String")]
    pub kind: StepKind,
    /// Tool name for tool steps.
    pub tool: Option<String>,
    /// Version the step works on.
    pub version: Option<u32>,
    /// One line for the owner.
    pub summary: String,
    /// When, ISO-8601 UTC.
    pub at: String,
}

/// A picked moment: bounds for trimming, thumbnail and description for the cards.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShortSegment {
    /// Segment id.
    pub segment_id: String,
    /// Its clip.
    pub clip_id: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// Presigned thumbnail.
    pub thumb_url: Option<String>,
    /// Facts description.
    pub description: Option<String>,
}

/// `GET /api/shorts/{id}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShortDetail {
    /// The short.
    pub short: ShortSummary,
    /// Versions in order.
    pub versions: Vec<ShortVersion>,
    /// Step log in order.
    pub steps: Vec<AgentStep>,
    /// Picked moments in pick order.
    pub segments: Vec<ShortSegment>,
    /// The most drafts the editor makes (a first cut plus its revisions).
    pub max_drafts: u32,
}

/// The owner's edit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveTimelineRequest {
    /// The edited timeline (a revision is optional here).
    #[schemars(with = "serde_json::Value")]
    pub timeline: Timeline,
}

/// The version the edit became.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SaveTimelineResponse {
    /// New version number.
    pub version: u32,
}

/// Which version to render in full size.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RenderShortRequest {
    /// Version number.
    pub version_n: u32,
}

/// The render job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RenderShortResponse {
    /// Job id.
    pub job_id: String,
}

/// A URL that downloads the final render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DownloadResponse {
    /// Presigned URL with an attachment disposition.
    pub url: String,
}

/// One row of `GET /api/shorts`, newest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShortListItem {
    /// Short id.
    pub short_id: String,
    /// The owner's words.
    pub prompt: String,
    /// Output frame.
    #[schemars(with = "String")]
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// Same values as [`ShortSummary::status`].
    #[schemars(with = "String")]
    pub status: ShortStatus,
    /// Creation time, ISO-8601 UTC.
    pub created_at: String,
    /// Versions made so far.
    pub version_count: u32,
    /// Critique total of the best version (else the highest one), if any was scored.
    pub best_score: Option<f64>,
    /// Thumbnail of the first shot of the best (else latest) version.
    pub thumb_url: Option<String>,
    /// The most drafts the editor makes (a first cut plus its revisions).
    pub max_drafts: u32,
    /// The shown version's post caption, when the agent wrote one.
    pub caption: Option<String>,
}
