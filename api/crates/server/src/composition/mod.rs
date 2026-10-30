//! Composition root: the only module that reads the environment. Env is parsed once into
//! [`Config`]; adapters are built here and bound to ports. No business decisions live here.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use aws_config::timeout::TimeoutConfig;
use aws_config::{BehaviorVersion, Region};
use aws_sdk_s3::config::Credentials;
use axum_extra::extract::cookie::Key;
use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::reasoner::SparkReasoner;
use nimbytes_adapters::{
    FsScratch, RemotionRenderer, RenderTimeouts, S3BlobStore, SqliteBrandStore, SqliteCatalogue,
    SqliteClipLinks, SqliteDocumentStore, SqliteFaceStore, SqliteJobQueue, SqliteListenStore,
    SqlitePhotoStore, SqlitePrivacyStore, SqliteProjectStore, SqliteShortStore, SqliteUsageStore,
    SqliteVectorIndex, SystemClock, UuidV7Ids, s3, sqlite,
};
use nimbytes_core::domain::agent::AgentBudget;
use nimbytes_core::domain::storage_cap::StorageCap;
use nimbytes_core::ports::{FaceMatcher, Titler};
use nimbytes_core::usecases::ask::AskPorts;
use nimbytes_core::usecases::documents::DocumentPorts;
use nimbytes_core::usecases::face_matching::FaceSteps;
use nimbytes_core::usecases::guides::GuidePorts;
use nimbytes_core::usecases::jobs::ByKind;
use nimbytes_core::usecases::listens::ListenPorts;
use nimbytes_core::usecases::memories::MemoryPorts;
use nimbytes_core::usecases::photos::PhotoPorts;
use nimbytes_core::usecases::shorts::{SearchPorts, ShortSteps};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::SqlitePool;

mod documents;
mod guides;
mod listens;
mod memories;
mod photos;
mod privacy;
mod publishing;
mod understanding;

pub use understanding::{PRICES_TOML, prices};

use crate::progress::BroadcastProgress;
use crate::state::{AppState, Ports};
use crate::usage::UsageRefresh;
use crate::worker::{LoggedSteps, PreviewCleanup, UsageMeasuring, Worker};

/// Address the API listens on inside the container (Caddy proxies `/api/*` to it).
pub const BIND_ADDR: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 8080);
/// Lifetime of presigned GET URLs handed to the client (thumbnails, proxy, face crops).
pub const URL_TTL: Duration = Duration::from_secs(3600);
/// Longest a Find this or Cut out request may take: the Mac client drops a request after 60 s
/// without bytes, so the server answers first.
pub const TAP_TIMEOUT: Duration = Duration::from_secs(50);
/// Lifetime of presigned part URLs.
pub const PRESIGN_TTL: Duration = Duration::from_secs(15 * 60);
/// How long a write waits for SQLite's lock before failing.
pub const DB_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// Whole-operation limit for one S3 call (retries included).
pub const S3_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
/// TCP + TLS connect limit for S3.
pub const S3_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Lifetime of the media and upload URLs a render receives; longer than any render.
pub const RENDER_URL_TTL: Duration = Duration::from_secs(3600);
/// One preview render (540 wide from proxies), upload included.
pub const PREVIEW_RENDER_TIMEOUT: Duration = Duration::from_secs(240);
/// One final render (1080 wide from originals), upload included.
pub const FINAL_RENDER_TIMEOUT: Duration = Duration::from_secs(900);
/// TCP connect limit for the renderer.
pub const RENDERER_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Worker tasks when `WORKERS` is unset: one per vCPU of the 2-vCPU server.
pub const WORKERS: usize = 2;
/// The most worker tasks `WORKERS` may ask for.
pub const MAX_WORKERS: usize = 8;
/// Sleep between polls of an empty job queue.
pub const IDLE_POLL: Duration = Duration::from_secs(1);
/// Time between preview cleanup runs (R2 only; S3 expires previews by lifecycle rule).
pub const PREVIEW_CLEANUP_EVERY: Duration = Duration::from_secs(6 * 3600);
/// Step events buffered per slow SSE listener.
pub const PROGRESS_BUFFER: usize = 256;
/// Time between storage measurements when nothing asks for one sooner.
pub const USAGE_MEASURE_EVERY: Duration = Duration::from_secs(3600);
/// Wait after a write or delete before measuring, so a burst of them costs one listing.
pub const USAGE_SETTLE: Duration = Duration::from_secs(10);

