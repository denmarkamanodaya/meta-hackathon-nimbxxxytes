//! Removing a short: its jobs, rows and objects. The clips it was cut from are never touched.

use super::manage::ShortDeps;
use super::owned;
use crate::domain::ids::{ShortId, UserId};
use crate::domain::job::JobKind;
use crate::domain::render::render_subject;
use crate::error::AppError;
use crate::keys;

/// Removes a short the user owns.
///
/// Order: its agent job and every render job are cancelled first, so no worker picks them up
/// again or retries them; then its rows go, so a step still running fails its next write instead
/// of bringing the short back (a render that finishes later deletes its own upload); then its
/// objects: each version's preview and the final render; last its working files on the box.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` from the ownership check; queue, store, storage and scratch errors.
pub async fn delete_short(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
) -> Result<(), AppError> {
    owned(deps.shorts, user, id).await?;
    let versions: Vec<u32> = deps
        .shorts
        .versions(id)
        .await?
        .iter()
        .map(|v| v.n)
        .collect();
    deps.jobs.cancel(JobKind::Agent, id.as_str()).await?;
    for n in &versions {
        deps.jobs
            .cancel(JobKind::Render, &render_subject(id, *n))
            .await?;
    }
    deps.shorts.delete(id).await?;
    deps.blobs
        .delete(&keys::short_objects(user, id, &versions))
        .await?;
    deps.scratch.remove_short_dir(id).await
}
