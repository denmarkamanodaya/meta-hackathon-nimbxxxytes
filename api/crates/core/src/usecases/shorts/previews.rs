//! The preview cleanup the worker runs where object tags (and so the S3 lifecycle rule) are not
//! available: old agent previews are removed, the kept one stays.

use crate::domain::preview_cleanup::{PREVIEW_MAX_AGE_MS, expired_previews};
use crate::error::AppError;
use crate::keys::ObjectKey;
use crate::ports::{BlobStore, Clock, ShortStore};
use crate::time::format_utc;

/// Ports the preview cleanup needs.
pub struct PreviewCleanupDeps<'a> {
    /// Shorts and their versions.
    pub shorts: &'a dyn ShortStore,
    /// The preview objects.
    pub blobs: &'a dyn BlobStore,
    /// Now, for the 7-day cutoff.
    pub clock: &'a dyn Clock,
}

/// Removes the expired previews of every short created more than 7 days ago (previews are
/// rendered while the short is made, so the short's age is theirs): objects first, then the
/// stored keys, so a failure leaves the key for the next run. Returns how many were removed.
///
/// # Errors
/// Store and storage errors.
pub async fn clean_previews(deps: &PreviewCleanupDeps<'_>) -> Result<usize, AppError> {
    let cutoff = format_utc(deps.clock.now_millis() - PREVIEW_MAX_AGE_MS);
    let mut removed = 0;
    for short in deps.shorts.created_before(&cutoff).await? {
        let versions = deps.shorts.versions(&short.id).await?;
        let expired = expired_previews(&short, &versions);
        if expired.is_empty() {
            continue;
        }
        let keys: Vec<ObjectKey> = expired.iter().map(|(_, k)| k.clone()).collect();
        deps.blobs.delete(&keys).await?;
        for (n, _) in &expired {
            deps.shorts.clear_preview(&short.id, *n).await?;
        }
        removed += expired.len();
    }
    Ok(removed)
}