/// Minimum `SESSION_SECRET` length; the cookie key is derived from it.
pub const MIN_SECRET_BYTES: usize = 32;

/// Storage limits, compiled in from `api/config/storage.toml` (parsed at start-up).
pub const STORAGE_TOML: &str = include_str!("../../../../config/storage.toml");

/// The schema of `storage.toml`.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StorageFile {
    storage: StorageLimits,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StorageLimits {
    account_cap_gb: u64,
}

/// The per-account storage cap from the compiled-in `storage.toml`.
///
/// # Errors
/// `VALIDATION_FAILED` when the file does not match its schema or the cap is 0.
pub fn storage_cap() -> Result<StorageCap, AppError> {
    let file: StorageFile = toml::from_str(STORAGE_TOML)
        .map_err(|e| AppError::new(ErrorCode::ValidationFailed, format!("storage.toml: {e}")))?;
    StorageCap::from_gb(file.storage.account_cap_gb)
}

/// Typed process configuration, parsed once at start. Keys match `.env.example`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// `DATA_DIR`: root for SQLite, the search index and scratch media.
    pub data_dir: PathBuf,
    /// `DATABASE_URL`: sqlx SQLite URL.
    pub database_url: String,
    /// `PUBLIC_BASE_URL`: origin the PWA is served from.
    pub public_base_url: String,
    /// Listen address; fixed to [`BIND_ADDR`].
    pub bind_addr: SocketAddr,
    /// `DEMO_PASSCODE`: shared sign-in passcode.
    pub demo_passcode: String,
    /// `SESSION_SECRET`: at least 32 bytes; signs the session cookie.
    pub session_secret: String,
    /// `S3_BUCKET`: the S3 media bucket (R2 mode uses `R2_BUCKET`).
    pub s3_bucket: String,
    /// `AWS_REGION`: bucket region.
    pub aws_region: String,
    /// `AWS_PROFILE`: local named profile; absent on the server (instance role).
    pub aws_profile: Option<String>,
    /// `MODEL_API_KEY`: Meta Model API key.
    pub model_api_key: String,
    /// `PE_MODEL_DIR`: Perception Encoder ONNX directory (image + text towers, tokenizer, meta).
    pub pe_model_dir: PathBuf,
    /// `RENDERER_URL`: the renderer service, for example `http://renderer:3001`.
    pub renderer_url: String,
    /// `STORAGE_PROVIDER`: where `S3_BUCKET` lives.
    pub storage: Storage,
    /// `FACE_BOXES_BACKFILL=1`: at start, rerun every finished `faces` job once so clips from
    /// before face boxes were stored get them (off when unset).
    pub face_boxes_backfill: bool,
    /// `WORKERS`: background job tasks, 1 to [`MAX_WORKERS`] ([`WORKERS`] when unset). More
    /// workers only help on a machine with as many cores, so a bigger server sets it.
    pub workers: usize,
    /// `TTS_MODEL_DIR`: the MMS-TTS ONNX directory; unset means guide steps have no voice.
    pub tts_model_dir: Option<PathBuf>,
}

/// The media store's provider, from `STORAGE_PROVIDER` (`s3` when unset).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Storage {
    /// Amazon S3 in `AWS_REGION`, credentials from `AWS_PROFILE` or the instance role.
    S3,
    /// Cloudflare R2.
    R2(R2Config),
}

