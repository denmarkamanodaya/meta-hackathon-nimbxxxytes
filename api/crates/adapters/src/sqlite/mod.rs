//! SQLite adapters: one pool (WAL, foreign keys on), schema from `api/migrations/` embedded at
//! build time.

mod brand;
mod catalogue;
mod exports;
mod face_store;
mod guides;
mod jobs;
mod ledger;
mod privacy;
mod productions;
mod projects;
mod shorts;
mod subjects;
mod usage;
mod vectors;

#[cfg(test)]
mod migration_tests;

use std::str::FromStr;
use std::time::Duration;

use nimbytes_core::{AppError, ErrorCode};
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

pub use brand::SqliteBrandStore;
pub use catalogue::SqliteCatalogue;
pub use exports::SqliteExportStore;
pub use face_store::SqliteFaceStore;
pub use guides::SqliteGuideStore;
pub use jobs::SqliteJobQueue;
pub use ledger::SqliteModelLedger;
pub use privacy::SqlitePrivacyStore;
pub use productions::SqliteProductionStore;
pub use projects::SqliteProjectStore;
pub use shorts::SqliteShortStore;
pub use subjects::SqliteSubjectStore;
pub use usage::SqliteUsageStore;
pub use vectors::SqliteVectorIndex;

/// Opens (creating if needed) the database at `url` and applies pending migrations.
///
/// # Errors
/// `INTERNAL` when the URL is invalid, the file cannot be opened or a migration fails.
pub async fn connect(url: &str, busy_timeout: Duration) -> Result<SqlitePool, AppError> {
    register_sqlite_vec()?;
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

/// Registers sqlite-vec with SQLite so every connection opened afterwards has `vec0` (needed by
/// the migrations). Runs once per process.
///
/// # Errors
/// `INTERNAL` when SQLite rejects the registration.
pub fn register_sqlite_vec() -> Result<(), AppError> {
    static RESULT: std::sync::OnceLock<i32> = std::sync::OnceLock::new();
    let rc = *RESULT.get_or_init(|| {
        // SAFETY: sqlite3_vec_init has SQLite's extension entry signature
        // (sqlite3*, char**, const sqlite3_api_routines*) -> int (sqlite-vec.h); the crate declares
        // it without arguments, so it is cast to the type sqlite3_auto_extension expects.
        unsafe {
            libsqlite3_sys::sqlite3_auto_extension(Some(std::mem::transmute::<
                *const (),
                unsafe extern "C" fn(
                    *mut libsqlite3_sys::sqlite3,
                    *mut *mut std::ffi::c_char,
                    *const libsqlite3_sys::sqlite3_api_routines,
                ) -> std::ffi::c_int,
            >(
                sqlite_vec::sqlite3_vec_init as *const (),
            )))
        }
    });
    if rc == libsqlite3_sys::SQLITE_OK {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::Internal,
            format!("sqlite-vec registration failed: {rc}"),
        ))
    }
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
    register_sqlite_vec().unwrap();
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
