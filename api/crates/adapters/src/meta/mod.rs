//! `MetaClient`: the one way to call the Meta Model API. Every call is keyed by a hash of model,
//! purpose and every input byte; a cached response is replayed without a request. Otherwise the
//! call is sent with a per-model timeout, retried up to twice with jittered backoff on 429, 5xx
//! and transport errors, and logged as one `model_calls` row with its cost.

pub mod prompt;
pub mod sam;
pub mod spark;
mod transcribe;

use std::hash::BuildHasher;
use std::sync::Arc;
use std::time::{Duration, Instant};

use nimbytes_core::domain::cost::{ModelCall, Prices, Usage, cost_usd};
use nimbytes_core::ports::{CacheEntry, Clock, IdGenerator, ModelLedger};
use nimbytes_core::time::format_utc;
use nimbytes_core::{AppError, ErrorCode};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub use transcribe::MetaTranscriber;

/// Connection settings, from the composition root.
#[derive(Debug, Clone)]
pub struct MetaConfig {
    /// `https://api.meta.ai/v1` in production; a local fake in tests.
    pub base_url: String,
    /// Bearer key.
    pub api_key: String,
    /// Retries after the first attempt (2).
    pub max_retries: u32,
    /// First backoff; doubles per retry, with ±50 % jitter.
    pub base_backoff: Duration,
}

/// Ports the client logs through.
#[derive(Clone)]
pub struct MetaDeps {
    /// Cache and cost rows.
    pub ledger: Arc<dyn ModelLedger>,
    /// Row timestamps.
    pub clock: Arc<dyn Clock>,
    /// Row ids.
    pub ids: Arc<dyn IdGenerator>,
}

/// One request description. `build` makes a fresh request for every attempt (multipart bodies
/// cannot be replayed); `fingerprint` lists every byte that decides the answer.
pub struct MetaCall<'a> {
    /// Model id, e.g. `muse-voice-transcribe-1.0`.
    pub model: &'a str,
    /// What the call is for (logged).
    pub purpose: &'a str,
    /// Per-attempt timeout.
    pub timeout: Duration,
    /// Request body, media bytes, … in a fixed order.
    pub fingerprint: &'a [&'a [u8]],
    /// Builds the request against `base_url` (auth is added by the client); an error here is
    /// not retried.
    pub build: &'a (
            dyn Fn(&reqwest::Client, &str) -> Result<reqwest::RequestBuilder, String> + Send + Sync
        ),
    /// Reads what the call consumed from a successful response body.
    pub usage: fn(&str) -> Option<Usage>,
}

/// Shared client; cheap to clone.
#[derive(Clone)]
pub struct MetaClient {
    http: reqwest::Client,
    config: Arc<MetaConfig>,
    prices: Arc<Prices>,
    deps: MetaDeps,
}

/// What a logged call row needs besides the call itself.
struct Pending {
    hash: String,
    started: Instant,
}

enum Attempt {
    Done(String),
    Retry(String),
    Fatal(String),
}

impl MetaClient {
    /// Builds a client; `http` should have connect timeouts set by the caller.
    pub fn new(http: reqwest::Client, config: MetaConfig, prices: Prices, deps: MetaDeps) -> Self {
        Self {
            http,
            config: Arc::new(config),
            prices: Arc::new(prices),
            deps,
        }
    }

    /// Returns the raw response body (JSON, or SSE text for streamed calls), from the cache or
    /// the API.
    ///
    /// # Errors
    /// `MODEL_UNAVAILABLE` after retries or on a non-retryable status; ledger errors pass through.
    pub async fn call(&self, call: MetaCall<'_>) -> Result<String, AppError> {
        let p = Pending {
            hash: fingerprint(call.model, call.purpose, call.fingerprint),
            started: Instant::now(),
        };
        let hash = p.hash.as_str();
        if let Some(body) = self.deps.ledger.cached(hash).await? {
            self.log(&call, &p, Ok((None, true))).await?;
            return Ok(body);
        }
        let outcome = self.send_with_retries(&call).await;
        match outcome {
            Ok(body) => {
                let now = format_utc(self.deps.clock.now_millis());
                let entry = CacheEntry {
                    input_hash: hash,
                    model: call.model,
                    response: &body,
                    created_at: &now,
                };
                self.deps.ledger.store(entry).await?;
                self.log(&call, &p, Ok(((call.usage)(&body), false)))
                    .await?;
                Ok(body)
            }
            Err(message) => {
                let err = AppError::new(ErrorCode::ModelUnavailable, message);
                self.log(&call, &p, Err(&err)).await?;
                Err(err)
            }
        }
    }