/// R2 settings: `R2_ACCOUNT_ID` (as its endpoint), `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
/// `R2_SECRET_ACCESS_KEY`. A bucket name of its own, so going back to S3 is one
/// `STORAGE_PROVIDER` change.
#[derive(Clone, PartialEq, Eq)]
pub struct R2Config {
    /// `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`.
    pub endpoint: String,
    /// `R2_BUCKET`.
    pub bucket: String,
    /// `R2_ACCESS_KEY_ID`.
    pub access_key_id: String,
    /// `R2_SECRET_ACCESS_KEY`; never printed.
    pub secret_access_key: String,
}

impl std::fmt::Debug for R2Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("R2Config")
            .field("endpoint", &self.endpoint)
            .field("bucket", &self.bucket)
            .field("access_key_id", &self.access_key_id)
            .field("secret_access_key", &"<redacted>")
            .finish()
    }
}

/// `STORAGE_PROVIDER` and, for `r2`, its three keys.
fn storage(
    optional: impl Fn(&str) -> Option<String>,
    required: impl Fn(&str) -> Result<String, AppError>,
) -> Result<Storage, AppError> {
    let provider = optional("STORAGE_PROVIDER").map(|p| p.trim().to_ascii_lowercase());
    match provider.as_deref() {
        None | Some("s3") => Ok(Storage::S3),
        Some("r2") => Ok(Storage::R2(R2Config {
            endpoint: s3::r2::endpoint(required("R2_ACCOUNT_ID")?.trim())?,
            bucket: required("R2_BUCKET")?,
            access_key_id: required("R2_ACCESS_KEY_ID")?,
            secret_access_key: required("R2_SECRET_ACCESS_KEY")?,
        })),
        Some(_) => Err(AppError::new(
            ErrorCode::ValidationFailed,
            "env STORAGE_PROVIDER must be s3 or r2",
        )),
    }
}

impl Config {
    /// Reads the process environment once.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` when a required key is missing or empty, or the secret is too short.
    pub fn from_env() -> Result<Self, AppError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Parses config from any key lookup; `from_env` passes the real environment, tests a map.
    /// Empty values count as missing.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` naming the first missing required key, or a short `SESSION_SECRET`.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, AppError> {
        let optional = |key: &str| lookup(key).filter(|v| !v.trim().is_empty());
        let required = |key: &str| {
            optional(key).ok_or_else(|| {
                AppError::new(
                    ErrorCode::ValidationFailed,
                    format!("env {key} is required"),
                )
            })
        };
        let session_secret = required("SESSION_SECRET")?;
        if session_secret.len() < MIN_SECRET_BYTES {
            return Err(AppError::new(
                ErrorCode::ValidationFailed,
                format!("env SESSION_SECRET must be at least {MIN_SECRET_BYTES} bytes"),
            ));
        }
        Ok(Self {
            data_dir: PathBuf::from(required("DATA_DIR")?),
            database_url: required("DATABASE_URL")?,
            public_base_url: required("PUBLIC_BASE_URL")?,
            bind_addr: BIND_ADDR,
            demo_passcode: required("DEMO_PASSCODE")?,
            session_secret,
            s3_bucket: required("S3_BUCKET")?,
            aws_region: required("AWS_REGION")?,
            aws_profile: optional("AWS_PROFILE"),
            model_api_key: required("MODEL_API_KEY")?,
            pe_model_dir: PathBuf::from(required("PE_MODEL_DIR")?),
            renderer_url: required("RENDERER_URL")?,
            face_boxes_backfill: optional("FACE_BOXES_BACKFILL").is_some_and(|v| v.trim() == "1"),
            workers: workers(optional("WORKERS"))?,
            tts_model_dir: optional("TTS_MODEL_DIR").map(PathBuf::from),
            storage: storage(optional, required)?,
        })
    }
}

