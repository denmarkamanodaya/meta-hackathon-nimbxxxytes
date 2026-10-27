//! `POST /api/uploads`, `POST /api/uploads/{id}/parts`, `POST /api/uploads/{id}/complete`.

use nimbytes_core::domain::clip::ClipStatus;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Start an upload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateUploadRequest {
    /// File name on the phone; its extension must be `mp4`, `mov` or `m4v`.
    pub filename: String,
    /// Exact file size in bytes.
    pub size_bytes: u64,
    /// MIME type, `video/*`.
    pub content_type: String,
}

/// A presigned S3 `UploadPart` URL for part `n` (1-based).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PresignedPart {
    /// Part number, 1-based.
    pub n: u32,
    /// URL to PUT the part bytes to; read the `ETag` response header.
    pub url: String,
}

/// Started upload: `part_size` in bytes; `parts` covers every part.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateUploadResponse {
    /// Upload id for resume and completion.
    pub upload_id: String,
    /// The clip being created.
    pub clip_id: String,
    /// Bytes per part; the last part may be shorter.
    pub part_size: u64,
    /// One URL per part.
    pub parts: Vec<PresignedPart>,
}

/// Re-presign some parts (resume).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PresignPartsRequest {
    /// Part numbers still to upload.
    pub part_numbers: Vec<u32>,
}

/// Fresh URLs for the requested parts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct PresignPartsResponse {
    /// One URL per requested part.
    pub parts: Vec<PresignedPart>,
}

/// Where the Mac app PUTs the clip's 720p proxy (`POST /api/uploads/{id}/proxy`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProxyUploadResponse {
    /// Presigned PUT URL; send the MP4 as the body.
    pub url: String,
}

/// A finished part: its number and the `ETag` header S3 returned for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CompletedPart {
    /// Part number, 1-based.
    pub n: u32,
    /// `ETag` response header, quotes included.
    pub etag: String,
}

/// Complete the upload; parts in ascending `n`, every part once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CompleteUploadRequest {
    /// Every part.
    pub parts: Vec<CompletedPart>,
}

/// The registered clip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CompleteUploadResponse {
    /// The clip id.
    pub clip_id: String,
    /// Always `uploaded`.
    #[schemars(with = "String")]
    pub status: ClipStatus,
}

/// `POST /api/uploads/check`: is this file already in the library? (A POST, so the file name never
/// sits in a URL.)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UploadCheckRequest {
    /// File name on the phone.
    pub filename: String,
    /// Size in bytes.
    pub size_bytes: u64,
}

/// The library clip a file matches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExistingClip {
    /// Clip id.
    pub clip_id: String,
    /// Its title.
    pub title: String,
}

/// `POST /api/uploads/check` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct UploadCheckResponse {
    /// The clip with the same name and size, or null.
    pub duplicate_of: Option<ExistingClip>,
}
