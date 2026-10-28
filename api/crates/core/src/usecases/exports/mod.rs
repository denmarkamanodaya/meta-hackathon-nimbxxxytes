//! Publishing a short: start its exports (rows, the feed's render), read them with signed
//! videos and covers, edit a platform's caption, hashtags, cover and cover title, and ask for
//! more covers (in a style), a cover redrawn with words, or a production's art as a cover.
//! The slow parts (platform pack, covers, the shared 9:16 render, the titled cover still) run in
//! the background on the server: [`run_exports`], [`draw_more_covers`], [`draw_redraw`] and
//! [`bake_titled_cover`].

mod covers;
mod cutout;
mod run;

use std::time::Duration;

use crate::domain::cover::{
    CoverInfo, CoverStyle, CoverTitle, PublishedCover, checked_title, cover_infos, effective_title,
    next_covers, published_cover,
};
use crate::domain::export::{
    ExportAspect, ExportStatus, ShortExport, caption_limit, checked_platforms, clean_hashtags,
    export_aspect, export_version, feed_render,
};
use crate::domain::ids::{ShortId, UserId};
use crate::domain::job::{JobKind, JobStatus};
use crate::domain::production::Platform;
use crate::domain::render::render_subject;
use crate::domain::short::Short;
use crate::domain::storage_cap::{export_estimate, images_estimate};
use crate::error::{AppError, ErrorCode};
use crate::ports::{
    ExportStore, ImageMaker, ProductionStore, ProgressSink, Renderer, StudioPlanner,
};
use crate::time::format_utc;
use crate::usecases::shorts::{ShortDeps, request_render};

pub use covers::{
    RedrawPlan, bake_titled_cover, bakes_due, draw_redraw, redraw_requested, use_art_as_cover,
};
pub use cutout::{CutoutPlan, cutout_requested, draw_cutout_cover};
pub use run::{draw_more_covers, run_exports};

/// Progress step names of an export run (`covers` carries `n/m`).
pub mod step {
    /// Snapshot while a run is in flight.
    pub const EXPORTS: &str = "exports";
    /// The platform pack (captions and hashtags).
    pub const PACK: &str = "pack";
    /// Covers.
    pub const COVERS: &str = "covers";
    /// The shared 9:16 render.
    pub const RENDER: &str = "render";
    /// The run finished; the stream ends.
    pub const DONE: &str = "done";
}

/// Ports the export use cases need.
pub struct ExportDeps<'a> {
    /// The shorts, their blobs, jobs, scratch space, finish and brand kit.
    pub short: ShortDeps<'a>,
    /// Export rows.
    pub exports: &'a dyn ExportStore,
    /// Productions (a story short's brief).
    pub productions: &'a dyn ProductionStore,
    /// Platform pack.
    pub planner: &'a dyn StudioPlanner,
    /// Covers.
    pub images: &'a dyn ImageMaker,
    /// The 9:16 render.
    pub renderer: &'a dyn Renderer,
    /// Live steps for the exports stream.
    pub progress: &'a dyn ProgressSink,
    /// Lifetime of the URLs the renderer reads and writes.
    pub media_ttl: Duration,
}

/// One signed cover and how it was made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverView {
    /// Signed cover.
    pub url: String,
    /// Its style (and instruction, when redrawn).
    pub info: CoverInfo,
}

/// One export with its signed video and covers.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportView {
    /// The export.
    pub export: ShortExport,
    /// Signed video, once ready.
    pub render_url: Option<String>,
    /// Signed covers, in order.
    pub covers: Vec<CoverView>,
    /// The title over the picked cover (the default until the owner edits it).
    pub cover_title: CoverTitle,
    /// The published cover, signed: titled when the title shows, else the plain pick; `None`
    /// while the titled still is being made.
    pub download_cover_url: Option<String>,
    /// Whether the titled still is missing and must be made.
    pub needs_bake: bool,
    /// The platform's caption limit.
    pub caption_limit: usize,
}

/// What the owner changes on one platform; `None` keeps the value.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ExportEdit {
    /// New caption (must fit the platform's limit).
    pub caption: Option<String>,
    /// New hashtags (cleaned; at most 8).
    pub hashtags: Option<Vec<String>>,
    /// New cover choice (an existing cover).
    pub cover_pick: Option<u32>,
    /// New cover title (1 to 32 characters).
    pub cover_title: Option<CoverTitle>,
}

pub(super) fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg.into())
}

