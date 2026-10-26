//! Model-backed and search adapters for the ingest steps: Meta client, transcriber, describer,
//! face tracker, embedder and both indexes.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::meta::sam::SamFaceTracker;
use nimbytes_adapters::meta::spark::{SparkDescriber, SparkLimits};
use nimbytes_adapters::meta::{MetaClient, MetaConfig, MetaDeps, MetaTranscriber};
use nimbytes_adapters::{
    FfmpegMediaTool, FsScratch, MediaTimeouts, OrtEmbedder, SqliteModelLedger, SqliteVectorIndex,
    TantivySearchIndex,
};
use nimbytes_core::domain::cost::Prices;
use nimbytes_core::usecases::ingest::IngestSteps;
use nimbytes_core::{AppError, ErrorCode};
use sqlx::SqlitePool;

use super::Config;
use crate::state::Ports;

/// Meta Model API base URL.
pub const META_BASE_URL: &str = "https://api.meta.ai/v1";
/// Model prices, compiled in from `api/config/prices.toml` (parsed at start-up).
pub const PRICES_TOML: &str = include_str!("../../../../config/prices.toml");
/// Segment-facts prompt and schema, compiled in from `api/prompts/`.
const FACTS_PROMPT: &str = include_str!("../../../../prompts/segment_facts.md");
const FACTS_SCHEMA: &str = include_str!("../../../../prompts/segment_facts.schema.json");
/// ffprobe and scene-cut scans.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(120);
/// Any single encode (the proxy of a 3-minute 4K clip is the slowest).
pub const ENCODE_TIMEOUT: Duration = Duration::from_secs(900);
/// One Voice Transcribe attempt (up to 10 minutes of audio).
pub const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(300);
/// One Spark segment call (low effort takes about 7 s).
pub const DESCRIBE_TIMEOUT: Duration = Duration::from_secs(90);
/// Spark calls in flight per clip.
pub const DESCRIBE_CONCURRENCY: usize = 4;
/// One SAM call over a clip's 1 fps copy, streamed.
pub const FACES_TIMEOUT: Duration = Duration::from_secs(300);
/// TCP + TLS connect limit for the Meta API.
pub const META_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// First retry delay for Meta calls; doubles, jittered.
pub const META_BACKOFF: Duration = Duration::from_secs(1);

/// Parses the compiled-in price file.
///
/// # Errors
/// `VALIDATION_FAILED` when the file does not match the price schema.
pub fn prices() -> Result<Prices, AppError> {
    toml::from_str(PRICES_TOML)
        .map_err(|e| AppError::new(ErrorCode::ValidationFailed, format!("prices.toml: {e}")))
}
fn meta_client(config: &Config, ports: &Ports, pool: SqlitePool) -> Result<MetaClient, AppError> {
    let http = reqwest::Client::builder()
        .connect_timeout(META_CONNECT_TIMEOUT)
        .build()
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("http client: {e}")))?;
    let settings = MetaConfig {
        base_url: META_BASE_URL.to_owned(),
        api_key: config.model_api_key.clone(),
        max_retries: 2,
        base_backoff: META_BACKOFF,
    };
    let deps = MetaDeps {
        ledger: Arc::new(SqliteModelLedger::new(pool)),
        clock: ports.clock.clone(),
        ids: ports.ids.clone(),
    };
    Ok(MetaClient::new(http, settings, prices()?, deps))
}

/// The ingest step runner with every adapter bound.
///
/// # Errors
/// `INTERNAL` when a prompt, the models or the index directory cannot be loaded.
pub fn ingest_steps(
    config: &Config,
    ports: &Ports,
    pool: SqlitePool,
) -> Result<IngestSteps, AppError> {
    let meta = meta_client(config, ports, pool.clone())?;
    let prompt = (
        Template::parse(FACTS_PROMPT)?,
        StrictSchema::parse("segment_facts", FACTS_SCHEMA)?,
    );
    let limits = SparkLimits {
        timeout: DESCRIBE_TIMEOUT,
        concurrency: DESCRIBE_CONCURRENCY,
    };
    Ok(IngestSteps {
        blobs: ports.blobs.clone(),
        catalogue: ports.catalogue.clone(),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        scratch: Arc::new(FsScratch::new(config.data_dir.join("work"))),
        transcriber: Arc::new(MetaTranscriber::new(meta.clone(), TRANSCRIBE_TIMEOUT)),
        describer: Arc::new(SparkDescriber::new(meta.clone(), prompt, limits)),
        tracker: Arc::new(SamFaceTracker::new(meta, FACES_TIMEOUT)),
        embedder: Arc::new(OrtEmbedder::load(&config.pe_model_dir)?),
        vectors: Arc::new(SqliteVectorIndex::new(pool)),
        text_index: Arc::new(TantivySearchIndex::open(&config.data_dir.join("index"))?),
    })
}
