//! Composition root: the only module that reads the environment. Env is parsed once into
//! [`Config`]; adapters are built here and bound to ports as later phases add them.

use std::net::SocketAddr;
use std::path::PathBuf;

use nimbytes_core::{AppError, ErrorCode};

/// Address the API listens on inside the container (Caddy proxies `/api/*` to it).
pub const BIND_ADDR: SocketAddr =
    SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), 8080);

/// Typed process configuration, parsed once at start. Keys match `.env.example`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// `DATA_DIR`: root for SQLite, the Tantivy index and scratch media.
    pub data_dir: PathBuf,
    /// `DATABASE_URL`: sqlx SQLite URL.
    pub database_url: String,
    /// `PUBLIC_BASE_URL`: origin the PWA is served from.
    pub public_base_url: String,
    /// Listen address; fixed to [`BIND_ADDR`].
    pub bind_addr: SocketAddr,
    /// `MODEL_API_KEY`: Meta Model API key; required from Phase 2.
    pub model_api_key: Option<String>,
    /// `AWS_REGION`; required from Phase 1.
    pub aws_region: Option<String>,
    /// `S3_BUCKET`; required from Phase 1.
    pub s3_bucket: Option<String>,
    /// `DEMO_PASSCODE`; required from Phase 1.
    pub demo_passcode: Option<String>,
    /// `SESSION_SECRET`; required from Phase 1.
    pub session_secret: Option<String>,
    /// `PE_MODEL_DIR`: Perception Encoder ONNX directory; required from Phase 4.
    pub pe_model_dir: Option<PathBuf>,
}

impl Config {
    /// Reads the process environment once.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` when a required key is missing or empty.
    pub fn from_env() -> Result<Self, AppError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Parses config from any key lookup; `from_env` passes the real environment, tests a map.
    /// Empty values count as missing.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` naming the first missing required key.
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
        Ok(Self {
            data_dir: PathBuf::from(required("DATA_DIR")?),
            database_url: required("DATABASE_URL")?,
            public_base_url: required("PUBLIC_BASE_URL")?,
            bind_addr: BIND_ADDR,
            model_api_key: optional("MODEL_API_KEY"),
            aws_region: optional("AWS_REGION"),
            s3_bucket: optional("S3_BUCKET"),
            demo_passcode: optional("DEMO_PASSCODE"),
            session_secret: optional("SESSION_SECRET"),
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |key| map.get(key).cloned()
    }

    #[test]
    fn parses_required_keys_and_leaves_absent_optional_keys_empty() {
        let config = Config::from_lookup(lookup(&[
            ("DATA_DIR", "/data"),
            ("DATABASE_URL", "sqlite:///data/nimbytes.db"),
            ("PUBLIC_BASE_URL", "https://localhost"),
            ("MODEL_API_KEY", ""),
        ]))
        .unwrap();

        assert_eq!(config.data_dir, PathBuf::from("/data"));
        assert_eq!(config.database_url, "sqlite:///data/nimbytes.db");
        assert_eq!(config.public_base_url, "https://localhost");
        assert_eq!(config.bind_addr.to_string(), "0.0.0.0:8080");
        assert_eq!(config.model_api_key, None);
        assert_eq!(config.s3_bucket, None);
    }

    #[test]
    fn rejects_a_missing_required_key_by_name() {
        let err = Config::from_lookup(lookup(&[
            ("DATA_DIR", "/data"),
            ("PUBLIC_BASE_URL", "https://localhost"),
        ]))
        .unwrap_err();

        assert_eq!(err.code, ErrorCode::ValidationFailed);
        assert_eq!(err.message, "env DATABASE_URL is required");
    }

    #[test]
    fn treats_a_blank_required_key_as_missing() {
        let err = Config::from_lookup(lookup(&[
            ("DATA_DIR", "  "),
            ("DATABASE_URL", "sqlite::memory:"),
            ("PUBLIC_BASE_URL", "https://localhost"),
        ]))
        .unwrap_err();

        assert_eq!(err.message, "env DATA_DIR is required");
    }
}
