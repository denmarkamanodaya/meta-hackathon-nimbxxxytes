//! [`ModelLedger`] on the `model_cache` and `model_calls` tables.

use nimbytes_core::AppError;
use nimbytes_core::domain::cost::{ModelCall, Usage};
use nimbytes_core::ports::{CacheEntry, ModelLedger, PortResult};
use sqlx::SqlitePool;

use super::{db_err, to_i64};

/// Model cache and cost log backed by the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteModelLedger {
    pool: SqlitePool,
}

impl SqliteModelLedger {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert_call(&self, c: &ModelCall) -> Result<(), AppError> {
        let (tokens_in, tokens_out, frames, audio_s) = match c.usage {
            Some(Usage::Tokens { input, output, .. }) => (Some(input), Some(output), None, None),
            Some(Usage::Frames(f)) => (None, None, Some(f), None),
            Some(Usage::AudioSeconds(s)) => (None, None, None, Some(s)),
            None => (None, None, None, None),
        };
        let opt = |v: Option<u64>| v.map(|n| to_i64(n, "usage")).transpose();
        sqlx::query(
            "INSERT INTO model_calls (id, at, model, purpose, input_hash, input_tokens, \
             output_tokens, frames, audio_s, cost_usd, latency_ms, cache_hit, status, error) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&c.id)
        .bind(&c.at)
        .bind(&c.model)
        .bind(&c.purpose)
        .bind(&c.input_hash)
        .bind(opt(tokens_in)?)
        .bind(opt(tokens_out)?)
        .bind(opt(frames)?)
        .bind(audio_s)
        .bind(c.cost_usd)
        .bind(to_i64(c.latency_ms, "latency_ms")?)
        .bind(c.cache_hit)
        .bind(if c.error.is_some() { "error" } else { "ok" })
        .bind(&c.error)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }
}

impl ModelLedger for SqliteModelLedger {
    fn cached<'a>(&'a self, input_hash: &'a str) -> PortResult<'a, Option<String>> {
        Box::pin(async move {
            sqlx::query_scalar("SELECT response FROM model_cache WHERE input_hash = ?")
                .bind(input_hash)
                .fetch_optional(&self.pool)
                .await
                .map_err(db_err)
        })
    }

    fn store<'a>(&'a self, e: CacheEntry<'a>) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "INSERT INTO model_cache (input_hash, model, response, created_at) VALUES (?, ?, ?, ?) \
                 ON CONFLICT (input_hash) DO NOTHING",
            )
            .bind(e.input_hash)
            .bind(e.model)
            .bind(e.response)
            .bind(e.created_at)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }

    fn record<'a>(&'a self, call: &'a ModelCall) -> PortResult<'a, ()> {
        Box::pin(self.insert_call(call))
    }
}