/// `WORKERS` as a count of worker tasks: unset means [`WORKERS`]; anything else must be a whole
/// number from 1 to [`MAX_WORKERS`].
fn workers(raw: Option<String>) -> Result<usize, AppError> {
    let Some(raw) = raw else {
        return Ok(WORKERS);
    };
    match raw.trim().parse::<usize>() {
        Ok(n) if (1..=MAX_WORKERS).contains(&n) => Ok(n),
        _ => Err(AppError::new(
            ErrorCode::ValidationFailed,
            format!("env WORKERS must be a whole number from 1 to {MAX_WORKERS}"),
        )),
    }
}

/// Starts JSON logs on stdout. Level from `RUST_LOG`, default `info`.
pub fn init_logging() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .init();
}

/// Builds every adapter, binds them to ports, and returns the HTTP state plus the worker.
///
/// # Errors
/// `INTERNAL` when the data directory or database cannot be opened; `VALIDATION_FAILED` for a
/// bad price file.
pub async fn build(config: &Config) -> Result<(AppState, Worker), AppError> {
    create_data_dir(config)?;
    let pool = sqlite::connect(&config.database_url, DB_BUSY_TIMEOUT).await?;
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(UuidV7Ids);
    let m = understanding::models(config, pool.clone(), clock.clone(), ids.clone())?;
    let cap = storage_cap()?;
    let ports = Arc::new(request_ports(config, &pool, (clock, ids), (&m, cap)).await?);
    let progress = Arc::new(BroadcastProgress::new(PROGRESS_BUFFER));
    let features = feature_ports(config, &ports, (&pool, &m.meta))?;
    let ask = Arc::new(ask_ports(&ports, &m, &features));
    let runner = Arc::new(job_runner(
        config,
        &ports,
        (&m.meta, m.reasoner),
        features.clone(),
    )?);
    privacy::backfill_face_boxes(config, &ports).await;
    let renders = Arc::new(renderer(config)?);
    let (publisher, art) =
        publishing::publishing(pool, (&ports, &progress), &m.meta, renders).await?;
    let state = AppState {
        ports,
        cookie_key: Key::derive_from(config.session_secret.as_bytes()),
        progress,
        art,
        publisher,
        guides: features.guides,
        documents: features.documents,
        listens: features.listens,
        photos: features.photos,
        memories: features.memories,
        ask,
    };
    let worker = worker(&state, runner, preview_cleanup(config, &state.ports));
    Ok((state, worker))
}

/// The ask box over the request ports, the models and the iRead documents.
fn ask_ports(ports: &Ports, m: &understanding::Models, f: &Features) -> AskPorts {
    understanding::ask_ports(
        ports,
        (&m.meta, m.reasoner.clone()),
        f.documents.store.clone(),
    )
}

/// The Features' ports (handlers and their jobs share them).
#[derive(Clone)]
struct Features {
    guides: Arc<GuidePorts>,
    documents: Arc<DocumentPorts>,
    listens: Arc<ListenPorts>,
    photos: Arc<PhotoPorts>,
    memories: Arc<MemoryPorts>,
}

/// MyWay, iRead and iListen share the one narrator (its model is loaded once); Photos; Memory
/// Lane.
fn feature_ports(
    config: &Config,
    ports: &Ports,
    stores: (&SqlitePool, &MetaClient),
) -> Result<Features, AppError> {
    let narrator = guides::narrator(config);
    Ok(Features {
        guides: Arc::new(guides::guide_ports(ports, stores, narrator.clone())?),
        documents: Arc::new(documents::document_ports(
            ports,
            stores.1,
            narrator.clone(),
        )?),
        listens: Arc::new(listens::listen_ports(ports, stores.1, narrator)?),
        photos: Arc::new(photos::photo_ports(ports, stores.1)?),
        memories: Arc::new(memories::memory_ports(ports, stores.0, stores.1)?),
    })
}

