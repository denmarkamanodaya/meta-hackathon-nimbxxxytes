//! How a short is finished before rendering: privacy blur, opening title, speaker colours and
//! the subject effect. Defaults apply until the owner saves a finish.

use super::{ShortDeps, owned};
use crate::domain::ids::{ShortId, UserId};
use crate::domain::privacy::{ShortFinish, checked_finish, finish_or_default};
use crate::error::AppError;

/// The short's finish: the saved one, else the defaults (blur as its production chose, else on).
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub async fn short_finish(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
) -> Result<ShortFinish, AppError> {
    owned(deps.shorts, user, id).await?;
    let stored = deps.privacy.finish(id).await?;
    Ok(finish_or_default(
        stored,
        deps.privacy.production_blur(id).await?,
    ))
}

/// Saves the short's finish and returns it as stored. Renders made from now on follow it.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a title over 80 characters; store errors.
pub async fn update_finish(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
    finish: ShortFinish,
) -> Result<ShortFinish, AppError> {
    owned(deps.shorts, user, id).await?;
    let finish = checked_finish(finish)?;
    deps.privacy.put_finish(id, &finish).await?;
    Ok(finish)
}
