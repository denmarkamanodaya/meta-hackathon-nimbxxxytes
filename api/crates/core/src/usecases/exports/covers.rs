//! More ways to make a cover: redraw one with the owner's words, use a production's key art, and
//! bake the published cover (the picked one with its title laid over it by the renderer). Every
//! way of adding a cover stops at the platform's 9-cover cap.

use super::run::{DrawnCover, hook_frame, source, store_covers};
use super::{ExportDeps, export_of, invalid, owned_short, step};
use crate::domain::brand::theme_for;
use crate::domain::cover::{
    CoverInfo, CoverStyle, PublishedCover, checked_instruction, cover_slots, effective_title,
    published_cover,
};
use crate::domain::export::ShortExport;
use crate::domain::ids::{ProductionId, ShortId, UserId};
use crate::domain::job::StepStatus;
use crate::domain::production::Platform;
use crate::domain::render::cover_still_props;
use crate::domain::storage_cap::images_estimate;
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::RedrawRequest;
use crate::usecases::productions::owned as owned_production;

/// One redraw the owner asked for: cover `from` becomes new cover `n`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedrawPlan {
    /// The cover redrawn.
    pub from: u32,
    /// The new cover's number.
    pub n: u32,
    /// The owner's words, trimmed.
    pub instruction: String,
}