/// The ports request handlers and runs share, over the one pool and the model adapters.
async fn request_ports(
    config: &Config,
    pool: &SqlitePool,
    (clock, ids): (Arc<SystemClock>, Arc<UuidV7Ids>),
    (m, storage_cap): (&understanding::Models, StorageCap),
) -> Result<Ports, AppError> {
    let catalogue = Arc::new(SqliteCatalogue::new(pool.clone()));
    let subjects = understanding::subject_ports(
        &m.meta,
        pool.clone(),
        catalogue.clone(),
        Arc::new(renderer(config)?),
    )?;
    Ok(Ports {
        blobs: Arc::new(blob_store(config, clock.clone()).await),
        faces: Arc::new(SqliteFaceStore::new(pool.clone())),
        scratch: Arc::new(FsScratch::new(config.data_dir.join("work"))),
        shorts: Arc::new(SqliteShortStore::new(pool.clone())),
        catalogue: catalogue.clone(),
        jobs: Arc::new(SqliteJobQueue::new(pool.clone())),
        clock,
        ids,
        people: catalogue,
        reasoner: m.reasoner.clone(),
        text: m.text.clone(),
        embedder: m.embedder.clone(),
        vectors: m.vectors.clone(),
        ledger: m.ledger.clone(),
        passcode: config.demo_passcode.clone(),
        url_ttl: URL_TTL,
        privacy: Arc::new(SqlitePrivacyStore::new(pool.clone())),
        brand: Arc::new(SqliteBrandStore::new(pool.clone())),
        usage: Arc::new(SqliteUsageStore::new(pool.clone())),
        storage_cap,
        usage_refresh: Arc::new(UsageRefresh::default()),
        projects: Arc::new(SqliteProjectStore::new(pool.clone())),
        subjects,
        tap_timeout: TAP_TIMEOUT,
        links: Arc::new(SqliteClipLinks::new(pool.clone())),
        photo_store: Arc::new(SqlitePhotoStore::new(pool.clone())),
        listen_store: Arc::new(SqliteListenStore::new(pool.clone())),
        document_store: Arc::new(SqliteDocumentStore::new(pool.clone())),
        photo_vectors: Arc::new(SqliteVectorIndex::photos(pool.clone())),
    })
}

/// The preview cleanup for a store without tag lifecycle rules (R2); none on S3.
fn preview_cleanup(config: &Config, ports: &Ports) -> Option<PreviewCleanup> {
    match config.storage {
        Storage::S3 => None,
        Storage::R2(_) => Some(PreviewCleanup {
            shorts: ports.shorts.clone(),
            blobs: ports.blobs.clone(),
            every: PREVIEW_CLEANUP_EVERY,
        }),
    }
}

/// The job worker over the same queue, clock and progress the handlers use.
fn worker(state: &AppState, runner: Arc<ByKind>, previews: Option<PreviewCleanup>) -> Worker {
    let ports = &state.ports;
    Worker {
        queue: ports.jobs.clone(),
        runner: Arc::new(LoggedSteps(runner)),
        clock: ports.clock.clone(),
        progress: state.progress.clone(),
        idle_poll: IDLE_POLL,
        catalogue: ports.catalogue.clone(),
        ids: ports.ids.clone(),
        previews,
        usage: UsageMeasuring {
            refresh: ports.usage_refresh.clone(),
            usage: ports.usage.clone(),
            blobs: ports.blobs.clone(),
            every: USAGE_MEASURE_EVERY,
            settle: USAGE_SETTLE,
        },
    }
}

fn create_data_dir(config: &Config) -> Result<(), AppError> {
    std::fs::create_dir_all(&config.data_dir)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("cannot create DATA_DIR: {e}")))
}

