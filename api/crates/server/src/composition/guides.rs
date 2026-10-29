//! MyWay wiring: the guide store, Spark's guide writer and the MMS-TTS narrator (only with
//! `TTS_MODEL_DIR`). Without the key, or when the voice fails to load, steps have no voice; the
//! server still starts.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::guide::SparkGuideWriter;
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::{OnnxNarrator, SqliteGuideStore};
use nimbytes_core::AppError;
use nimbytes_core::ports::Narrator;
use nimbytes_core::usecases::guides::GuidePorts;
use sqlx::SqlitePool;

use super::{Config, URL_TTL};
use crate::state::Ports;

const GUIDE_PROMPT: &str = include_str!("../../../../prompts/guide_steps.md");
const GUIDE_SCHEMA: &str = include_str!("../../../../prompts/guide_steps.schema.json");

/// One Spark attempt at a guide: up to 5 minutes of video inline, in a background job.
pub const GUIDE_STEPS_TIMEOUT: Duration = Duration::from_secs(240);

/// The MyWay ports over the request ports, the pool and the Meta client.
///
/// # Errors
/// `INTERNAL` when the guide prompt cannot be loaded.
pub fn guide_ports(
    config: &Config,
    ports: &Ports,
    (pool, meta): (&SqlitePool, &MetaClient),
) -> Result<GuidePorts, AppError> {
    let prompt = (
        Template::parse(GUIDE_PROMPT)?,
        StrictSchema::parse("guide_steps", GUIDE_SCHEMA)?,
    );
    Ok(GuidePorts {
        store: Arc::new(SqliteGuideStore::new(pool.clone())),
        catalogue: ports.catalogue.clone(),
        blobs: ports.blobs.clone(),
        scratch: ports.scratch.clone(),
        media: ports.subjects.media.clone(),
        jobs: ports.jobs.clone(),
        writer: Arc::new(SparkGuideWriter::new(
            meta.clone(),
            prompt,
            GUIDE_STEPS_TIMEOUT,
        )),
        tracker: ports.subjects.tracker.clone(),
        masks: ports.subjects.masks.clone(),
        narrator: narrator(config),
        clock: ports.clock.clone(),
        ids: ports.ids.clone(),
        url_ttl: URL_TTL,
    })
}

/// The narrator when `TTS_MODEL_DIR` is set and its model loads.
fn narrator(config: &Config) -> Option<Arc<dyn Narrator>> {
    let dir = config.tts_model_dir.as_ref()?;
    match OnnxNarrator::load(dir) {
        Ok(n) => Some(Arc::new(n)),
        Err(e) => {
            tracing::warn!(error = %e.message, "guide narration off: the voice did not load");
            None
        }
    }
}
