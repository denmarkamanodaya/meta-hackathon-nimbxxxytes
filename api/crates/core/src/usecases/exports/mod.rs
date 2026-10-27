//! Publishing a short: start its exports (rows, the feed's render), read them with signed
//! videos and covers, edit a platform's caption, hashtags and cover, and ask for more covers.
//! The slow part (platform pack, covers, the shared 9:16 render) is [`run_exports`], which the
//! server runs in the background.

mod run;

use std::time::Duration;

use crate::domain::export::{
    ExportStatus, ShortExport, caption_limit, checked_platforms, clean_hashtags, export_aspect,
    export_version, feed_render, next_covers,
};
use crate::domain::ids::{ShortId, UserId};
use crate::domain::production::Platform;
use crate::domain::short::Short;
use crate::domain::storage_cap::{export_estimate, images_estimate};
use crate::error::{AppError, ErrorCode};
use crate::ports::{
    ExportStore, ImageMaker, ProductionStore, ProgressSink, Renderer, StudioPlanner,
};
use crate::time::format_utc;
use crate::usecases::shorts::{ShortDeps, request_render};

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

/// One export with its signed video and covers.
#[derive(Debug, Clone, PartialEq)]
pub struct ExportView {
    /// The export.
    pub export: ShortExport,
    /// Signed video, once ready.
    pub render_url: Option<String>,
    /// Signed covers, in order.
    pub cover_urls: Vec<String>,
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
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg.into())
}

async fn owned_short(
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
        let row = ShortExport {
            id: format!("{id}-{}", p.as_str()),
            short_id: id.clone(),
            platform: *p,
            aspect: export_aspect(*p, short.aspect),
            version_n: version,
            status: ExportStatus::Queued,
            render_key: None,
            caption: String::new(),
            hashtags: Vec::new(),
            cover_keys: Vec::new(),
            cover_pick: 0,
            updated_at: now.clone(),
        };
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
    let (blobs, ttl) = (deps.short.blobs, deps.short.url_ttl);
    let mut out = Vec::new();
    for mut export in deps.exports.exports(id).await? {
        if export.platform == Platform::Feed {
            let own = short.render.as_ref().map(|(k, _)| k);
            (export.status, export.render_key) = feed_render(export.status, own);
        }
        let render_url = match (&export.render_key, export.status) {
            (Some(k), ExportStatus::Ready) => Some(blobs.presign_get(k, ttl).await?),
            _ => None,
        };
        let mut cover_urls = Vec::with_capacity(export.cover_keys.len());
        for k in &export.cover_keys {
            cover_urls.push(blobs.presign_get(k, ttl).await?);
        }
        out.push(ExportView {
            caption_limit: caption_limit(export.platform),
            export,
            render_url,
            cover_urls,
        });
    }
    Ok(out)
}

async fn export_of(
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

/// Applies the owner's edit to one platform's export.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` without that export; `VALIDATION_FAILED` for a caption
/// over the platform's limit, more than 8 hashtags or a cover that does not exist.
pub async fn edit_export(
    deps: &ExportDeps<'_>,
    user: &UserId,
    (id, platform): (&ShortId, Platform),
    edit: ExportEdit,
) -> Result<(), AppError> {
    let current = export_of(deps, user, id, platform).await?;
    let caption = edit
        .caption
        .map_or(current.caption, |c| c.trim().to_owned());
    let limit = caption_limit(platform);
    if caption.chars().count() > limit {
        return Err(invalid(format!(
            "the {} caption is at most {limit} characters",
            platform.as_str()
        )));
    }
    let hashtags = match edit.hashtags {
        Some(tags) if tags.len() > crate::domain::export::MAX_HASHTAGS => {
            return Err(invalid("at most 8 hashtags"));
        }
        Some(tags) => clean_hashtags(&tags),
        None => current.hashtags,
    };
    deps.exports
        .set_text(id, platform, (&caption, &hashtags))
        .await?;
    if let Some(pick) = edit.cover_pick {
        if pick as usize >= current.cover_keys.len() {
            return Err(invalid("cover_pick must name an existing cover"));
        }
        deps.exports.set_cover_pick(id, platform, pick).await?;
    }
    Ok(())
}

/// Checks that one platform may get 3 more covers and returns their numbers; the caller then
/// runs [`draw_more_covers`].
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` without that export; `VALIDATION_FAILED` at 9 covers;
/// `STORAGE_FULL` when they would not fit under the cap.
pub async fn more_covers(
    deps: &ExportDeps<'_>,
    user: &UserId,
    id: &ShortId,
    platform: Platform,
) -> Result<std::ops::Range<u32>, AppError> {
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
