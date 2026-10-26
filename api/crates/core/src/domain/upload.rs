//! Multipart upload bookkeeping and the part-planning rule.

use crate::domain::ids::{ClipId, UploadId, UserId};
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;

/// One mebibyte.
pub const MIB: u64 = 1024 * 1024;
/// Part size for files up to [`LARGE_FILE_BYTES`].
pub const SMALL_PART_BYTES: u64 = 8 * MIB;
/// Part size for files larger than [`LARGE_FILE_BYTES`].
pub const LARGE_PART_BYTES: u64 = 16 * MIB;
/// Files strictly larger than this (1 GiB) use [`LARGE_PART_BYTES`].
pub const LARGE_FILE_BYTES: u64 = 1024 * MIB;
/// S3's limit on parts per multipart upload.
pub const MAX_PARTS: u64 = 10_000;

/// How a file is cut into multipart parts. Parts are numbered `1..=part_count`; every part is
/// `part_size` bytes except the last, which is `last_part_size` (1..=part_size) bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PartPlan {
    /// Bytes per part (all but the last).
    pub part_size: u64,
    /// Number of parts, 1..=10,000.
    pub part_count: u32,
    /// Bytes in the last part.
    pub last_part_size: u64,
}

/// Plans the parts for a file of `size_bytes`.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty file or one that needs more than 10,000 parts.
pub fn plan_parts(size_bytes: u64) -> Result<PartPlan, AppError> {
    if size_bytes == 0 {
        return Err(AppError::new(ErrorCode::ValidationFailed, "file is empty"));
    }
    let part_size = if size_bytes > LARGE_FILE_BYTES {
        LARGE_PART_BYTES
    } else {
        SMALL_PART_BYTES
    };
    plan_with_part_size(size_bytes, part_size)
}

/// Rebuilds the plan for a stored upload from its size and recorded part size, so a later change
/// to the sizing rule never changes an upload already in flight.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty file, a zero part size or more than 10,000 parts.
pub fn plan_with_part_size(size_bytes: u64, part_size: u64) -> Result<PartPlan, AppError> {
    if size_bytes == 0 || part_size == 0 {
        return Err(AppError::new(ErrorCode::ValidationFailed, "file is empty"));
    }
    let part_count = size_bytes.div_ceil(part_size);
    if part_count > MAX_PARTS {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "file is too large",
        ));
    }
    let last_part_size = size_bytes - (part_count - 1) * part_size;
    let part_count = u32::try_from(part_count)
        .map_err(|_| AppError::new(ErrorCode::ValidationFailed, "file is too large"))?;
    Ok(PartPlan {
        part_size,
        part_count,
        last_part_size,
    })
}

/// Whether the multipart upload is still accepting parts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadStatus {
    /// Parts may still be uploaded and re-presigned.
    Open,
    /// `CompleteMultipartUpload` succeeded and the size was verified.
    Completed,
}

impl UploadStatus {
    /// Stored text: `open` or `completed`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Completed => "completed",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        match raw {
            "open" => Ok(Self::Open),
            "completed" => Ok(Self::Completed),
            _ => Err(AppError::new(
                ErrorCode::Internal,
                format!("bad upload status {raw}"),
            )),
        }
    }
}

/// Multipart upload of one clip's original.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Upload {
    /// Our id for the upload.
    pub id: UploadId,
    /// Owner; checked before any presign or completion.
    pub user_id: UserId,
    /// The clip this upload creates.
    pub clip_id: ClipId,
    /// S3's multipart upload id.
    pub s3_upload_id: String,
    /// Destination object key.
    pub key: ObjectKey,
    /// Declared file size in bytes; verified against the object after completion.
    pub size_bytes: u64,
    /// Part layout.
    pub plan: PartPlan,
    /// Open or completed.
    pub status: UploadStatus,
    /// Creation time (ISO-8601 UTC).
    pub created_at: String,
}

/// A part the client finished: its 1-based number and the `ETag` S3 returned for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletedPart {
    /// Part number, 1-based.
    pub n: u32,
    /// `ETag` header value from the part's PUT response.
    pub etag: String,
}

/// A presigned `UploadPart` URL for part `n`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresignedPart {
    /// Part number, 1-based.
    pub n: u32,
    /// URL the client PUTs the part bytes to.
    pub url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_file_is_one_short_part() {
        let plan = plan_parts(1).unwrap();
        assert_eq!(
            plan,
            PartPlan {
                part_size: 8 * MIB,
                part_count: 1,
                last_part_size: 1
            }
        );
    }

    #[test]
    fn exact_multiple_ends_with_a_full_part() {
        let plan = plan_parts(24 * MIB).unwrap();
        assert_eq!(plan.part_count, 3);
        assert_eq!(plan.last_part_size, 8 * MIB);
    }

    #[test]
    fn one_gib_still_uses_8_mib_parts_and_one_byte_more_switches_to_16() {
        assert_eq!(plan_parts(LARGE_FILE_BYTES).unwrap().part_size, 8 * MIB);
        assert_eq!(plan_parts(LARGE_FILE_BYTES).unwrap().part_count, 128);
        let big = plan_parts(LARGE_FILE_BYTES + 1).unwrap();
        assert_eq!(big.part_size, 16 * MIB);
        assert_eq!(big.part_count, 65);
        assert_eq!(big.last_part_size, 1);
    }

    #[test]
    fn enforces_the_10000_part_limit() {
        assert_eq!(
            plan_parts(MAX_PARTS * LARGE_PART_BYTES).unwrap().part_count,
            10_000
        );
        let err = plan_parts(MAX_PARTS * LARGE_PART_BYTES + 1).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed);
    }

    #[test]
    fn stored_part_size_rebuilds_the_same_plan() {
        let size = LARGE_FILE_BYTES + 5;
        assert_eq!(
            plan_with_part_size(size, LARGE_PART_BYTES).unwrap(),
            plan_parts(size).unwrap()
        );
    }

    #[test]
    fn rejects_an_empty_file() {
        assert_eq!(plan_parts(0).unwrap_err().code, ErrorCode::ValidationFailed);
    }
}
