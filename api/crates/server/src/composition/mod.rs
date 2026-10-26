//! Composition root: the only module that reads the environment. Env is parsed once into
//! [`Config`]; adapters are built here and bound to ports. No business decisions live here.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use aws_config::timeout::TimeoutConfig;
use aws_config::{BehaviorVersion, Region};
use axum_extra::extract::cookie::Key;
use nimbytes_adapters::meta::{MetaClient, MetaConfig, MetaDeps, MetaTranscriber};
use nimbytes_adapters::{
    FfmpegMediaTool, FsScratch, MediaTimeouts, S3BlobStore, SqliteCatalogue, SqliteJobQueue,
    SqliteModelLedger, SystemClock, UuidV7Ids, s3, sqlite,
};
use nimbytes_core::domain::cost::Prices;
use nimbytes_core::usecases::ingest::IngestSteps;
use nimbytes_core::{AppError, ErrorCode};
use sqlx::SqlitePool;

use crate::progress::BroadcastProgress;
use crate::state::{AppState, Ports};
use crate::worker::Worker;

/// Address the API listens on inside the container (Caddy proxies `/api/*` to it).
pub const BIND_ADDR: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 8080);
/// Lifetime of presigned part URLs.
pub const PRESIGN_TTL: Duration = Duration::from_secs(15 * 60);
/// How long a write waits for SQLite's lock before failing.
pub const DB_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// Whole-operation limit for one S3 call (retries included).
pub const S3_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
/// TCP + TLS connect limit for S3.
pub const S3_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Worker tasks.
pub const WORKERS: usize = 2;
/// Sleep between polls of an empty job queue.
pub const IDLE_POLL: Duration = Duration::from_secs(1);
/// Meta Model API base URL.
pub const META_BASE_URL: &str = "https://api.meta.ai/v1";
/// Model prices, compiled in from `api/config/prices.toml` (parsed at start-up).
pub const PRICES_TOML: &str = include_str!("../../../config/prices.toml");
/// ffprobe and scene-cut scans.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(120);
/// Any single encode (the proxy of a 3-minute 4K clip is the slowest).
pub const ENCODE_TIMEOUT: Duration = Duration::from_secs(900);
/// One Voice Transcribe attempt (up to 10 minutes of audio).
pub const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(300);
/// TCP + TLS connect limit for the Meta API.
pub const META_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// First retry delay for Meta calls; doubles, jittered.
pub const META_BACKOFF: Duration = Duration::from_secs(1);
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
    /// `PE_MODEL_DIR`: Perception Encoder ONNX directory; required from Phase 4.
    pub pe_model_dir: Option<PathBuf>,
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
            pe_model_dir: optional("PE_MODEL_DIR").map(PathBuf::from),
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

/// Parses the compiled-in price file.
///
/// # Errors
/// `VALIDATION_FAILED` when the file does not match the price schema.
pub fn prices() -> Result<Prices, AppError> {
    toml::from_str(PRICES_TOML)
        .map_err(|e| AppError::new(ErrorCode::ValidationFailed, format!("prices.toml: {e}")))
}

/// Builds every adapter, binds them to ports, and returns the HTTP state plus the worker.
///
/// # Errors
/// `INTERNAL` when the data directory or database cannot be opened; `VALIDATION_FAILED` for a
/// bad price file.
pub async fn build(config: &Config) -> Result<(AppState, Worker), AppError> {
    std::fs::create_dir_all(&config.data_dir)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("cannot create DATA_DIR: {e}")))?;
    let pool = sqlite::connect(&config.database_url, DB_BUSY_TIMEOUT).await?;
    let jobs = Arc::new(SqliteJobQueue::new(pool.clone()));
    let clock = Arc::new(SystemClock);
    let ports = Arc::new(Ports {
        blobs: Arc::new(s3_store(config).await),
        catalogue: Arc::new(SqliteCatalogue::new(pool.clone())),
        jobs: jobs.clone(),
        clock: clock.clone(),
        ids: Arc::new(UuidV7Ids),
        passcode: config.demo_passcode.clone(),
    });
    let progress = Arc::new(BroadcastProgress::new(PROGRESS_BUFFER));
    let runner = Arc::new(ingest_steps(config, &ports, pool)?);
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

fn ingest_steps(config: &Config, ports: &Ports, pool: SqlitePool) -> Result<IngestSteps, AppError> {
    let http = reqwest::Client::builder()
        .connect_timeout(META_CONNECT_TIMEOUT)
        .build()
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("http client: {e}")))?;
    let meta = MetaClient::new(
        http,
        MetaConfig {
            base_url: META_BASE_URL.to_owned(),
            api_key: config.model_api_key.clone(),
            max_retries: 2,
            base_backoff: META_BACKOFF,
        },
        prices()?,
        MetaDeps {
            ledger: Arc::new(SqliteModelLedger::new(pool)),
            clock: ports.clock.clone(),
            ids: ports.ids.clone(),
        },
    );
    Ok(IngestSteps {
        blobs: ports.blobs.clone(),
        catalogue: ports.catalogue.clone(),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        scratch: Arc::new(FsScratch::new(config.data_dir.join("work"))),
        transcriber: Arc::new(MetaTranscriber::new(meta, TRANSCRIBE_TIMEOUT)),
    })
}

async fn s3_store(config: &Config) -> S3BlobStore {
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
    S3BlobStore::new(client, config.s3_bucket.clone(), PRESIGN_TTL)
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
