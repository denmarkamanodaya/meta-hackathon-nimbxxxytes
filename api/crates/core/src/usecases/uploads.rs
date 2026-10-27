//! Browser-direct multipart upload: create, re-presign for resume, complete.

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::ids::{ClipId, JobId, UploadId, UserId};
use crate::domain::job::JobKind;
use crate::domain::media::{MediaExt, check_video_content_type};
use crate::domain::upload::{CompletedPart, PresignedPart, Upload, UploadStatus, plan_parts};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectClass};
use crate::ports::{BlobStore, Catalogue, Clock, IdGenerator, JobQueue, NewJob};
use crate::time::format_utc;

/// Longest accepted client file name, in bytes.
pub const MAX_FILENAME_BYTES: usize = 255;

/// Ports the upload use cases need.
pub struct UploadDeps<'a> {
    /// Object storage.
    pub blobs: &'a dyn BlobStore,
    /// Clip and upload rows.
    pub catalogue: &'a dyn Catalogue,
    /// Ingest job queue.
    pub jobs: &'a dyn JobQueue,
    /// Row timestamps.
    pub clock: &'a dyn Clock,
    /// New clip, upload and job ids.
    pub ids: &'a dyn IdGenerator,
}

/// What the client declares about the file it is about to upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewUpload {
    /// Name on the phone (display only).
    pub filename: String,
    /// Exact size in bytes.
    pub size_bytes: u64,
    /// MIME type, `video/*`.
    pub content_type: String,
}

/// A started upload: ids, part size and a presigned URL for every part.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedUpload {
    /// Our upload id (used for resume and completion).
    pub upload_id: UploadId,
    /// The clip being created.
    pub clip_id: ClipId,
    /// Bytes per part (all but the last).
    pub part_size: u64,
    /// One URL per part, `n` ascending from 1.
    pub parts: Vec<PresignedPart>,
}

/// Validates the file, creates the clip (`uploading`) and the S3 multipart upload tagged as an
/// original, and presigns every part.
///
/// # Errors
/// `VALIDATION_FAILED` for a bad name, type or size; store and catalogue errors pass through.
pub async fn create_upload(
    deps: &UploadDeps<'_>,
    user: &UserId,
    req: NewUpload,
) -> Result<CreatedUpload, AppError> {
    let ext = validate(&req)?;
    let plan = plan_parts(req.size_bytes)?;
    let clip_id = ClipId::parse(deps.ids.new_id())?;
    let upload_id = UploadId::parse(deps.ids.new_id())?;
    let key = keys::original(user, &clip_id, ext);
    let store_upload_id = deps
        .blobs
        .create_multipart(&key, &req.content_type, ObjectClass::Original)
        .await?;
    let upload = Upload {
        id: upload_id.clone(),
        user_id: user.clone(),
        clip_id: clip_id.clone(),
        s3_upload_id: store_upload_id,
        key,
        size_bytes: req.size_bytes,
        plan,
        status: UploadStatus::Open,
        created_at: format_utc(deps.clock.now_millis()),
    };
    let clip = new_clip(&upload, req.filename, ext);
    deps.catalogue.insert_upload(&clip, &upload).await?;
    let numbers: Vec<u32> = (1..=plan.part_count).collect();
    let parts = presign(deps.blobs, &upload, &numbers).await?;
    Ok(CreatedUpload {
        upload_id,
        clip_id,
        part_size: plan.part_size,
        parts,
    })
}

/// Presigns fresh URLs for the listed parts of an open upload (resume after a dropped
/// connection or expired URLs).
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` per [`owned_upload`]; `VALIDATION_FAILED` when the upload is already
/// completed, the list is empty or a part number is outside `1..=part_count`.
pub async fn presign_parts(
    deps: &UploadDeps<'_>,
    user: &UserId,
    upload_id: &UploadId,
    part_numbers: &[u32],
) -> Result<Vec<PresignedPart>, AppError> {
    let upload = owned_upload(deps.catalogue, user, upload_id).await?;
    if upload.status == UploadStatus::Completed {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "upload is already completed",
        ));
    }
    let count = upload.plan.part_count;
    let out_of_range = part_numbers.iter().any(|n| !(1..=count).contains(n));
    if part_numbers.is_empty() || part_numbers.len() > count as usize || out_of_range {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "bad part numbers",
        ));
    }
    presign(deps.blobs, &upload, part_numbers).await
}

/// Completes the upload: checks every part is listed once, completes it in the store, verifies
/// the stored size, marks the clip `uploaded` and queues one ingest job. Calling it again after
/// success returns the same clip without touching the store.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` per [`owned_upload`]; `UPLOAD_INCOMPLETE` for a missing, repeated
/// or unordered part, an empty `ETag`, a store rejection or a size mismatch.
pub async fn complete_upload(
    deps: &UploadDeps<'_>,
    user: &UserId,
    upload_id: &UploadId,
    parts: &[CompletedPart],
) -> Result<ClipId, AppError> {
    let upload = owned_upload(deps.catalogue, user, upload_id).await?;
    if upload.status == UploadStatus::Open {
        check_parts(parts, upload.plan.part_count)?;
        deps.blobs
            .complete_multipart(&upload.key, &upload.s3_upload_id, parts)
            .await?;
        let stored = deps.blobs.object_size(&upload.key).await?;
        if stored != upload.size_bytes {
            return Err(AppError::new(
                ErrorCode::UploadIncomplete,
                format!("stored {stored} bytes, expected {}", upload.size_bytes),
            ));
        }
        deps.catalogue
            .finish_upload(&upload.id, &upload.clip_id)
            .await?;
    }
    // Idempotent per clip, so a retry after a failure here still queues exactly one job.
    let job_id = JobId::parse(deps.ids.new_id())?;
    let job = NewJob {
        id: &job_id,
        kind: JobKind::Ingest,
        subject_id: upload.clip_id.as_str(),
    };
    deps.jobs.enqueue(job, deps.clock.now_millis()).await?;
    Ok(upload.clip_id)
}

