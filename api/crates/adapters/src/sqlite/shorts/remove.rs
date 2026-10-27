//! Removing a short's rows in one transaction.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::ShortId;

use super::SqliteShortStore;
use crate::sqlite::db_err;

impl SqliteShortStore {
    /// Deletes the step log, versions and picks, then the short. The child rows would cascade,
    /// but deleting them by name keeps the removal correct even on a connection without foreign
    /// keys.
    pub(super) async fn remove(&self, id: &ShortId) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        for sql in [
            "DELETE FROM agent_steps WHERE short_id = ?",
            "DELETE FROM short_versions WHERE short_id = ?",
            "DELETE FROM short_segments WHERE short_id = ?",
            "DELETE FROM shorts WHERE id = ?",
        ] {
            sqlx::query(sql)
                .bind(id.as_str())
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }
}