/// Ingest jobs to the ingest pipeline; agent and render jobs to the shorts steps; face vector
/// jobs to the face matching steps; guide jobs to MyWay; read jobs to iRead; listen jobs to
/// iListen; photo jobs to Photos; memory jobs to Memory Lane.
fn job_runner(
    config: &Config,
    ports: &Ports,
    (meta, reasoner): (&MetaClient, Arc<SparkReasoner>),
    f: Features,
) -> Result<ByKind, AppError> {
    let titler: Arc<dyn Titler> = reasoner.clone();
    let matcher: Arc<dyn FaceMatcher> = reasoner;
    Ok(ByKind {
        ingest: Arc::new(understanding::ingest_steps(config, ports, (meta, titler))?),
        shorts: Arc::new(short_steps(config, ports)?),
        faces: Arc::new(FaceSteps {
            faces: ports.faces.clone(),
            blobs: ports.blobs.clone(),
            scratch: ports.scratch.clone(),
            embedder: ports.embedder.clone(),
            matcher,
        }),
        guides: f.guides,
        documents: f.documents,
        listens: f.listens,
        photos: f.photos,
        memories: f.memories,
    })
}

/// The plan, preview and final-render steps over the request ports and the renderer.
fn short_steps(config: &Config, ports: &Ports) -> Result<ShortSteps, AppError> {
    Ok(ShortSteps {
        shorts: ports.shorts.clone(),
        blobs: ports.blobs.clone(),
        reasoner: ports.reasoner.clone(),
        renderer: Arc::new(renderer(config)?),
        clock: ports.clock.clone(),
        media_ttl: RENDER_URL_TTL,
        scratch: ports.scratch.clone(),
        ledger: ports.ledger.clone(),
        budget: AgentBudget::PRODUCTION,
        privacy: ports.privacy.clone(),
        brand: ports.brand.clone(),
        usage: ports.usage.clone(),
        cap: ports.storage_cap,
        subjects: Some(ports.subjects.clone()),
        library: SearchPorts {
            catalogue: ports.catalogue.clone(),
            people: ports.people.clone(),
            text: ports.text.clone(),
            embedder: ports.embedder.clone(),
            vectors: ports.vectors.clone(),
        },
    })
}

fn renderer(config: &Config) -> Result<RemotionRenderer, AppError> {
    let http = reqwest::Client::builder()
        .connect_timeout(RENDERER_CONNECT_TIMEOUT)
        .build()
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("http client: {e}")))?;
    let timeouts = RenderTimeouts {
        preview: PREVIEW_RENDER_TIMEOUT,
        final_render: FINAL_RENDER_TIMEOUT,
    };
    Ok(RemotionRenderer::new(
        http,
        config.renderer_url.clone(),
        timeouts,
    ))
}

/// The media store on the configured provider: one adapter, R2 without object tags.
async fn blob_store(config: &Config, clock: Arc<SystemClock>) -> S3BlobStore {
    let timeouts = TimeoutConfig::builder()
        .operation_timeout(S3_OPERATION_TIMEOUT)
        .connect_timeout(S3_CONNECT_TIMEOUT)
        .build();
    match &config.storage {
        Storage::S3 => s3_store(config, clock, timeouts).await,
        Storage::R2(r2) => r2_store(r2, clock, timeouts).await,
    }
}

async fn s3_store(
    config: &Config,
    clock: Arc<SystemClock>,
    timeouts: TimeoutConfig,
) -> S3BlobStore {
    let mut loader = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(config.aws_region.clone()))
        .timeout_config(timeouts);
    if let Some(profile) = &config.aws_profile {
        loader = loader.profile_name(profile);
    }
    let sdk = loader.load().await;
    let client = aws_sdk_s3::Client::from_conf(s3::configure((&sdk).into()).build());
    S3BlobStore::new(client, config.s3_bucket.clone(), PRESIGN_TTL, clock)
}

