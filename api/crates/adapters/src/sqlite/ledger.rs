//! [`ModelLedger`] on the `model_cache` and `model_calls` tables.

use nimbytes_core::AppError;
use nimbytes_core::domain::cost::{ModelCall, ModelSpend, Usage};
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

    fn cost_since<'a>(&'a self, since: &'a str) -> PortResult<'a, f64> {
        Box::pin(async move {
            sqlx::query_scalar("SELECT COALESCE(SUM(cost_usd), 0.0) FROM model_calls WHERE at >= ?")
                .bind(since)
                .fetch_one(&self.pool)
                .await
                .map_err(db_err)
        })
    }

    fn spend(&self) -> PortResult<'_, Vec<ModelSpend>> {
        Box::pin(async move {
            let rows: Vec<(String, i64, f64)> = sqlx::query_as(
                "SELECT model, COUNT(*), COALESCE(SUM(cost_usd), 0) FROM model_calls \
                 GROUP BY model ORDER BY SUM(cost_usd) DESC, model",
            )
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(rows
                .into_iter()
                .map(|(model, calls, cost_usd)| ModelSpend {
                    model,
                    calls: u64::try_from(calls).unwrap_or(0),
                    cost_usd,
                })
                .collect())
        })
    }
}

#[cfg(test)]
mod tests {
    use nimbytes_core::domain::cost::{ModelCall, Usage};
    use nimbytes_core::ports::ModelLedger;

    use super::SqliteModelLedger;
    use crate::sqlite::test_pool;

    fn call(id: &str, model: &str, cost_usd: f64) -> ModelCall {
        ModelCall {
            id: id.into(),
            at: "2026-10-27T00:00:00.000Z".into(),
            model: model.into(),
            purpose: "p".into(),
            input_hash: "h".into(),
            usage: Some(Usage::Frames(50)),
            cost_usd,
            latency_ms: 1,
            cache_hit: false,
            error: None,
        }
    }

    #[tokio::test]
    async fn spend_sums_per_model_most_expensive_first() {
        let ledger = SqliteModelLedger::new(test_pool().await);
        for c in [
            call("1", "muse-spark-1.3", 0.005),
            call("2", "muse-spark-1.3", 0.007),
            call("3", "sam-3.1", 0.01),
        ] {
            ledger.record(&c).await.unwrap();
        }

        let spend = ledger.spend().await.unwrap();

        assert_eq!(spend.len(), 2);
        assert_eq!(
            (spend[0].model.as_str(), spend[0].calls),
            ("muse-spark-1.3", 2)
        );
        assert!((spend[0].cost_usd - 0.012).abs() < 1e-12);
        assert_eq!((spend[1].model.as_str(), spend[1].calls), ("sam-3.1", 1));
    }

    #[tokio::test]
    async fn cost_since_counts_only_calls_from_that_instant_on() {
        let ledger = SqliteModelLedger::new(test_pool().await);
        let mut late = call("2", "muse-spark-1.3", 0.02);
        late.at = "2026-10-27T00:00:05.000Z".into();
        ledger
            .record(&call("1", "muse-spark-1.3", 0.5))
            .await
            .unwrap();
        ledger.record(&late).await.unwrap();

        let since = ledger.cost_since("2026-10-27T00:00:05.000Z").await.unwrap();

        assert!((since - 0.02).abs() < 1e-12);
        assert_eq!(
            ledger.cost_since("2026-10-28T00:00:00.000Z").await.unwrap(),
            0.0
        );
    }
}
