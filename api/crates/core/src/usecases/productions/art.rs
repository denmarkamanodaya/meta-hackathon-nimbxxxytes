//! A production's key art: one Muse Image edit anchored on up to 4 hook frames of its covered
//! shots (else up to 4 of its storyboards), with no text. Drawn once automatically when planning
//! finishes, then again only when the owner asks for new art. Art that cannot be drawn never
//! fails the production.

use std::path::PathBuf;

use super::{StudioDeps, owned};
use crate::domain::brand::theme_for;
use crate::domain::cover::ART_ANCHORS;
use crate::domain::ids::{ProductionId, UserId};
use crate::domain::production::{Production, ProductionStatus, board_size};
use crate::domain::storage_cap::images_estimate;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{ArtRequest, ProductionStore, PutFile};

/// Checks that `user` may ask for new art of production `id`; the caller then runs
/// [`draw_production_art`] in the background.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `STORAGE_FULL`.
pub async fn art_requested(
    deps: &StudioDeps<'_>,
    user: &UserId,
    id: &ProductionId,
) -> Result<(), AppError> {
    owned(deps.store, user, id).await?;
    deps.short.ensure_room(user, images_estimate(1)).await
}

/// Whether the automatic first art of production `id` should run now: its plan finished (it is
/// not planning or failed) and the automatic art never ran. `true` only once.
///
/// # Errors
/// Store errors.
pub async fn auto_art_due(
    store: &dyn ProductionStore,
    id: &ProductionId,
) -> Result<bool, AppError> {
    let planned = store.get(id).await?.is_some_and(|p| {
        !matches!(
            p.status,
            ProductionStatus::Planning | ProductionStatus::Failed
        )
    });
    Ok(planned && store.claim_auto_art(id).await?)
}

/// Draws production `id`'s key art as variation `take`, uploads it and records it.
///
/// # Errors
/// `VALIDATION_FAILED` when it has nothing to draw from; storage, model and store errors. The
/// caller only logs them: art never fails a production.
pub async fn draw_production_art(
    deps: &StudioDeps<'_>,
    id: &ProductionId,
    take: u32,
) -> Result<(), AppError> {
    let Some(p) = deps.store.get(id).await? else {
        return Ok(());
    };
    let anchors = anchors(deps, &p).await?;
    if anchors.is_empty() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "nothing to draw the art from yet",
        ));
    }
    let dir = deps.scratch.user_dir(&p.user_id).await?;
    let kit = deps.brand.brand_kit(&p.user_id).await?;
    let request = ArtRequest {
        shape: p.aspect.as_str(),
        size: board_size(p.aspect),
        theme: p.title.clone(),
        accent: theme_for(kit.as_ref()).accent,
        anchors,
        take,
        out: dir.join(format!("art_{}.webp", p.id)),
    };
    deps.short
        .ensure_room(&p.user_id, images_estimate(1))
        .await?;
    deps.images.draw_art(&request).await?;
    let key = keys::production_art(&p.user_id, &p.id);
    let put = PutFile {
        key: &key,
        path: &request.out,
        content_type: "image/webp",
        class: None,
        cache_control: Some(DERIVED_CACHE_CONTROL),
    };
    deps.blobs().put_file(put).await?;
    deps.store.set_art(&p.id, &key).await
}

/// Up to 4 local images to draw from: the covering moments' frames in play order, else the
/// storyboards. Downloads that fail are left out.
async fn anchors(deps: &StudioDeps<'_>, p: &Production) -> Result<Vec<PathBuf>, AppError> {
    let shots = deps.store.shots(&p.id).await?;
    let covered: Vec<_> = shots
        .iter()
        .filter_map(|s| s.matched_segment_id.clone())
        .take(ART_ANCHORS)
        .collect();
    let sources: Vec<ObjectKey> = if covered.is_empty() {
        shots
            .iter()
            .filter_map(|s| s.board_key.clone())
            .take(ART_ANCHORS)
            .collect()
    } else {
        let moments = deps
            .search
            .catalogue
            .candidates(&p.user_id, &covered)
            .await?;
        covered
            .iter()
            .filter_map(|seg| moments.iter().find(|c| &c.segment_id == seg))
            .map(|c| keys::thumb(&p.user_id, &c.clip_id, &c.segment_id))
            .collect()
    };
    let dir = deps.scratch.user_dir(&p.user_id).await?;
    let mut out = Vec::with_capacity(sources.len());
    for (i, key) in sources.iter().enumerate() {
        // Keep the object's extension: the model is told each anchor's image type.
        let ext = key.as_str().rsplit('.').next().unwrap_or("jpg");
        let path = dir.join(format!("art_{}_{i}.{ext}", p.id));
        if deps.blobs().get_to_file(key, &path).await.is_ok() {
            out.push(path);
        }
    }
    Ok(out)
}
