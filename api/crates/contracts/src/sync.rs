//! `GET /api/sync/manifest`, `POST /api/sync/clips/{id}/original` and
//! `POST /api/sync/items/{kind}/{id}/original`: what the Mac app mirrors
//! into its local folder. The desktop app imports these types, so this file is the one source of
//! the sync shapes.

pub use nimbytes_core::domain::short::ShortStatus;
pub use nimbytes_core::domain::timeline::Aspect;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The owner's full sync snapshot. The response also carries the etag as a quoted `ETag` header;
/// sending it back in `If-None-Match` answers `304` with an empty body while nothing changed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SyncManifest {
    /// Lower-case hex SHA-256 over every field below except the URLs and `proxy_size_bytes`, so
    /// it stays the same when URLs are re-signed (hourly).
    pub etag: String,
    /// Ready clips only (never duplicates), newest upload first.
    pub clips: Vec<SyncClip>,
    /// Every short, newest first.
    pub shorts: Vec<SyncShort>,
    /// Every other library file (iListen recordings with an uploaded file, iRead documents,
    /// photos) that has its original stored, newest first. Mirrored into `Library/` like clips.
    pub items: Vec<SyncItem>,
}

/// One non-video library file the Mac mirrors: its original streams from storage on demand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SyncItem {
    /// `listen`, `document` or `photo`.
    pub kind: String,
    /// The item's id within its kind.
    pub id: String,
    /// The title the library shows.
    pub title: String,
    /// File name as uploaded.
    pub filename: String,
    /// Extension of the stored original (`mp3`, `wav`, `m4a`, `mp4`, `pdf`, `jpg`, `png`, …).
    pub ext: String,
    /// Size of the stored original in bytes.
    pub size_bytes: u64,
    /// The date the file name carries (recording upload time, document date added, photo taken
    /// time), ISO-8601 UTC.
    pub dated_at: String,
}

/// One ready clip and its 720p proxy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SyncClip {
    /// Clip id.
    pub clip_id: String,
    /// The title the library shows (written title, else the file name without extension).
    pub title: String,
    /// File name as uploaded.
    pub filename: String,
    /// Extension of the original: `mp4`, `mov` or `m4v`.
    pub ext: String,
    /// Size of the original in bytes.
    pub size_bytes: u64,
    /// Duration in seconds; null when the clip was never probed.
    pub duration_s: Option<f64>,
    /// Average frame rate; null when the clip was never probed.
    pub fps: Option<f64>,
    /// Display width after rotation, pixels; null when never probed.
    pub width: Option<u32>,
    /// Display height after rotation, pixels; null when never probed.
    pub height: Option<u32>,
    /// Recording time (ISO-8601 UTC); null when never probed.
    pub recorded_at: Option<String>,
    /// Presigned GET of the 720p proxy (supports byte ranges), valid for the server's URL TTL.
    pub proxy_url: String,
    /// Size of the proxy in bytes; null when storage could not tell (use `Content-Length`).
    pub proxy_size_bytes: Option<u64>,
}

/// One short and its final render.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SyncShort {
    /// Short id.
    pub short_id: String,
    /// The owner's words.
    pub prompt: String,
    /// Output frame, `"4:5"` or `"1:1"`.
    #[schemars(with = "String")]
    pub aspect: Aspect,
    /// `planning`, `rendering`, `critiquing`, `revising`, `ready` or `failed`.
    #[schemars(with = "String")]
    pub status: ShortStatus,
    /// Version rated best.
    pub best_version: Option<u32>,
    /// Presigned GET of the final render; null until one finished and while a new one runs.
    pub render_url: Option<String>,
    /// Creation time, ISO-8601 UTC.
    pub created_at: String,
}

/// A URL that downloads a clip's original as `<title>.<ext>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct OriginalResponse {
    /// Presigned GET with an attachment disposition, valid for the server's URL TTL.
    pub url: String,
}
