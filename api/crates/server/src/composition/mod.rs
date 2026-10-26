//! Composition root: the only module that reads the environment. Env is parsed once into
//! [`Config`]; adapters are built here and bound to ports. No business decisions live here.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use aws_config::timeout::TimeoutConfig;
use aws_config::{BehaviorVersion, Region};
use axum_extra::extract::cookie::Key;
use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::{
    RemotionRenderer, RenderTimeouts, S3BlobStore, SqliteCatalogue, SqliteJobQueue,
    SqliteShortStore, SystemClock, UuidV7Ids, s3, sqlite,
};
use nimbytes_core::usecases::jobs::ByKind;
use nimbytes_core::usecases::shorts::ShortSteps;
use nimbytes_core::{AppError, ErrorCode};

mod understanding;

pub use understanding::{PRICES_TOML, prices};

use crate::progress::BroadcastProgress;
use crate::state::{AppState, Ports};
use crate::worker::Worker;

/// Address the API listens on inside the container (Caddy proxies `/api/*` to it).
pub const BIND_ADDR: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 8080);
/// Lifetime of presigned GET URLs handed to the client (thumbnails, proxy, face crops).
pub const URL_TTL: Duration = Duration::from_secs(3600);
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
/// Worker tasks.
pub const WORKERS: usize = 2;
/// Sleep between polls of an empty job queue.
pub const IDLE_POLL: Duration = Duration::from_secs(1);
/// Step events buffered per slow SSE listener.
pub const PROGRESS_BUFFER: usize = 256;

/// Minimum `SESSION_SECRET` length; the cookie key is derived from it.
pub const MIN_SECRET_BYTES: usize = 32;

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
    /// `S3_BUCKET`: media bucket.
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
        })
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
    let jobs = Arc::new(SqliteJobQueue::new(pool.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(UuidV7Ids);
    let catalogue = Arc::new(SqliteCatalogue::new(pool.clone()));
    let m = understanding::models(config, pool.clone(), clock.clone(), ids.clone())?;
    let ports = Arc::new(Ports {
        blobs: Arc::new(s3_store(config, clock.clone()).await),
        shorts: Arc::new(SqliteShortStore::new(pool)),
        catalogue: catalogue.clone(),
        jobs: jobs.clone(),
        clock: clock.clone(),
        ids,
        people: catalogue,
        reasoner: m.reasoner,
        text: m.text,
        embedder: m.embedder,
        vectors: m.vectors,
        ledger: m.ledger,
        passcode: config.demo_passcode.clone(),
        url_ttl: URL_TTL,
    });
    let progress = Arc::new(BroadcastProgress::new(PROGRESS_BUFFER));
    let runner = Arc::new(job_runner(config, &ports, &m.meta)?);
    let state = AppState {
        ports,
        cookie_key: Key::derive_from(config.session_secret.as_bytes()),
        progress: progress.clone(),
    };
    let worker = Worker {
        queue: jobs,
        runner,
        clock,
        progress,
        idle_poll: IDLE_POLL,
    };
    Ok((state, worker))
}

fn create_data_dir(config: &Config) -> Result<(), AppError> {
    std::fs::create_dir_all(&config.data_dir)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("cannot create DATA_DIR: {e}")))
}

/// Ingest jobs to the ingest pipeline; agent and render jobs to the shorts steps.
fn job_runner(config: &Config, ports: &Ports, meta: &MetaClient) -> Result<ByKind, AppError> {
    Ok(ByKind {
        ingest: Arc::new(understanding::ingest_steps(config, ports, meta)?),
        shorts: Arc::new(short_steps(config, ports)?),
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

async fn s3_store(config: &Config, clock: Arc<SystemClock>) -> S3BlobStore {
    let timeouts = TimeoutConfig::builder()
        .operation_timeout(S3_OPERATION_TIMEOUT)
        .connect_timeout(S3_CONNECT_TIMEOUT)
        .build();
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
