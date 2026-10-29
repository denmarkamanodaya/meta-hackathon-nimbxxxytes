//! Moments for near-copy detection: the blank flag of each segment thumbnail, on SQLite.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::similar::Moment;
use sqlx::Row;

use super::SqliteCatalogue;
use crate::sqlite::db_err;

impl SqliteCatalogue {
    pub(super) async fn blank(&self, id: &SegmentId, blank: bool) -> Result<(), AppError> {
        sqlx::query("UPDATE segments SET blank = ? WHERE id = ?")
            .bind(blank)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    pub(super) async fn moment_rows(&self, ids: &[SegmentId]) -> Result<Vec<Moment>, AppError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        // Only `?` placeholders are formatted in; every id is bound.
        let marks = vec!["?"; ids.len()].join(", ");
        let sql = format!(
            "SELECT id, clip_id, start_s, end_s, blank FROM segments WHERE id IN ({marks})"
        );
        let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
        for id in ids {
            q = q.bind(id.as_str());
        }
        let rows = q.fetch_all(&self.pool).await.map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(Moment {
                    segment: SegmentId::parse(r.try_get::<String, _>("id").map_err(db_err)?)?,
                    clip: ClipId::parse(r.try_get::<String, _>("clip_id").map_err(db_err)?)?,
                    span: Span {
                        start_s: r.try_get("start_s").map_err(db_err)?,
                        end_s: r.try_get("end_s").map_err(db_err)?,
                    },
                    blank: r
                        .try_get::<Option<bool>, _>("blank")
                        .map_err(db_err)?
                        .unwrap_or(false),
                })
            })
            .collect()
    }

    pub(super) async fn ready_unchecked(&self) -> Result<Vec<ClipId>, AppError> {
        let rows: Vec<String> = sqlx::query_scalar(
            "SELECT c.id FROM clips c WHERE c.status = 'ready' AND EXISTS \
             (SELECT 1 FROM segments s WHERE s.clip_id = c.id AND s.blank IS NULL) \
             ORDER BY c.created_at, c.id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.into_iter().map(ClipId::parse).collect()
    }
}
