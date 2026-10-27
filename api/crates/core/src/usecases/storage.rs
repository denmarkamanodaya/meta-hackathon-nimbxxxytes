//! The storage card: how much the owner keeps in the cloud, and the account's cap.

use crate::domain::ids::UserId;
use crate::domain::storage::{StorageSummary, summarize};
use crate::error::AppError;
use crate::ports::{Catalogue, Clock};

/// The signed-in user's storage summary now.
///
/// # Errors
/// Catalogue errors pass through.
pub async fn storage_summary(
    catalogue: &dyn Catalogue,
    clock: &dyn Clock,
    user: &UserId,
) -> Result<StorageSummary, AppError> {
    let clips = catalogue.list_clips(user).await?;
    Ok(summarize(&clips, clock.now_millis()))
}
