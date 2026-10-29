//! Model-backed and search adapters for the ingest steps: Meta client, transcriber, describer,
//! face tracker, embedder and both indexes.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::label::SparkObjectNamer;
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::meta::reasoner::{ReasonerPrompts, ReasonerTimeouts, SparkReasoner};
use nimbytes_adapters::meta::sam::{SamFaceTracker, SamSubjectTracker};
use nimbytes_adapters::meta::spark::{SparkDescriber, SparkLimits};
use nimbytes_adapters::meta::{MetaClient, MetaConfig, MetaDeps, MetaTranscriber};
use nimbytes_adapters::{
    FfmpegMediaTool, FsScratch, MediaTimeouts, OrtEmbedder, SqliteModelLedger, SqliteSubjectStore,
    SqliteVectorIndex, TantivySearchIndex,
};
use nimbytes_core::domain::cost::Prices;
use nimbytes_core::ports::{
    Catalogue, Clock, DocumentStore, IdGenerator, IntentReader, MaskRenderer, Titler,
};
use nimbytes_core::usecases::ask::AskPorts;
use nimbytes_core::usecases::ingest::{FaceFollowUp, IngestSteps};
use nimbytes_core::usecases::subjects::SubjectPorts;
use nimbytes_core::{AppError, ErrorCode};
use sqlx::SqlitePool;

use super::Config;
use crate::state::Ports;

/// Meta Model API base URL.
pub const META_BASE_URL: &str = "https://api.meta.ai/v1";
/// Model prices, compiled in from `api/config/prices.toml` (parsed at start-up).
pub const PRICES_TOML: &str = include_str!("../../../../config/prices.toml");
/// Prompts and schemas, compiled in from `api/prompts/`.
const FACTS_PROMPT: &str = include_str!("../../../../prompts/segment_facts.md");
const FACTS_SCHEMA: &str = include_str!("../../../../prompts/segment_facts.schema.json");
const REWRITE_PROMPT: &str = include_str!("../../../../prompts/query_rewrite.md");
const REWRITE_SCHEMA: &str = include_str!("../../../../prompts/query_rewrite.schema.json");
const RERANK_PROMPT: &str = include_str!("../../../../prompts/rerank.md");
const RERANK_SCHEMA: &str = include_str!("../../../../prompts/rerank.schema.json");
const PLAN_PROMPT: &str = include_str!("../../../../prompts/plan_edit.md");
const TIMELINE_SCHEMA: &str = include_str!("../../../../prompts/timeline.schema.json");
const CRITIQUE_PROMPT: &str = include_str!("../../../../prompts/critique.md");
const CRITIQUE_SCHEMA: &str = include_str!("../../../../prompts/critique.schema.json");
const TITLE_PROMPT: &str = include_str!("../../../../prompts/clip_title.md");
const TITLE_SCHEMA: &str = include_str!("../../../../prompts/clip_title.schema.json");
const FACE_MATCH_PROMPT: &str = include_str!("../../../../prompts/face_match.md");
const FACE_MATCH_SCHEMA: &str = include_str!("../../../../prompts/face_match.schema.json");
const INTENT_PROMPT: &str = include_str!("../../../../prompts/intent.md");
const INTENT_SCHEMA: &str = include_str!("../../../../prompts/intent.schema.json");
const AGENT_TOOLS: &str = include_str!("../../../../prompts/agent_tools.json");
/// Whole-call cap for query rewrite and for rerank (retries included); past it search falls back.
pub const REASONER_TIMEOUT: Duration = Duration::from_secs(10);
/// One edit plan (low effort over up to 20 moments), retries included.
pub const PLAN_TIMEOUT: Duration = Duration::from_secs(120);
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
/// Model-backed and search adapters shared by request handlers and the ingest worker.
pub struct Models {
    /// Client every Meta call goes through.
    pub meta: MetaClient,
    /// Query rewrite and rerank.
    pub reasoner: Arc<SparkReasoner>,
    /// PE towers.
    pub embedder: Arc<OrtEmbedder>,
    /// Segment vectors.
    pub vectors: Arc<SqliteVectorIndex>,
    /// Keyword index.
    pub text: Arc<TantivySearchIndex>,
    /// Model cache and cost log.
    pub ledger: Arc<SqliteModelLedger>,
}

/// Builds the shared model and index adapters.
///
/// # Errors
/// `INTERNAL` when a prompt, the models or the index cannot be loaded.
pub fn models(
    config: &Config,
    pool: SqlitePool,
    clock: Arc<dyn Clock>,
    ids: Arc<dyn IdGenerator>,
) -> Result<Models, AppError> {
    let ledger = Arc::new(SqliteModelLedger::new(pool.clone()));
    let meta = meta_client(
        config,
        MetaDeps {
            ledger: ledger.clone(),
            clock,
            ids,
        },
    )?;
    let prompts = reasoner_prompts()?;
    let timeouts = ReasonerTimeouts {
        search: REASONER_TIMEOUT,
        plan: PLAN_TIMEOUT,
    };
    Ok(Models {
        reasoner: Arc::new(SparkReasoner::new(meta.clone(), prompts, timeouts)),
        embedder: Arc::new(OrtEmbedder::load(&config.pe_model_dir)?),
        vectors: Arc::new(SqliteVectorIndex::new(pool)),
        text: Arc::new(TantivySearchIndex::open(&config.data_dir.join("index"))?),
        ledger,
        meta,
    })
}

