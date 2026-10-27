//! The Production Studio: its SQLite store, the Muse Spark planner and the Muse Image storyboard
//! maker, bound to the studio that runs productions in the background.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::SqliteProductionStore;
use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::image::{ImagePrompts, MuseImageMaker};
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::meta::studio::{SparkStudio, StudioPrompts};
use nimbytes_core::AppError;
use nimbytes_core::domain::production::BOARD_CONCURRENCY;
use sqlx::SqlitePool;

use crate::progress::BroadcastProgress;
use crate::state::Ports;
use crate::studio::Studio;

const SHOT_LIST_PROMPT: &str = include_str!("../../../../prompts/shot_list.md");
const SHOT_LIST_SCHEMA: &str = include_str!("../../../../prompts/shot_list.schema.json");
const COVERAGE_PROMPT: &str = include_str!("../../../../prompts/coverage_match.md");
const COVERAGE_SCHEMA: &str = include_str!("../../../../prompts/coverage_match.schema.json");
const STORYBOARD_PROMPT: &str = include_str!("../../../../prompts/storyboard.md");
const BRAND_STYLE_PROMPT: &str = include_str!("../../../../prompts/brand_style.md");
const STORY_BRIEF_PROMPT: &str = include_str!("../../../../prompts/story_brief.md");
/// One shot list or coverage call (low effort over up to 12 shots), retries included.
pub const STUDIO_TIMEOUT: Duration = Duration::from_secs(120);
/// One storyboard frame (about 15 s measured), retries included.
pub const STORYBOARD_TIMEOUT: Duration = Duration::from_secs(120);

/// The studio over the shared ports, after failing plans a restart interrupted.
///
/// # Errors
/// `INTERNAL` when a studio prompt or schema cannot be loaded.
pub async fn studio(
    pool: SqlitePool,
    ports: &Arc<Ports>,
    progress: &Arc<BroadcastProgress>,
    meta: &MetaClient,
) -> Result<Arc<Studio>, AppError> {
    let prompts = StudioPrompts {
        shot_list: (
            Template::parse(SHOT_LIST_PROMPT)?,
            StrictSchema::parse("shot_list", SHOT_LIST_SCHEMA)?,
        ),
        coverage: (
            Template::parse(COVERAGE_PROMPT)?,
            StrictSchema::parse("coverage_match", COVERAGE_SCHEMA)?,
        ),
    };
    let images = MuseImageMaker::new(
        meta.clone(),
        ImagePrompts {
            storyboard: Template::parse(STORYBOARD_PROMPT)?,
            brand_style: Template::parse(BRAND_STYLE_PROMPT)?,
        },
        STORYBOARD_TIMEOUT,
        BOARD_CONCURRENCY,
    );
    let studio = Studio::new(
        ports.clone(),
        progress.clone(),
        Template::parse(STORY_BRIEF_PROMPT)?.user,
        (
            Arc::new(SqliteProductionStore::new(pool)),
            Arc::new(SparkStudio::new(meta.clone(), prompts, STUDIO_TIMEOUT)),
            Arc::new(images),
        ),
    );
    studio.recover().await;
    Ok(studio)
}
