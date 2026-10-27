//! Library listing, watching a clip, and removing one.

use crate::domain::clip::Clip;
use crate::domain::ids::{ClipId, SegmentId, TrackId, UserId};
use crate::domain::job::{JobKind, StepStatus, progress_snapshot};
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{BlobStore, Catalogue, JobQueue, TextIndex, VectorIndex};

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

/// Ports removing a clip needs.
pub struct RemoveDeps<'a> {
    /// Rows.
    pub catalogue: &'a dyn Catalogue,
    /// The clip's objects.
    pub blobs: &'a dyn BlobStore,
    /// The clip's search documents.
    pub text: &'a dyn TextIndex,
    /// The clip's segment vectors.
    pub vectors: &'a dyn VectorIndex,
}

/// Removes a clip the user owns: its search documents and vectors, every object it owns, then
/// its rows. Objects go before rows, so a failure part-way leaves a row to retry the removal from.
///
/// # Errors
/// As [`owned_clip`]; index, storage and catalogue errors pass through.
pub async fn delete_clip(
    deps: &RemoveDeps<'_>,
    user: &UserId,
    id: &ClipId,
) -> Result<(), AppError> {
    let clip = owned_clip(deps.catalogue, user, id).await?;
    let (segments, tracks) = match deps.catalogue.clip_detail(id).await? {
        Some(rows) => (
            rows.segments
                .into_iter()
                .map(|s| s.segment.id)
                .collect::<Vec<SegmentId>>(),
            rows.tracks
                .into_iter()
                .map(|t| t.id)
                .collect::<Vec<TrackId>>(),
        ),
        None => (Vec::new(), Vec::new()),
    };
    deps.text.remove(&segments).await?;
    deps.vectors.remove(&segments).await?;
    deps.blobs
        .delete(&keys::clip_objects(&clip, &segments, &tracks))
        .await?;
    deps.catalogue.delete_clip(id).await
}