/// The rewrite, rerank, plan and critique prompts with their schemas.
fn reasoner_prompts() -> Result<ReasonerPrompts, AppError> {
    Ok(ReasonerPrompts {
        rewrite: (
            Template::parse(REWRITE_PROMPT)?,
            StrictSchema::parse("query_rewrite", REWRITE_SCHEMA)?,
        ),
        rerank: (
            Template::parse(RERANK_PROMPT)?,
            serde_json::from_str(RERANK_SCHEMA)
                .map_err(|e| AppError::new(ErrorCode::Internal, format!("rerank schema: {e}")))?,
        ),
        plan: (
            Template::parse(PLAN_PROMPT)?,
            serde_json::from_str(TIMELINE_SCHEMA)
                .map_err(|e| AppError::new(ErrorCode::Internal, format!("timeline schema: {e}")))?,
        ),
        critique: (
            Template::parse(CRITIQUE_PROMPT)?,
            StrictSchema::parse("critique", CRITIQUE_SCHEMA)?,
        ),
        tools: serde_json::from_str(AGENT_TOOLS)
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("agent tools: {e}")))?,
        title: (
            Template::parse(TITLE_PROMPT)?,
            StrictSchema::parse("clip_title", TITLE_SCHEMA)?,
        ),
        face_match: (
            Template::parse(FACE_MATCH_PROMPT)?,
            StrictSchema::parse("face_match", FACE_MATCH_SCHEMA)?,
        ),
        intent: (
            Template::parse(INTENT_PROMPT)?,
            StrictSchema::parse("intent", INTENT_SCHEMA)?,
        ),
    })
}

fn meta_client(config: &Config, deps: MetaDeps) -> Result<MetaClient, AppError> {
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
    Ok(MetaClient::new(http, settings, prices()?, deps))
}

/// One SAM call for a reframe, a blur lookup or a tap (a shot range or one frame).
pub const SUBJECT_TIMEOUT: Duration = Duration::from_secs(120);
/// One object label (low effort, one small crop).
pub const LABEL_TIMEOUT: Duration = Duration::from_secs(30);
const LABEL_PROMPT: &str = include_str!("../../../../prompts/object_label.md");
const LABEL_SCHEMA: &str = include_str!("../../../../prompts/object_label.schema.json");

/// The SAM feature ports: the subject tracker and the object namer on `meta`, ffmpeg range
/// copies, the subject store on `pool`, and the renderer's mask work.
///
/// # Errors
/// `INTERNAL` when the label prompt cannot be loaded.
pub fn subject_ports(
    meta: &MetaClient,
    pool: SqlitePool,
    catalogue: Arc<dyn Catalogue>,
    masks: Arc<dyn MaskRenderer>,
) -> Result<SubjectPorts, AppError> {
    let prompt = (
        Template::parse(LABEL_PROMPT)?,
        StrictSchema::parse("object_label", LABEL_SCHEMA)?,
    );
    Ok(SubjectPorts {
        tracker: Arc::new(SamSubjectTracker::new(meta.clone(), SUBJECT_TIMEOUT)),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        store: Arc::new(SqliteSubjectStore::new(pool)),
        catalogue,
        namer: Arc::new(SparkObjectNamer::new(meta.clone(), prompt, LABEL_TIMEOUT)),
        masks,
    })
}

/// The ask box: ffmpeg for the WAV, Voice Transcribe on `meta`, Spark reads the request, over
/// the request ports and the iRead documents.
pub fn ask_ports(
    ports: &Ports,
    (meta, intents): (&MetaClient, Arc<dyn IntentReader>),
    documents: Arc<dyn DocumentStore>,
) -> AskPorts {
    AskPorts {
        catalogue: ports.catalogue.clone(),
        projects: ports.projects.clone(),
        documents,
        scratch: ports.scratch.clone(),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        transcriber: Arc::new(MetaTranscriber::new(meta.clone(), TRANSCRIBE_TIMEOUT)),
        intents,
        ids: ports.ids.clone(),
    }
}

/// The ingest step runner over the shared ports and models.
///
/// # Errors
/// `INTERNAL` when the segment-facts prompt cannot be loaded.
pub fn ingest_steps(
    config: &Config,
    ports: &Ports,
    (meta, titler): (&MetaClient, Arc<dyn Titler>),
) -> Result<IngestSteps, AppError> {
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
        tracker: Arc::new(SamFaceTracker::new(meta.clone(), FACES_TIMEOUT)),
        embedder: ports.embedder.clone(),
        vectors: ports.vectors.clone(),
        text_index: ports.text.clone(),
        titler,
        face_matching: FaceFollowUp {
            faces: ports.faces.clone(),
            jobs: ports.jobs.clone(),
            ids: ports.ids.clone(),
            clock: ports.clock.clone(),
        },
        privacy: ports.privacy.clone(),
    })
}
