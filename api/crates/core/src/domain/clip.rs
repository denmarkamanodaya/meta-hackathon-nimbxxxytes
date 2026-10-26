//! A clip: one uploaded video file and its processing status.

use serde::{Deserialize, Serialize};

use crate::domain::ids::{ClipId, UserId};
use crate::domain::media::MediaExt;
use crate::error::{AppError, ErrorCode};

/// Lifecycle of a clip, from first byte to fully understood. Serialised lower case, the same
/// text as the stored column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipStatus {
    /// Multipart upload created, parts still arriving.
    Uploading,
    /// Upload completed and verified; ingest job queued.
    Uploaded,
    /// Ingest pipeline running.
    Processing,
    /// Searchable.
    Ready,
    /// Ingest gave up; see the clip's error code.
    Failed,
}

impl ClipStatus {
    /// Stored and wire text: `uploading`, `uploaded`, `processing`, `ready`, `failed`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uploading => "uploading",
            Self::Uploaded => "uploaded",
            Self::Processing => "processing",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text (only this module writes the column).
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [
            Self::Uploading,
            Self::Uploaded,
            Self::Processing,
            Self::Ready,
            Self::Failed,
        ]
        .into_iter()
        .find(|s| s.as_str() == raw)
        .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad clip status {raw}")))
    }
}

/// One uploaded video file.
#[derive(Debug, Clone, PartialEq)]
pub struct Clip {
    /// Clip id (UUIDv7 text).
    pub id: ClipId,
    /// Owner.
    pub user_id: UserId,
    /// File name as the phone sent it (display only, never part of a key).
    pub filename: String,
    /// Container extension of the original.
    pub ext: MediaExt,
    /// Size of the original in bytes.
    pub size_bytes: u64,
    /// Where the clip is in its lifecycle.
    pub status: ClipStatus,
    /// Media length in seconds; known after probing.
    pub duration_s: Option<f64>,
    /// Recording time (ISO-8601 UTC); known after probing.
    pub recorded_at: Option<String>,
    /// Creation time of the row (ISO-8601 UTC).
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_text_round_trips() {
        for s in [
            ClipStatus::Uploading,
            ClipStatus::Uploaded,
            ClipStatus::Processing,
            ClipStatus::Ready,
            ClipStatus::Failed,
        ] {
            assert_eq!(ClipStatus::parse(s.as_str()).unwrap(), s);
        }
        assert_eq!(
            ClipStatus::parse("x").unwrap_err().code,
            ErrorCode::Internal
        );
    }
}
