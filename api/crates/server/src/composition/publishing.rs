//! Publishing: the Muse Spark platform pack writer and the Muse Image maker, bound to the
//! publisher that makes a short's exports and covers, and to the project key art runs.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::SqliteExportStore;
use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::image::{ImagePrompts, MuseImageMaker};
use nimbytes_adapters::meta::pack::SparkPackWriter;
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_core::AppError;
use nimbytes_core::ports::{ImageMaker, Renderer};
use sqlx::SqlitePool;

use crate::art::ProjectArt;
use crate::progress::BroadcastProgress;
use crate::publisher::Publisher;
use crate::state::Ports;

use super::RENDER_URL_TTL;

const PACK_PROMPT: &str = include_str!("../../../../prompts/platform_pack.md");
const PACK_SCHEMA: &str = include_str!("../../../../prompts/platform_pack.schema.json");
const COVER_PROMPT: &str = include_str!("../../../../prompts/cover.md");
const COVER_REDRAW_PROMPT: &str = include_str!("../../../../prompts/cover_redraw.md");
const KEY_ART_PROMPT: &str = include_str!("../../../../prompts/key_art.md");
const CUTOUT_SCENE_PROMPT: &str = include_str!("../../../../prompts/cutout_scene.md");
/// One platform pack call (low effort over every platform), retries included.
pub const PACK_TIMEOUT: Duration = Duration::from_secs(120);
/// One image (about 15 s measured), retries included.
pub const IMAGE_TIMEOUT: Duration = Duration::from_secs(120);
/// Images drawn at once.
pub const IMAGE_CONCURRENCY: usize = 4;

/// The publisher and the project art over the shared ports, after failing the exports a restart
/// interrupted.
///
/// # Errors
/// `INTERNAL` when a prompt or schema cannot be loaded.
pub async fn publishing(
    pool: SqlitePool,
    (ports, progress): (&Arc<Ports>, &Arc<BroadcastProgress>),
    meta: &MetaClient,
    renderer: Arc<dyn Renderer>,
) -> Result<(Arc<Publisher>, Arc<ProjectArt>), AppError> {
    let images: Arc<dyn ImageMaker> = Arc::new(image_maker(meta)?);
    let pack = Arc::new(SparkPackWriter::new(
        meta.clone(),
        (
            Template::parse(PACK_PROMPT)?,
            StrictSchema::parse("platform_pack", PACK_SCHEMA)?,
        ),
        PACK_TIMEOUT,
    ));
    let exports = Arc::new(SqliteExportStore::new(pool));
    let publisher = Publisher::new(
        (ports.clone(), progress.clone()),
        (pack, images.clone()),
        (exports, renderer),
        RENDER_URL_TTL,
    );
    publisher.recover().await;
    Ok((publisher, ProjectArt::new(ports.clone(), images)))
}

/// Muse Image with the cover, redraw, key art and cut-out scene prompts.
fn image_maker(meta: &MetaClient) -> Result<MuseImageMaker, AppError> {
    Ok(MuseImageMaker::new(
        meta.clone(),
        ImagePrompts {
            cover: Template::parse(COVER_PROMPT)?,
            cover_redraw: Template::parse(COVER_REDRAW_PROMPT)?,
            key_art: Template::parse(KEY_ART_PROMPT)?,
            cutout_scene: Template::parse(CUTOUT_SCENE_PROMPT)?,
        },
        IMAGE_TIMEOUT,
        IMAGE_CONCURRENCY,
    ))
}