/// Loads an upload and checks it belongs to `user`, before anything is presigned or completed.
///
/// # Errors
/// `NOT_FOUND` when no such upload exists; `FORBIDDEN` when another user owns it.
pub async fn owned_upload(
    catalogue: &dyn Catalogue,
    user: &UserId,
    upload_id: &UploadId,
) -> Result<Upload, AppError> {
    let upload = catalogue
        .get_upload(upload_id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such upload"))?;
    if &upload.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "upload belongs to another user",
        ));
    }
    Ok(upload)
}

/// The `uploading` clip row an upload creates.
fn new_clip(upload: &Upload, filename: String, ext: MediaExt) -> Clip {
    Clip {
        id: upload.clip_id.clone(),
        user_id: upload.user_id.clone(),
        filename,
        ext,
        size_bytes: upload.size_bytes,
        status: ClipStatus::Uploading,
        probe: None,
        created_at: upload.created_at.clone(),
        title: None,
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    }
}

fn validate(req: &NewUpload) -> Result<MediaExt, AppError> {
    let name_ok = !req.filename.trim().is_empty() && req.filename.len() <= MAX_FILENAME_BYTES;
    if !name_ok {
        return Err(AppError::new(ErrorCode::ValidationFailed, "bad filename"));
    }
    check_video_content_type(&req.content_type)?;
    MediaExt::from_filename(&req.filename)
}

/// Requires parts `1..=count`, each exactly once, ascending, with a non-empty `ETag`.
fn check_parts(parts: &[CompletedPart], count: u32) -> Result<(), AppError> {
    let complete = parts.len() == count as usize
        && parts
            .iter()
            .zip(1..=count)
            .all(|(p, n)| p.n == n && !p.etag.trim().is_empty());
    if complete {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::UploadIncomplete,
            format!("expected parts 1..={count}, each once, ascending, with an ETag"),
        ))
    }
}

async fn presign(
    blobs: &dyn BlobStore,
    upload: &Upload,
    numbers: &[u32],
) -> Result<Vec<PresignedPart>, AppError> {
    let mut parts = Vec::with_capacity(numbers.len());
    for &n in numbers {
        let url = blobs
            .presign_upload_part(&upload.key, &upload.s3_upload_id, n)
            .await?;
        parts.push(PresignedPart { n, url });
    }
    Ok(parts)
}

/// The user's clip that a new upload of `filename` with `size_bytes` would copy, with its title:
/// same name and size, not failed and not itself a duplicate. Checked before uploading, so the
/// owner can skip a file already in the library.
///
/// # Errors
/// Catalogue errors pass through.
pub async fn check_upload(
    catalogue: &dyn Catalogue,
    user: &UserId,
    (filename, size_bytes): (&str, u64),
) -> Result<Option<(ClipId, String)>, AppError> {
    let found = catalogue.same_upload(user, filename, size_bytes).await?;
    Ok(found.map(|c| {
        let title = c.display_title();
        (c.id, title)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(n: u32) -> CompletedPart {
        CompletedPart {
            n,
            etag: format!("\"etag{n}\""),
        }
    }

    #[test]
    fn check_parts_accepts_every_part_once_in_order() {
        assert!(check_parts(&[part(1), part(2), part(3)], 3).is_ok());
    }

    #[test]
    fn check_parts_rejects_missing_repeated_unordered_or_blank_parts() {
        let blank = CompletedPart {
            n: 2,
            etag: " ".into(),
        };
        let cases: [&[CompletedPart]; 5] = [
            &[part(1), part(2)],
            &[part(1), part(2), part(2)],
            &[part(2), part(1), part(3)],
            &[part(1), blank.clone(), part(3)],
            &[],
        ];
        for parts in cases {
            let err = check_parts(parts, 3).unwrap_err();
            assert_eq!(err.code, ErrorCode::UploadIncomplete, "{parts:?}");
        }
    }

    #[test]
    fn validate_rejects_bad_names_and_types() {
        let ok = NewUpload {
            filename: "a.mp4".into(),
            size_bytes: 1,
            content_type: "video/mp4".into(),
        };
        assert_eq!(validate(&ok).unwrap(), MediaExt::Mp4);
        let long = NewUpload {
            filename: format!("{}.mp4", "a".repeat(255)),
            ..ok.clone()
        };
        let blank = NewUpload {
            filename: "  ".into(),
            ..ok.clone()
        };
        let image = NewUpload {
            content_type: "image/png".into(),
            ..ok.clone()
        };
        for bad in [long, blank, image] {
            assert_eq!(
                validate(&bad).unwrap_err().code,
                ErrorCode::ValidationFailed
            );
        }
    }
}
