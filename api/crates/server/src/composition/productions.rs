//! The Production Studio: its SQLite store, the Muse Spark planner and the Muse Image storyboard
//! maker, bound to the studio that runs productions in the background.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::image::{ImagePrompts, MuseImageMaker};
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::meta::studio::{SparkStudio, StudioPrompts};
use nimbytes_adapters::{SqliteExportStore, SqliteProductionStore};
use nimbytes_core::AppError;
use nimbytes_core::domain::production::BOARD_CONCURRENCY;
use nimbytes_core::ports::Renderer;
use sqlx::SqlitePool;

use crate::progress::BroadcastProgress;
use crate::publisher::Publisher;
use crate::state::Ports;
use crate::studio::Studio;

use super::RENDER_URL_TTL;

const SHOT_LIST_PROMPT: &str = include_str!("../../../../prompts/shot_list.md");
const SHOT_LIST_SCHEMA: &str = include_str!("../../../../prompts/shot_list.schema.json");
const COVERAGE_PROMPT: &str = include_str!("../../../../prompts/coverage_match.md");
const COVERAGE_SCHEMA: &str = include_str!("../../../../prompts/coverage_match.schema.json");
const PACK_PROMPT: &str = include_str!("../../../../prompts/platform_pack.md");
const PACK_SCHEMA: &str = include_str!("../../../../prompts/platform_pack.schema.json");
const STORYBOARD_PROMPT: &str = include_str!("../../../../prompts/storyboard.md");
const BRAND_STYLE_PROMPT: &str = include_str!("../../../../prompts/brand_style.md");
const COVER_PROMPT: &str = include_str!("../../../../prompts/cover.md");
const COVER_REDRAW_PROMPT: &str = include_str!("../../../../prompts/cover_redraw.md");
const FOOTAGE_BOARD_PROMPT: &str = include_str!("../../../../prompts/footage_board.md");
const KEY_ART_PROMPT: &str = include_str!("../../../../prompts/key_art.md");
const STORY_BRIEF_PROMPT: &str = include_str!("../../../../prompts/story_brief.md");
/// One shot list or coverage call (low effort over up to 12 shots), retries included.
pub const STUDIO_TIMEOUT: Duration = Duration::from_secs(120);
/// One storyboard frame (about 15 s measured), retries included.
pub const STORYBOARD_TIMEOUT: Duration = Duration::from_secs(120);

/// The studio and the publisher over the shared ports, after failing the plans and exports a
/// restart interrupted.
///
/// # Errors
/// `INTERNAL` when a studio prompt or schema cannot be loaded.
pub async fn studio(
    pool: SqlitePool,
    (ports, progress): (&Arc<Ports>, &Arc<BroadcastProgress>),
    meta: &MetaClient,
    renderer: Arc<dyn Renderer>,
) -> Result<(Arc<Studio>, Arc<Publisher>), AppError> {
    let studio = Studio::new(
        ports.clone(),
        progress.clone(),
        Template::parse(STORY_BRIEF_PROMPT)?.user,
        (
            Arc::new(SqliteProductionStore::new(pool.clone())),
            Arc::new(SparkStudio::new(
                meta.clone(),
                studio_prompts()?,
                STUDIO_TIMEOUT,
            )),
            Arc::new(image_maker(meta)?),
        ),
    );
    studio.recover().await;
    let exports = Arc::new(SqliteExportStore::new(pool));
    let publisher = Publisher::new(studio.clone(), (exports, renderer), RENDER_URL_TTL);
    publisher.recover().await;
    Ok((studio, publisher))
}

/// The shot list, coverage and platform pack prompts with their schemas.
fn studio_prompts() -> Result<StudioPrompts, AppError> {
    Ok(StudioPrompts {
        shot_list: (
            Template::parse(SHOT_LIST_PROMPT)?,
            StrictSchema::parse("shot_list", SHOT_LIST_SCHEMA)?,
        ),
        coverage: (
            Template::parse(COVERAGE_PROMPT)?,
            StrictSchema::parse("coverage_match", COVERAGE_SCHEMA)?,
        ),
        pack: (
            Template::parse(PACK_PROMPT)?,
            StrictSchema::parse("platform_pack", PACK_SCHEMA)?,
        ),
    })
}

/// Muse Image with the storyboard, brand, cover, redraw, footage storyboard and key art prompts.
fn image_maker(meta: &MetaClient) -> Result<MuseImageMaker, AppError> {
    Ok(MuseImageMaker::new(
        meta.clone(),
        ImagePrompts {
            storyboard: Template::parse(STORYBOARD_PROMPT)?,
            brand_style: Template::parse(BRAND_STYLE_PROMPT)?,
            cover: Template::parse(COVER_PROMPT)?,
            cover_redraw: Template::parse(COVER_REDRAW_PROMPT)?,
            footage_board: Template::parse(FOOTAGE_BOARD_PROMPT)?,
            key_art: Template::parse(KEY_ART_PROMPT)?,
        },
        STORYBOARD_TIMEOUT,
        BOARD_CONCURRENCY,
    ))
}