/// Checks a redraw of cover `from` with `instruction` and returns the plan; the caller then runs
/// [`draw_redraw`].
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` without that export; `VALIDATION_FAILED` for an
/// instruction outside 3 to 120 characters, a cover that does not exist, or at 9 covers;
/// `STORAGE_FULL` when the new cover would not fit under the cap.
pub async fn redraw_requested(
    deps: &ExportDeps<'_>,
    user: &UserId,
    (id, platform): (&ShortId, Platform),
    (from, instruction): (u32, &str),
) -> Result<RedrawPlan, AppError> {
    let instruction = checked_instruction(instruction)?;
    let current = export_of(deps, user, id, platform).await?;
    if from as usize >= current.cover_keys.len() {
        return Err(invalid("that cover does not exist"));
    }
    let n = cover_slots(current.cover_keys.len(), 1)?.start;
    deps.short.ensure_room(user, images_estimate(1)).await?;
    Ok(RedrawPlan {
        from,
        n,
        instruction,
    })
}

/// Redraws one cover in the background (anchored on that cover, then the real hook frame) and
/// appends it as a `redrawn` cover. Progress: `covers`, then `done`, or a failed `covers` step.
///
/// # Errors
/// Never; a failed redraw is reported on the stream.
pub async fn draw_redraw(
    deps: &ExportDeps<'_>,
    (id, platform): (&ShortId, Platform),
    plan: RedrawPlan,
) -> Result<(), AppError> {
    deps.emit(id, step::COVERS, StepStatus::Running);
    match redraw(deps, (id, platform), &plan).await {
        Ok(()) => deps.emit(id, step::DONE, StepStatus::Done),
        Err(_) => deps.emit(id, step::COVERS, StepStatus::Failed),
    }
    Ok(())
}

async fn redraw(
    deps: &ExportDeps<'_>,
    (id, platform): (&ShortId, Platform),
    plan: &RedrawPlan,
) -> Result<(), AppError> {
    let row = row_of(deps, id, platform).await?;
    let src = source(deps, id, row.version_n).await?;
    let from = row
        .cover_keys
        .get(plan.from as usize)
        .ok_or_else(|| invalid("that cover does not exist"))?;
    let dir = deps.short.scratch.short_dir(id).await?;
    let cover = dir.join(format!("redraw_{}_{}.webp", platform.as_str(), plan.from));
    deps.short.blobs.get_to_file(from, &cover).await?;
    let mut anchors = vec![cover];
    anchors.extend(hook_frame(deps, &src, &dir).await);
    let request = RedrawRequest {
        aspect: row.aspect,
        instruction: plan.instruction.clone(),
        anchors,
        out: dir.join(format!("cover_{}_{}.webp", platform.as_str(), plan.n)),
    };
    deps.images.redraw_cover(&request).await?;
    let drawn = DrawnCover {
        n: plan.n,
        out: &request.out,
        info: CoverInfo {
            style: CoverStyle::Redrawn,
            instruction: Some(plan.instruction.clone()),
        },
    };
    let stored = store_covers(deps, (&src.short, platform), &[drawn]).await?;
    if stored == 0 {
        return Err(AppError::new(
            ErrorCode::Internal,
            "the cover upload failed",
        ));
    }
    Ok(())
}

async fn row_of(
    deps: &ExportDeps<'_>,
    id: &ShortId,
    platform: Platform,
) -> Result<ShortExport, AppError> {
    deps.exports
        .exports(id)
        .await?
        .into_iter()
        .find(|e| e.platform == platform)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no export for that platform"))
}

/// The platforms of the short whose published cover still has to be made (the title shows and
/// no titled still is recorded).
///
/// # Errors
/// Store errors.
pub async fn bakes_due(deps: &ExportDeps<'_>, id: &ShortId) -> Result<Vec<Platform>, AppError> {
    let Some(short) = deps.short.shorts.get(id).await? else {
        return Ok(Vec::new());
    };
    Ok(deps
        .exports
        .exports(id)
        .await?
        .into_iter()
        .filter(|e| baking(e, &short.prompt))
        .map(|e| e.platform)
        .collect())
}

fn baking(e: &ShortExport, fallback: &str) -> bool {
    let title = effective_title(e.cover_title.as_ref(), &e.caption, fallback);
    let published = published_cover(
        &e.cover_keys,
        e.cover_pick,
        title.show,
        e.titled_cover_key.as_ref(),
    );
    published == PublishedCover::Baking
}

/// Makes the published cover of one export: the picked cover with its title laid over it by the
/// renderer, recorded only if the pick and title did not change meanwhile. Returns `true` once
/// nothing is left to do (also when there was nothing to do), `false` when the owner changed the
/// pick or title while it was being made (the caller makes it again).
///
/// # Errors
/// Store, signing and `RENDER_FAILED` errors.
pub async fn bake_titled_cover(
    deps: &ExportDeps<'_>,
    (id, platform): (&ShortId, Platform),
) -> Result<bool, AppError> {
    let Some(short) = deps.short.shorts.get(id).await? else {
        return Ok(true);
    };
    let row = row_of(deps, id, platform).await?;
    if !baking(&row, &short.prompt) {
        return Ok(true);
    }
    let title = effective_title(row.cover_title.as_ref(), &row.caption, &short.prompt);
    if row.cover_title.is_none() {
        // Stored first, so the recorded still can be checked against it.
        deps.exports.set_cover_title(id, platform, &title).await?;
    }
    let picked = row
        .cover_keys
        .get(row.cover_pick as usize)
        .ok_or_else(|| invalid("cover_pick must name an existing cover"))?;
    let (blobs, ttl) = (deps.short.blobs, deps.media_ttl);
    let kit = deps.short.brand.brand_kit(&short.user_id).await?;
    let image_url = blobs.presign_get(picked, ttl).await?;
    let props = cover_still_props(image_url, row.aspect, &title, theme_for(kit.as_ref()));
    let key = keys::titled_cover(&short.user_id, id, platform);
    deps.short
        .ensure_room(&short.user_id, images_estimate(1))
        .await?;
    let out = blobs.presign_put(&key, ttl).await?;
    deps.renderer.still(&props, &out).await?;
    let baked = (row.cover_pick, &title);
    deps.exports.set_titled((id, platform), &key, baked).await
}

/// Appends a production's key art as a `key_art` cover to every export of its story short; a
/// platform at the cap is skipped. Returns the platforms that got it.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` for the production; `VALIDATION_FAILED` when it has no art yet or
/// its story short has no exports; `STORAGE_FULL`; storage and store errors.
pub async fn use_art_as_cover(
    deps: &ExportDeps<'_>,
    user: &UserId,
    production: &ProductionId,
) -> Result<Vec<Platform>, AppError> {
    let p = owned_production(deps.productions, user, production).await?;
    let art = p
        .art_key
        .ok_or_else(|| invalid("the production has no art yet"))?;
    let short_id = p
        .short_id
        .ok_or_else(|| invalid("the production's story has no exports yet"))?;
    let short = owned_short(deps, user, &short_id).await?;
    let rows = deps.exports.exports(&short_id).await?;
    if rows.is_empty() {
        return Err(invalid("the production's story has no exports yet"));
    }
    let dir = deps.short.scratch.short_dir(&short_id).await?;
    let local = dir.join("key_art.webp");
    deps.short.blobs.get_to_file(&art, &local).await?;
    let mut added = Vec::new();
    for row in rows {
        let Ok(slots) = cover_slots(row.cover_keys.len(), 1) else {
            continue;
        };
        let drawn = DrawnCover {
            n: slots.start,
            out: &local,
            info: CoverInfo::styled(CoverStyle::KeyArt),
        };
        if store_covers(deps, (&short, row.platform), &[drawn]).await? == 1 {
            added.push(row.platform);
        }
    }
    Ok(added)
}
