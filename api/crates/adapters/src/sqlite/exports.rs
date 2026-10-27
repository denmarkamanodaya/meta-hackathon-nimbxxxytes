//! [`ExportStore`] on SQLite: `short_exports`, one row per short and platform (hashtags and cover
//! keys as JSON arrays).

use nimbytes_core::domain::export::{ExportAspect, ExportStatus, ShortExport};
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::production::Platform;
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{ExportStore, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::db_err;

/// Short exports on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteExportStore {
    pool: SqlitePool,
}

fn bad_json(e: serde_json::Error) -> AppError {
    AppError::new(ErrorCode::Internal, format!("stored export: {e}"))
}

fn internal(e: AppError) -> AppError {
    AppError::new(ErrorCode::Internal, e.message)
}

fn export_from(r: &SqliteRow) -> Result<ShortExport, AppError> {
    let text = |c: &str| r.try_get::<String, _>(c).map_err(db_err);
    let int = |c: &str| {
        r.try_get::<i64, _>(c)
            .map_err(db_err)
            .map(|n| u32::try_from(n).unwrap_or(0))
    };
    let covers: Vec<String> = serde_json::from_str(&text("cover_keys")?).map_err(bad_json)?;
    Ok(ShortExport {
        id: text("id")?,
        short_id: ShortId::parse(text("short_id")?)?,
        platform: Platform::parse(&text("platform")?).map_err(internal)?,
        aspect: ExportAspect::parse(&text("aspect")?)?,
        version_n: int("version_n")?,
        status: ExportStatus::parse(&text("status")?)?,
        render_key: r
            .try_get::<Option<String>, _>("render_key")
            .map_err(db_err)?
            .map(ObjectKey::from_stored),
        caption: text("caption")?,
        hashtags: serde_json::from_str(&text("hashtags")?).map_err(bad_json)?,
        cover_keys: covers.into_iter().map(ObjectKey::from_stored).collect(),
        cover_pick: int("cover_pick")?,
        updated_at: text("updated_at")?,
    })
}

impl SqliteExportStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn upsert(&self, e: &ShortExport) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO short_exports (id, short_id, platform, aspect, version_n, status, \
             render_key, caption, hashtags, cover_keys, cover_pick, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, NULL, '', '[]', '[]', 0, ?) \
             ON CONFLICT (short_id, platform) DO UPDATE SET aspect = excluded.aspect, \
             version_n = excluded.version_n, status = excluded.status, render_key = NULL, \
             updated_at = excluded.updated_at",
        )
        .bind(&e.id)
        .bind(e.short_id.as_str())
        .bind(e.platform.as_str())
        .bind(e.aspect.as_str())
        .bind(i64::from(e.version_n))
        .bind(e.status.as_str())
        .bind(&e.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn read(&self, short: &ShortId) -> Result<Vec<ShortExport>, AppError> {
        let rows = sqlx::query(
            "SELECT id, short_id, platform, aspect, version_n, status, render_key, caption, \
             hashtags, cover_keys, cover_pick, updated_at FROM short_exports WHERE short_id = ? \
             ORDER BY CASE platform WHEN 'tiktok' THEN 0 WHEN 'reels' THEN 1 \
             WHEN 'shorts' THEN 2 ELSE 3 END",
        )
        .bind(short.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter().map(export_from).collect()
    }

    async fn append_covers(
        &self,
        short: &ShortId,
        platform: Platform,
        keys: &[ObjectKey],
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        let stored: Option<String> = sqlx::query_scalar(
            "SELECT cover_keys FROM short_exports WHERE short_id = ? AND platform = ?",
        )
        .bind(short.as_str())
        .bind(platform.as_str())
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;
        let Some(stored) = stored else {
            return Ok(());
        };
        let mut all: Vec<String> = serde_json::from_str(&stored).map_err(bad_json)?;
        for k in keys {
            if !all.iter().any(|a| a == k.as_str()) {
                all.push(k.as_str().to_owned());
            }
        }
        sqlx::query("UPDATE short_exports SET cover_keys = ? WHERE short_id = ? AND platform = ?")
            .bind(serde_json::to_string(&all).map_err(bad_json)?)
            .bind(short.as_str())
            .bind(platform.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)
    }

    async fn update_render(
        &self,
        short: &ShortId,
        platforms: &[Platform],
        (status, key): (ExportStatus, Option<&ObjectKey>),
    ) -> Result<(), AppError> {
        for p in platforms {
            sqlx::query(
                "UPDATE short_exports SET status = ?, render_key = ? \
                 WHERE short_id = ? AND platform = ?",
            )
            .bind(status.as_str())
            .bind(key.map(ObjectKey::as_str))
            .bind(short.as_str())
            .bind(p.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        }
        Ok(())
    }
}

impl ExportStore for SqliteExportStore {
    fn queue_export<'a>(&'a self, export: &'a ShortExport) -> PortResult<'a, ()> {
        Box::pin(self.upsert(export))
    }

    fn exports<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Vec<ShortExport>> {
        Box::pin(self.read(short))
    }

    fn set_text<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        (caption, hashtags): (&'a str, &'a [String]),
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE short_exports SET caption = ?, hashtags = ? \
                 WHERE short_id = ? AND platform = ?",
            )
            .bind(caption)
            .bind(serde_json::to_string(hashtags).map_err(bad_json)?)
            .bind(short.as_str())
            .bind(platform.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }

    fn add_covers<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        keys: &'a [ObjectKey],
    ) -> PortResult<'a, ()> {
        Box::pin(self.append_covers(short, platform, keys))
    }

    fn set_cover_pick<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        pick: u32,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE short_exports SET cover_pick = ? WHERE short_id = ? AND platform = ?",
            )
            .bind(i64::from(pick))
            .bind(short.as_str())
            .bind(platform.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }

    fn set_render<'a>(
        &'a self,
        short: &'a ShortId,
        platforms: &'a [Platform],
        render: (ExportStatus, Option<&'a ObjectKey>),
    ) -> PortResult<'a, ()> {
        Box::pin(self.update_render(short, platforms, render))
    }

    fn fail_unfinished(&self) -> PortResult<'_, u64> {
        Box::pin(async move {
            let done = sqlx::query(
                "UPDATE short_exports SET status = 'failed' \
                 WHERE status IN ('queued', 'rendering') AND platform <> 'feed'",
            )
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(done.rows_affected())
        })
    }
}

#[cfg(test)]
mod tests;