pub(super) async fn owned_short(
    deps: &ExportDeps<'_>,
    user: &UserId,
    id: &ShortId,
) -> Result<Short, AppError> {
    let short = deps
        .short
        .shorts
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such short"))?;
    if &short.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "short belongs to another user",
        ));
    }
    Ok(short)
}

/// The checked platforms, once their render and covers fit under the cap.
async fn platforms_with_room(
    deps: &ExportDeps<'_>,
    user: &UserId,
    platforms: &[Platform],
) -> Result<Vec<Platform>, AppError> {
    let platforms = checked_platforms(platforms)?;
    let room = export_estimate(platforms.len());
    deps.short.ensure_room(user, room).await?;
    Ok(platforms)
}

/// Queues `platforms`' exports of `user`'s short and returns them (each once); the caller then
/// runs [`run_exports`]. The feed takes the short's own final render, queued here when it has
/// none.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for no platforms or a short without versions;
/// `STORAGE_FULL` when the render and covers would not fit under the cap; store and queue errors.
pub async fn start_exports(
    deps: &ExportDeps<'_>,
    user: &UserId,
    id: &ShortId,
    platforms: &[Platform],
) -> Result<Vec<Platform>, AppError> {
    let short = owned_short(deps, user, id).await?;
    let platforms = platforms_with_room(deps, user, platforms).await?;
    let numbers: Vec<u32> = deps
        .short
        .shorts
        .versions(id)
        .await?
        .iter()
        .map(|v| v.n)
        .collect();
    let version = export_version(short.best_version, &numbers)
        .ok_or_else(|| invalid("the short has no version to publish yet"))?;
    let now = format_utc(deps.short.clock.now_millis());
    for p in &platforms {
        let row = queued(id, (*p, export_aspect(*p, short.aspect)), version, &now);
        deps.exports.queue_export(&row).await?;
    }
    if platforms.contains(&Platform::Feed) && short.render.is_none() {
        request_render(&deps.short, user, id, version).await?;
        let rendering = (ExportStatus::Rendering, None);
        deps.exports
            .set_render(id, &[Platform::Feed], rendering)
            .await?;
    }
    Ok(platforms)
}

/// A new export row of `platform` at `aspect`, queued at `now`.
fn queued(
    id: &ShortId,
    (platform, aspect): (Platform, ExportAspect),
    version_n: u32,
    now: &str,
) -> ShortExport {
    ShortExport {
        id: format!("{id}-{}", platform.as_str()),
        short_id: id.clone(),
        platform,
        aspect,
        version_n,
        status: ExportStatus::Queued,
        render_key: None,
        caption: String::new(),
        hashtags: Vec::new(),
        cover_keys: Vec::new(),
        cover_pick: 0,
        updated_at: now.to_owned(),
        cover_info: Vec::new(),
        cover_title: None,
        titled_cover_key: None,
    }
}

/// Whether the short's final render of version `n` gave up after its last attempt.
async fn final_failed(deps: &ExportDeps<'_>, id: &ShortId, n: u32) -> Result<bool, AppError> {
    let job = deps
        .short
        .jobs
        .find(JobKind::Render, &render_subject(id, n))
        .await?;
    Ok(job.is_some_and(|j| j.status == JobStatus::Failed))
}

/// `user`'s exports of the short with signed videos and covers. A feed export shows the short's
/// own final render once it exists.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store and signing errors.
pub async fn list_exports(
    deps: &ExportDeps<'_>,
    user: &UserId,
    id: &ShortId,
) -> Result<Vec<ExportView>, AppError> {
    let short = owned_short(deps, user, id).await?;
    let mut out = Vec::new();
    for mut export in deps.exports.exports(id).await? {
        if export.platform == Platform::Feed {
            let own = short.render.as_ref().map(|(k, _)| k);
            let failed = final_failed(deps, id, export.version_n).await?;
            (export.status, export.render_key) = feed_render(export.status, own, failed);
        }
        out.push(export_view(deps, &short, export).await?);
    }
    Ok(out)
}

