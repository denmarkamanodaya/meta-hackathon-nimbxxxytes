//! Clip titles and last views on SQLite.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::ClipId;

use super::SqliteCatalogue;
use crate::sqlite::db_err;

impl SqliteCatalogue {
    /// Runs `UPDATE clips SET <col> = ? WHERE id = ?` for one of the statements below.
    async fn set_clip_text(
        &self,
        sql: &'static str,
        id: &ClipId,
        value: &str,
    ) -> Result<(), AppError> {
        sqlx::query(sql)
            .bind(value)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    pub(super) async fn viewed(&self, id: &ClipId, at: &str) -> Result<(), AppError> {
        self.set_clip_text("UPDATE clips SET last_viewed_at = ? WHERE id = ?", id, at)
            .await
    }

    pub(super) async fn titled(&self, id: &ClipId, title: &str) -> Result<(), AppError> {
        self.set_clip_text("UPDATE clips SET title = ? WHERE id = ?", id, title)
            .await
    }

    pub(super) async fn ready_ids(&self) -> Result<Vec<ClipId>, AppError> {
        let ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM clips WHERE status = 'ready' ORDER BY created_at")
                .fetch_all(&self.pool)
                .await
                .map_err(db_err)?;
        ids.into_iter().map(ClipId::parse).collect()
    }

    pub(super) async fn untitled(&self) -> Result<Vec<ClipId>, AppError> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM clips WHERE status = 'ready' AND title IS NULL ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        ids.into_iter().map(ClipId::parse).collect()
    }
}
