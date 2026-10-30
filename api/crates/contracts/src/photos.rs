//! Photos: `POST /api/photos`, `PUT /api/photos/{id}/source`, `GET /api/photos`,
//! `GET/PATCH/DELETE /api/photos/{id}`. A photo is analysed once (Muse Spark description and things,
//! Perception Encoder embedding) and then found by search next to video moments. Every key is
//! always present; empty values are `null`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `POST /api/photos` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreatePhotoRequest {
    /// The file's name on the device.
    pub filename: String,
    /// `image/jpeg`, `image/png`, `image/webp`, `image/heic` or `image/heif`.
    pub content_type: String,
    /// The file's size, at most 40 MB.
    pub size_bytes: u64,
    /// The file's last-modified time on the device (ISO-8601 UTC), used as the date taken when
    /// the photo carries none.
    pub last_modified: Option<String>,
}

/// `POST /api/photos` (201).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreatePhotoResponse {
    /// The new photo.
    pub photo_id: String,
    /// `uploading`: PUT the file to `/api/photos/{id}/source` next.
    pub status: String,
}

/// `PUT /api/photos/{id}/source` (202): stores the file and queues the analysis.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PhotoQueued {
    /// The photo.
    pub photo_id: String,
    /// `analysing`.
    pub status: String,
}

/// One row of `GET /api/photos`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PhotoSummary {
    /// Photo id.
    pub id: String,
    /// Short title Spark wrote; the file name until then.
    pub title: String,
    /// The file name on the device.
    pub filename: String,
    /// `uploading`, `analysing`, `ready` or `failed`.
    pub status: String,
    /// Date taken (from the photo, else the device time), ISO-8601 UTC.
    pub taken_at: Option<String>,
    /// Pixels after orientation; `null` before the photo is read.
    pub width: Option<u32>,
    /// Pixels after orientation; `null` before the photo is read.
    pub height: Option<u32>,
    /// The original file's size.
    pub size_bytes: u64,
    /// Presigned thumbnail JPEG (long edge 480 px); `null` before it is made.
    pub thumb_url: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// Why it failed; `null` unless failed.
    pub error: Option<String>,
}

/// `GET /api/photos/{id}` and `PATCH /api/photos/{id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PhotoDetail {
    /// Every summary field.
    #[serde(flatten)]
    pub summary_row: PhotoSummary,
    /// What is in the photo, one or two sentences; `""` until analysed.
    pub description: String,
    /// Things seen, at most 8, short nouns; empty until analysed.
    pub things: Vec<String>,
    /// Presigned viewing JPEG (long edge 2048 px); `null` before it is made.
    pub image_url: Option<String>,
    /// Presigned original file, for download.
    pub original_url: Option<String>,
    /// Camera make and model when the photo names them.
    pub camera: Option<String>,
}

/// `PATCH /api/photos/{id}` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RenamePhoto {
    /// 1–80 characters after tidying.
    pub title: String,
}
