//! `POST/GET /api/shorts/{id}/exports`, `PUT /api/shorts/{id}/exports/{platform}`,
//! `POST /api/shorts/{id}/exports/{platform}/covers` and `GET /api/shorts/{id}/exports/events`.
//! Platform, export aspect and status are the core's serde types, re-exported so there is one
//! shape.

pub use nimbytes_core::domain::export::{ExportAspect, ExportStatus};
pub use nimbytes_core::domain::job::StepStatus;
pub use nimbytes_core::domain::production::Platform;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Publish a short to these platforms (`tiktok`, `reels`, `shorts`, `feed`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateExportsRequest {
    /// At least one.
    #[schemars(with = "Vec<String>")]
    pub platforms: Vec<Platform>,
}

/// One platform's export.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ExportItem {
    /// `tiktok`, `reels`, `shorts` or `feed`.
    #[schemars(with = "String")]
    pub platform: Platform,
    /// `9:16` for TikTok, Reels and Shorts (one shared render); the short's own for the feed.
    #[schemars(with = "String")]
    pub aspect: ExportAspect,
    /// The version exported.
    pub version_n: u32,
    /// `queued`, `rendering`, `ready` or `failed`.
    #[schemars(with = "String")]
    pub status: ExportStatus,
    /// Presigned video, once ready.
    pub render_url: Option<String>,
    /// Caption (a title for Shorts).
    pub caption: String,
    /// The platform's limit: 2,200 characters, 100 for Shorts.
    pub caption_limit: u32,
    /// Hashtags, each with `#`.
    pub hashtags: Vec<String>,
    /// Presigned covers (WebP), in the order made.
    pub cover_urls: Vec<String>,
    /// The chosen cover's index.
    pub cover_pick: u32,
    /// Last change, ISO-8601 UTC.
    pub updated_at: String,
}

/// `GET /api/shorts/{id}/exports`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ExportsResponse {
    /// One per platform asked for, TikTok, Reels, Shorts, then the feed.
    pub exports: Vec<ExportItem>,
    /// Whether a publish or cover run is in flight (watch `/exports/events`).
    pub busy: bool,
}

/// `PUT /api/shorts/{id}/exports/{platform}`: what changes; absent fields stay.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EditExportRequest {
    /// Within the platform's limit.
    #[serde(default)]
    pub caption: Option<String>,
    /// At most 8.
    #[serde(default)]
    pub hashtags: Option<Vec<String>>,
    /// Index of an existing cover.
    #[serde(default)]
    pub cover_pick: Option<u32>,
}

/// `data` of one unnamed SSE event on `GET /api/shorts/{id}/exports/events`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExportEvent {
    /// `exports`, `pack`, `covers`, `render`, or `done` (the stream then ends).
    pub step: String,
    /// `running`, `done` or `failed` (a failed step ends the stream).
    #[schemars(with = "String")]
    pub status: StepStatus,
}
