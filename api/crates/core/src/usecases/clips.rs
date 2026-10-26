//! Library listing.

use crate::domain::clip::Clip;
use crate::domain::ids::{ClipId, UserId};
use crate::domain::job::{JobKind, StepStatus, progress_snapshot};
use crate::error::{AppError, ErrorCode};
use crate::ports::{Catalogue, JobQueue};

/// Lists the signed-in user's clips, newest first. Only that user's clips are ever returned.
///
/// # Errors
/// Catalogue errors pass through.
pub async fn list_clips(catalogue: &dyn Catalogue, user: &UserId) -> Result<Vec<Clip>, AppError> {
    catalogue.list_clips(user).await
}

/// Loads a clip and checks it belongs to `user`.
///
/// # Errors
/// `NOT_FOUND` when no such clip exists; `FORBIDDEN` when another user owns it.
pub async fn owned_clip(
    catalogue: &dyn Catalogue,
    user: &UserId,
    clip: &ClipId,
) -> Result<Clip, AppError> {
    let found = catalogue
        .get_clip(clip)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such clip"))?;
    if &found.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "clip belongs to another user",
        ));
    }
    Ok(found)
}

/// Checks ownership, then returns the first progress event a new watcher of the clip should get.
///
/// # Errors
/// As [`owned_clip`]; queue errors pass through.
pub async fn watch_clip(
    catalogue: &dyn Catalogue,
    jobs: &dyn JobQueue,
    user: &UserId,
    clip: &ClipId,
) -> Result<Option<(&'static str, StepStatus)>, AppError> {
    owned_clip(catalogue, user, clip).await?;
    let job = jobs.find(JobKind::Ingest, clip.as_str()).await?;
    Ok(progress_snapshot(job.as_ref()))
}
