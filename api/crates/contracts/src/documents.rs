//! iRead: `POST /api/documents`, `POST /api/documents/{id}/complete`, `GET /api/documents`,
//! `GET/PATCH/DELETE /api/documents/{id}`, `POST /api/documents/{id}/ask` and
//! `POST /api/documents/{id}/speak`. Every key is always present; empty values are `null`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `POST /api/documents` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateDocumentRequest {
    /// The file's name on the device.
    pub filename: String,
    /// `image/jpeg`, `image/png`, `image/webp` or `application/pdf`.
    pub content_type: String,
    /// The file's size, at most 20 MB.
    pub size_bytes: u64,
}

/// `POST /api/documents` (201).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateDocumentResponse {
    /// The new document.
    pub document_id: String,
    /// Presigned PUT, valid 15 minutes; the client PUTs the raw file with its content type.
    pub upload_url: String,
}

/// `POST /api/documents/{id}/complete` (202).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CompleteDocumentResponse {
    /// The document.
    pub document_id: String,
    /// `reading`, or `ready` when it was read before.
    pub status: String,
}

/// One row of `GET /api/documents`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DocumentSummary {
    /// Document id.
    pub id: String,
    /// `""` until read.
    pub title: String,
    /// `letter`, `bill`, `form`, `notice`, `label` or `other`.
    pub kind: String,
    /// Who sent it; may be `""`.
    pub sender: String,
    /// The date printed on it; may be `""`.
    pub date: String,
    /// `uploading`, `reading`, `ready` or `failed`.
    pub status: String,
    /// Pages made so far.
    pub page_count: u32,
    /// Page 1; `null` before the pages are made.
    pub thumb_url: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// Projects this item is in (ids).
    pub project_ids: Vec<String>,
    /// Size of the uploaded file in bytes, as declared when the upload started.
    pub size_bytes: u64,
    /// Why the read failed; `null` unless failed.
    pub error: Option<String>,
}

/// One page of a document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DocumentPage {
    /// 1-based.
    pub n: u32,
    /// The page JPEG.
    pub image_url: String,
}

/// `GET /api/documents/{id}` and `PATCH /api/documents/{id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct DocumentDetail {
    /// Every summary field.
    #[serde(flatten)]
    pub summary_row: DocumentSummary,
    /// At most 60 words; `""` until read.
    pub summary: String,
    /// Every word in reading order; `""` until read.
    pub text: String,
    /// The pages by number.
    pub pages: Vec<DocumentPage>,
    /// The summary spoken (WAV); `null` before it is made or without a voice.
    pub summary_audio_url: Option<String>,
}

/// `PATCH /api/documents/{id}` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RenameDocument {
    /// 1–60 characters after tidying.
    pub title: String,
}

/// `POST /api/documents/{id}/ask` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AskDocumentRequest {
    /// 1–500 characters after trimming.
    pub question: String,
}

/// `POST /api/documents/{id}/ask` (200).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AskDocumentResponse {
    /// The question, trimmed.
    pub question: String,
    /// Spark's answer.
    pub answer: String,
    /// The answer spoken (WAV); `null` when no voice could be made.
    pub audio_url: Option<String>,
}

/// `POST /api/documents/{id}/speak` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SpeakRequest {
    /// 0-based part of the whole text.
    pub part: u32,
}

/// `POST /api/documents/{id}/speak` (200).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SpeakResponse {
    /// The part asked for.
    pub part: u32,
    /// How many parts the text has (about 400 characters each, split at sentence ends).
    pub parts: u32,
    /// The part's text.
    pub text: String,
    /// The part spoken (WAV); `null` when no voice could be made.
    pub audio_url: Option<String>,
}
