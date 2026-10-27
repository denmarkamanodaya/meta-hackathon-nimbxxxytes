//! The preview cleanup's reads and writes: old shorts, and forgetting a removed preview.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::short::Short;

use super::{SqliteShortStore, short_from};
use crate::sqlite::db_err;

impl SqliteShortStore {
    /// Shorts of every user created before `cutoff`, oldest first.
    pub(super) async fn older(&self, cutoff: &str) -> Result<Vec<Short>, AppError> {
        let rows = sqlx::query("SELECT * FROM shorts WHERE created_at < ? ORDER BY created_at, id")
            .bind(cutoff)
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(short_from).collect()
    }

    /// Clears version `n`'s preview key.
    pub(super) async fn forget_preview(&self, id: &ShortId, n: u32) -> Result<(), AppError> {
        sqlx::query("UPDATE short_versions SET preview_key = NULL WHERE short_id = ? AND n = ?")
            .bind(id.as_str())
            .bind(i64::from(n))
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}
