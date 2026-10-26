//! SQLite adapters: one pool (WAL, foreign keys on), schema from `api/migrations/` embedded at
//! build time.

mod catalogue;
mod jobs;

use std::str::FromStr;
use std::time::Duration;

use nimbytes_core::{AppError, ErrorCode};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

pub use catalogue::SqliteCatalogue;
pub use jobs::SqliteJobQueue;

/// Opens (creating if needed) the database at `url` and applies pending migrations.
///
/// # Errors
/// `INTERNAL` when the URL is invalid, the file cannot be opened or a migration fails.
pub async fn connect(url: &str, busy_timeout: Duration) -> Result<SqlitePool, AppError> {
    let options = SqliteConnectOptions::from_str(url)
        .map_err(db_err)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(busy_timeout);
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await;
    let pool = pool.map_err(db_err)?;
    sqlx::migrate!("../../migrations")
        .run(&pool)
        .await
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("migration failed: {e}")))?;
    Ok(pool)
}

/// Maps any sqlx error to `INTERNAL`; the message stays in logs, never on the wire.
pub(crate) fn db_err(err: sqlx::Error) -> AppError {
    AppError::new(ErrorCode::Internal, format!("database: {err}"))
}

/// Reads an `INTEGER` column holding a non-negative byte count.
pub(crate) fn to_u64(raw: i64, column: &str) -> Result<u64, AppError> {
    u64::try_from(raw).map_err(|_| AppError::new(ErrorCode::Internal, format!("negative {column}")))
}

/// Writes a byte count to an `INTEGER` column.
pub(crate) fn to_i64(raw: u64, column: &str) -> Result<i64, AppError> {
    i64::try_from(raw).map_err(|_| AppError::new(ErrorCode::Internal, format!("huge {column}")))
}

#[cfg(test)]
pub(crate) async fn test_pool() -> SqlitePool {
    // A private in-memory database per test; one connection so every query sees it.
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();
    pool
}