/// R2 with its static bucket-scoped keys; the AWS profile and instance role are never used.
async fn r2_store(r2: &R2Config, clock: Arc<SystemClock>, timeouts: TimeoutConfig) -> S3BlobStore {
    let keys = Credentials::new(
        r2.access_key_id.clone(),
        r2.secret_access_key.clone(),
        None,
        None,
        "r2-env",
    );
    let sdk = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(s3::r2::REGION))
        .credentials_provider(keys)
        .timeout_config(timeouts)
        .load()
        .await;
    let client =
        aws_sdk_s3::Client::from_conf(s3::r2::configure((&sdk).into(), &r2.endpoint).build());
    S3BlobStore::new(client, r2.bucket.clone(), PRESIGN_TTL, clock).without_object_tags()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |key| map.get(key).cloned()
    }

    fn full() -> Vec<(&'static str, &'static str)> {
        vec![
            ("DATA_DIR", "/data"),
            ("DATABASE_URL", "sqlite:///data/nimbytes.db"),
            ("PUBLIC_BASE_URL", "https://localhost"),
            ("DEMO_PASSCODE", "pw"),
            ("SESSION_SECRET", SECRET),
            ("S3_BUCKET", "nimbytes-media-test"),
            ("AWS_REGION", "ap-southeast-1"),
            ("MODEL_API_KEY", "key"),
            ("PE_MODEL_DIR", "/models/pe"),
            ("RENDERER_URL", "http://renderer:3001"),
        ]
    }

    #[test]
    fn parses_required_keys_and_leaves_absent_optional_keys_empty() {
        let config = Config::from_lookup(lookup(&full())).unwrap();

        assert_eq!(config.data_dir, PathBuf::from("/data"));
        assert_eq!(config.database_url, "sqlite:///data/nimbytes.db");
        assert_eq!(config.s3_bucket, "nimbytes-media-test");
        assert_eq!(config.aws_region, "ap-southeast-1");
        assert_eq!(config.bind_addr.to_string(), "0.0.0.0:8080");
        assert_eq!(config.model_api_key, "key");
        assert_eq!(config.aws_profile, None);
        assert_eq!(config.renderer_url, "http://renderer:3001");
        assert!(
            !config.face_boxes_backfill,
            "the face box backfill is off by default"
        );
    }

    #[test]
    fn guide_voice_is_off_until_its_model_dir_is_set() {
        assert_eq!(
            Config::from_lookup(lookup(&full())).unwrap().tts_model_dir,
            None
        );
        let mut env = full();
        env.push(("TTS_MODEL_DIR", "/models/mms-tts-eng"));
        assert_eq!(
            Config::from_lookup(lookup(&env)).unwrap().tts_model_dir,
            Some(PathBuf::from("/models/mms-tts-eng"))
        );
    }

    #[test]
    fn workers_default_to_two_and_accept_one_to_eight() {
        assert_eq!(
            Config::from_lookup(lookup(&full())).unwrap().workers,
            WORKERS
        );
        let with = |v: &'static str| {
            let mut env = full();
            env.push(("WORKERS", v));
            Config::from_lookup(lookup(&env)).map(|c| c.workers)
        };
        assert_eq!(with("4").unwrap(), 4);
        assert_eq!(with(" 8 ").unwrap(), MAX_WORKERS);
        assert!(with("0").is_err() && with("9").is_err() && with("two").is_err());
    }

    #[test]
    fn the_face_box_backfill_runs_only_when_its_flag_is_1() {
        let with = |v: &'static str| {
            let mut env = full();
            env.push(("FACE_BOXES_BACKFILL", v));
            Config::from_lookup(lookup(&env))
                .unwrap()
                .face_boxes_backfill
        };
        assert!(with("1"));
        assert!(!with("0") && !with("yes") && !with(""));
    }

    #[test]
    fn rejects_a_missing_required_key_by_name() {
        let mut env = full();
        env.retain(|(k, _)| *k != "S3_BUCKET");
        let err = Config::from_lookup(lookup(&env)).unwrap_err();

        assert_eq!(err.code, ErrorCode::ValidationFailed);
        assert_eq!(err.message, "env S3_BUCKET is required");
    }

    #[test]
    fn treats_a_blank_required_key_as_missing() {
        let mut env = full();
        env.push(("DATA_DIR", "  "));
        env.remove(0);
        let err = Config::from_lookup(lookup(&env)).unwrap_err();

        assert_eq!(err.message, "env DATA_DIR is required");
    }

    fn r2_env() -> Vec<(&'static str, &'static str)> {
        let mut env = full();
        env.extend([
            ("STORAGE_PROVIDER", "r2"),
            ("R2_ACCOUNT_ID", "0123456789abcdef0123456789abcdef"),
            ("R2_BUCKET", "nimbytes-media"),
            ("R2_ACCESS_KEY_ID", "r2-key"),
            ("R2_SECRET_ACCESS_KEY", "r2-secret"),
        ]);
        env
    }

    #[test]
    fn storage_is_s3_when_the_provider_is_unset_or_s3() {
        let unset = Config::from_lookup(lookup(&full())).unwrap();
        let mut env = full();
        env.push(("STORAGE_PROVIDER", "S3"));
        let named = Config::from_lookup(lookup(&env)).unwrap();

        assert_eq!((unset.storage, named.storage), (Storage::S3, Storage::S3));
    }

    #[test]
    fn r2_storage_reads_its_endpoint_and_keys() {
        let config = Config::from_lookup(lookup(&r2_env())).unwrap();

        assert_eq!(
            config.storage,
            Storage::R2(R2Config {
                endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"
                    .into(),
                bucket: "nimbytes-media".into(),
                access_key_id: "r2-key".into(),
                secret_access_key: "r2-secret".into(),
            })
        );
        assert_eq!(
            config.s3_bucket, "nimbytes-media-test",
            "kept for going back to S3"
        );
        assert!(
            !format!("{config:?}").contains("r2-secret"),
            "the secret is never printed"
        );
    }

    #[test]
    fn r2_storage_names_its_missing_key_and_refuses_a_bad_account_or_provider() {
        let missing = |key: &str| {
            let mut env = r2_env();
            env.retain(|(k, _)| *k != key);
            Config::from_lookup(lookup(&env)).unwrap_err().message
        };
        let with = |key: &'static str, value: &'static str| {
            let mut env = r2_env();
            env.retain(|(k, _)| *k != key);
            env.push((key, value));
            Config::from_lookup(lookup(&env)).unwrap_err()
        };

        assert_eq!(missing("R2_ACCOUNT_ID"), "env R2_ACCOUNT_ID is required");
        assert_eq!(missing("R2_BUCKET"), "env R2_BUCKET is required");
        assert_eq!(
            missing("R2_ACCESS_KEY_ID"),
            "env R2_ACCESS_KEY_ID is required"
        );
        assert_eq!(
            missing("R2_SECRET_ACCESS_KEY"),
            "env R2_SECRET_ACCESS_KEY is required"
        );
        assert_eq!(
            with("R2_ACCOUNT_ID", "evil.com/x").code,
            ErrorCode::ValidationFailed
        );
        assert_eq!(
            with("STORAGE_PROVIDER", "gcs").message,
            "env STORAGE_PROVIDER must be s3 or r2"
        );
    }

    #[test]
    fn the_price_file_parses_with_the_published_prices() {
        let p = prices().unwrap();
        assert_eq!(
            (
                p.spark.input_per_m,
                p.spark.output_per_m,
                p.spark.cached_input_per_m
            ),
            (1.25, 4.25, 0.15)
        );
        assert_eq!((p.sam.per_1000_frames, p.sam.min_frames), (0.20, 50));
        assert_eq!(p.transcribe.per_hour, 0.18);
        assert_eq!(p.image.per_image, 0.01);
    }

    #[test]
    fn the_storage_file_sets_a_250_gb_cap_per_account() {
        assert_eq!(storage_cap().unwrap().bytes, 250_000_000_000);
    }

    #[test]
    fn rejects_a_session_secret_shorter_than_32_bytes() {
        let mut env = full();
        env.retain(|(k, _)| *k != "SESSION_SECRET");
        env.push(("SESSION_SECRET", "short"));
        let err = Config::from_lookup(lookup(&env)).unwrap_err();

        assert_eq!(err.message, "env SESSION_SECRET must be at least 32 bytes");
    }
}