    async fn send_with_retries(&self, call: &MetaCall<'_>) -> Result<String, String> {
        let mut last = String::new();
        for attempt in 0..=self.config.max_retries {
            if attempt > 0 {
                tokio::time::sleep(self.backoff(attempt)).await;
            }
            match self.attempt(call).await {
                Attempt::Done(body) => return Ok(body),
                Attempt::Retry(msg) => last = msg,
                Attempt::Fatal(msg) => return Err(msg),
            }
        }
        Err(format!(
            "{} gave up after {} attempts: {last}",
            call.model,
            self.config.max_retries + 1
        ))
    }

    async fn attempt(&self, call: &MetaCall<'_>) -> Attempt {
        let req = match (call.build)(&self.http, &self.config.base_url) {
            Ok(req) => req.bearer_auth(&self.config.api_key).timeout(call.timeout),
            Err(msg) => return Attempt::Fatal(format!("building request: {msg}")),
        };
        let response = match req.send().await {
            Ok(r) => r,
            Err(e) => return Attempt::Retry(format!("transport: {e}")),
        };
        let status = response.status();
        let body = match response.text().await {
            Ok(b) => b,
            Err(e) => return Attempt::Retry(format!("reading body: {e}")),
        };
        let snippet: String = body.chars().take(300).collect();
        if status.is_success() {
            Attempt::Done(body)
        } else if status.as_u16() == 429 || status.is_server_error() {
            Attempt::Retry(format!("HTTP {status}: {snippet}"))
        } else {
            Attempt::Fatal(format!("HTTP {status}: {snippet}"))
        }
    }

    /// `base * 2^(attempt-1)` scaled by a random factor in [0.5, 1.5).
    fn backoff(&self, attempt: u32) -> Duration {
        let jitter = std::collections::hash_map::RandomState::new().hash_one(attempt) % 1000;
        let factor = 0.5 + f64::from(u32::try_from(jitter).unwrap_or(500)) / 1000.0;
        self.config
            .base_backoff
            .mul_f64(f64::from(1u32 << (attempt - 1).min(10)) * factor)
    }

    async fn log(
        &self,
        call: &MetaCall<'_>,
        p: &Pending,
        outcome: Result<(Option<Usage>, bool), &AppError>,
    ) -> Result<(), AppError> {
        let (usage, cache_hit, error) = match outcome {
            Ok((usage, hit)) => (usage, hit, None),
            Err(e) => (None, false, Some(e.message.clone())),
        };
        let row = ModelCall {
            id: self.deps.ids.new_id(),
            at: format_utc(self.deps.clock.now_millis()),
            model: call.model.to_owned(),
            purpose: call.purpose.to_owned(),
            input_hash: p.hash.clone(),
            usage,
            cost_usd: usage
                .filter(|_| !cache_hit)
                .map_or(0.0, |u| cost_usd(&self.prices, u)),
            latency_ms: u64::try_from(p.started.elapsed().as_millis()).unwrap_or(u64::MAX),
            cache_hit,
            error,
        };
        self.deps.ledger.record(&row).await
    }
}

/// SHA-256 hex over model, purpose and each input part (length-prefixed, so parts never blur).
pub fn fingerprint(model: &str, purpose: &str, parts: &[&[u8]]) -> String {
    let mut h = Sha256::new();
    for part in [model.as_bytes(), purpose.as_bytes()].iter().chain(parts) {
        h.update((part.len() as u64).to_le_bytes());
        h.update(part);
    }
    hex::encode(h.finalize())
}

/// Parses a JSON response body.
///
/// # Errors
/// `MODEL_UNAVAILABLE` when the body is not JSON.
pub fn json_body(body: &str) -> Result<Value, AppError> {
    serde_json::from_str(body).map_err(|_| {
        AppError::new(
            ErrorCode::ModelUnavailable,
            "model returned a non-JSON body",
        )
    })
}

#[cfg(test)]
mod fake_api;
#[cfg(test)]
mod tests;
