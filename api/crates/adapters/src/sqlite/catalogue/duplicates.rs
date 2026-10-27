//! Content hashes, duplicates, the pre-upload check and removing a clip, on SQLite.

use nimbytes_core::AppError;
use nimbytes_core::domain::clip::Clip;
use nimbytes_core::domain::ids::{ClipId, UserId};

use super::SqliteCatalogue;
use super::uploads::clip_from_row;
use crate::sqlite::db_err;

impl SqliteCatalogue {
    pub(super) async fn hashed(&self, id: &ClipId, sha256: &str) -> Result<(), AppError> {
        sqlx::query("UPDATE clips SET content_sha256 = ? WHERE id = ?")
            .bind(sha256)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    pub(super) async fn same_hash(
        &self,
        user: &UserId,
        sha256: &str,
    ) -> Result<Vec<Clip>, AppError> {
        let rows = sqlx::query(
            "SELECT * FROM clips WHERE user_id = ? AND content_sha256 = ? \
             AND status NOT IN ('failed', 'duplicate') ORDER BY created_at, id",
        )
        .bind(user.as_str())
        .bind(sha256)
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter().map(clip_from_row).collect()
    }

    pub(super) async fn duplicate(&self, id: &ClipId, of: &ClipId) -> Result<(), AppError> {
        sqlx::query("UPDATE clips SET status = 'duplicate', duplicate_of = ? WHERE id = ?")
            .bind(of.as_str())
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    pub(super) async fn without_hash(&self) -> Result<Vec<ClipId>, AppError> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM clips WHERE content_sha256 IS NULL AND status = 'ready' \
             ORDER BY created_at, id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        ids.into_iter().map(ClipId::parse).collect()
    }

    pub(super) async fn same_name_and_size(
        &self,
        user: &UserId,
        filename: &str,
        size_bytes: u64,
    ) -> Result<Option<Clip>, AppError> {
        let size = i64::try_from(size_bytes).unwrap_or(i64::MAX);
        let row = sqlx::query(
            "SELECT * FROM clips WHERE user_id = ? AND filename = ? AND size_bytes = ? \
             AND status NOT IN ('failed', 'duplicate') ORDER BY created_at, id LIMIT 1",
        )
        .bind(user.as_str())
        .bind(filename)
        .bind(size)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;
        row.as_ref().map(clip_from_row).transpose()
    }

    /// Deletes the upload row (it references the clip without a cascade), then the clip; its
    /// segments, transcript, speakers and face tracks cascade.
    pub(super) async fn delete(&self, id: &ClipId) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        for sql in [
            "DELETE FROM uploads WHERE clip_id = ?",
            "DELETE FROM clips WHERE id = ?",
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
