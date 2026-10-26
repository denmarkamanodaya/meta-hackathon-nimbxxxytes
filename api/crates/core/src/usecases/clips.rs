//! Library listing.

use crate::domain::clip::Clip;
use crate::domain::ids::UserId;
use crate::error::AppError;
use crate::ports::Catalogue;

/// Lists the signed-in user's clips, newest first. Only that user's clips are ever returned.
///
/// # Errors
/// Catalogue errors pass through.
pub async fn list_clips(catalogue: &dyn Catalogue, user: &UserId) -> Result<Vec<Clip>, AppError> {
    catalogue.list_clips(user).await
}