/// One export with everything signed: its video, covers and published cover.
async fn export_view(
    deps: &ExportDeps<'_>,
    short: &Short,
    export: ShortExport,
) -> Result<ExportView, AppError> {
    let (blobs, ttl) = (deps.short.blobs, deps.short.url_ttl);
    let render_url = match (&export.render_key, export.status) {
        (Some(k), ExportStatus::Ready) => Some(blobs.presign_get(k, ttl).await?),
        _ => None,
    };
    let infos = cover_infos(&export.cover_info, export.cover_keys.len());
    let mut covers = Vec::with_capacity(infos.len());
    for (k, info) in export.cover_keys.iter().zip(infos) {
        let url = blobs.presign_get(k, ttl).await?;
        covers.push(CoverView { url, info });
    }
    let title = effective_title(export.cover_title.as_ref(), &export.caption, &short.prompt);
    let published = published_cover(
        &export.cover_keys,
        export.cover_pick,
        title.show,
        export.titled_cover_key.as_ref(),
    );
    let download_cover_url = match published {
        PublishedCover::Titled(k) | PublishedCover::Plain(k) => {
            Some(blobs.presign_get(k, ttl).await?)
        }
        PublishedCover::Baking | PublishedCover::None => None,
    };
    Ok(ExportView {
        caption_limit: caption_limit(export.platform),
        needs_bake: published == PublishedCover::Baking,
        export,
        render_url,
        covers,
        cover_title: title,
        download_cover_url,
    })
}

pub(super) async fn export_of(
    deps: &ExportDeps<'_>,
    user: &UserId,
    id: &ShortId,
    platform: Platform,
) -> Result<ShortExport, AppError> {
    owned_short(deps, user, id).await?;
    deps.exports
        .exports(id)
        .await?
        .into_iter()
        .find(|e| e.platform == platform)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no export for that platform"))
}

/// Applies the owner's edit to one platform's export. Returns whether the published cover must
/// be made again (the pick or the title changed); the caller then runs [`bake_titled_cover`].
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` without that export; `VALIDATION_FAILED` for a caption
/// over the platform's limit, more than 8 hashtags, a cover that does not exist or a title that
/// is empty or over 32 characters.
pub async fn edit_export(
    deps: &ExportDeps<'_>,
    user: &UserId,
    (id, platform): (&ShortId, Platform),
    edit: ExportEdit,
) -> Result<bool, AppError> {
    let current = export_of(deps, user, id, platform).await?;
    let title = edit.cover_title.map(checked_title).transpose()?;
    if let Some(pick) = edit.cover_pick
        && pick as usize >= current.cover_keys.len()
    {
        return Err(invalid("cover_pick must name an existing cover"));
    }
    let text = (edit.caption, edit.hashtags);
    edit_text(deps, (id, platform), &current, text).await?;
    if let Some(pick) = edit.cover_pick {
        deps.exports.set_cover_pick(id, platform, pick).await?;
    }
    if let Some(t) = &title {
        deps.exports.set_cover_title(id, platform, t).await?;
    }
    Ok(edit.cover_pick.is_some() || title.is_some())
}

/// Sets the caption and hashtags of one export, keeping what the edit leaves out.
async fn edit_text(
    deps: &ExportDeps<'_>,
    (id, platform): (&ShortId, Platform),
    current: &ShortExport,
    (caption, hashtags): (Option<String>, Option<Vec<String>>),
) -> Result<(), AppError> {
    let caption = caption.map_or_else(|| current.caption.clone(), |c| c.trim().to_owned());
    let limit = caption_limit(platform);
    if caption.chars().count() > limit {
        return Err(invalid(format!(
            "the {} caption is at most {limit} characters",
            platform.as_str()
        )));
    }
    let hashtags = match hashtags {
        Some(tags) if tags.len() > crate::domain::export::MAX_HASHTAGS => {
            return Err(invalid("at most 8 hashtags"));
        }
        Some(tags) => clean_hashtags(&tags),
        None => current.hashtags.clone(),
    };
    deps.exports
        .set_text(id, platform, (&caption, &hashtags))
        .await
}

/// Checks that one platform may get 3 more covers (in `style` when given) and returns their
/// numbers; the caller then runs [`draw_more_covers`].
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` without that export; `VALIDATION_FAILED` at 9 covers
/// or for a style that cannot be picked; `STORAGE_FULL` when they would not fit under the cap.
pub async fn more_covers(
    deps: &ExportDeps<'_>,
    user: &UserId,
    (id, platform): (&ShortId, Platform),
    style: Option<CoverStyle>,
) -> Result<std::ops::Range<u32>, AppError> {
    style.map(CoverStyle::pickable).transpose()?;
    let current = export_of(deps, user, id, platform).await?;
    let numbers = next_covers(current.cover_keys.len())?;
    let room = images_estimate(numbers.len());
    deps.short.ensure_room(user, room).await?;
    Ok(numbers)
}

/// Marks exports a restart interrupted as failed (asking again retries); returns how many.
///
/// # Errors
/// Store errors.
pub async fn fail_interrupted_exports(store: &dyn ExportStore) -> Result<u64, AppError> {
    store.fail_unfinished().await
}
