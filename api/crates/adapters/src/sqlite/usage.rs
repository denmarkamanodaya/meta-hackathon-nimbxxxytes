//! [`UsageStore`] on SQLite: `storage_usage` (one measurement per account) and the `uploads`
//! rows the cap still reserves.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::UserId;
use nimbytes_core::domain::storage_cap::PendingUpload;
use nimbytes_core::ports::{EpochMillis, MeasuredUsage, PortResult, UsageStore};
use nimbytes_core::time::{format_utc, parse_utc};
use sqlx::SqlitePool;

use super::{db_err, to_i64, to_u64};

/// Measurements on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteUsageStore {
    pool: SqlitePool,
}

/// A stored time that cannot be read counts as "just now and still open", so an upload is never
/// left out of the reservations by a bad row.
fn stored_time(text: &str) -> EpochMillis {
    parse_utc(text).unwrap_or(EpochMillis::MAX)
}

impl SqliteUsageStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn read(&self, user: &UserId) -> Result<Option<MeasuredUsage>, AppError> {
        let row: Option<(i64, String)> =
            sqlx::query_as("SELECT used_bytes, measured_at FROM storage_usage WHERE user_id = ?")
                .bind(user.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(db_err)?;
        row.map(|(bytes, at)| {
            Ok(MeasuredUsage {
                bytes: to_u64(bytes, "used_bytes")?,
                // An unreadable stamp counts as the oldest possible, so every upload stays held.
                measured_at: parse_utc(&at).unwrap_or(0),
            })
        })
        .transpose()
    }

    async fn write(&self, user: &UserId, usage: MeasuredUsage) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO storage_usage (user_id, used_bytes, measured_at) VALUES (?, ?, ?) \
             ON CONFLICT (user_id) DO UPDATE SET used_bytes = excluded.used_bytes, \
             measured_at = excluded.measured_at",
        )
        .bind(user.as_str())
        .bind(to_i64(usage.bytes, "used_bytes")?)
        .bind(format_utc(usage.measured_at))
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn pending(
        &self,
        user: &UserId,
        since: EpochMillis,
    ) -> Result<Vec<PendingUpload>, AppError> {
        let rows: Vec<(i64, String, String)> = sqlx::query_as(
            "SELECT size_bytes, created_at, status FROM uploads \
             WHERE user_id = ? AND (status = 'open' OR created_at >= ?)",
        )
        .bind(user.as_str())
        .bind(format_utc(since))
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.into_iter()
            .map(|(size, created_at, status)| {
                Ok(PendingUpload {
                    size_bytes: to_u64(size, "size_bytes")?,
                    created_at: stored_time(&created_at),
                    open: status == "open",
                })
            })
            .collect()
    }

    async fn users(&self) -> Result<Vec<UserId>, AppError> {
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM users ORDER BY created_at, id")
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        ids.into_iter().map(UserId::parse).collect()
    }
}

impl UsageStore for SqliteUsageStore {
    fn measured<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<MeasuredUsage>> {
        Box::pin(self.read(user))
    }

    fn record_measured<'a>(&'a self, user: &'a UserId, usage: MeasuredUsage) -> PortResult<'a, ()> {
        Box::pin(self.write(user, usage))
    }

    fn pending_uploads<'a>(
        &'a self,
        user: &'a UserId,
        since: EpochMillis,
    ) -> PortResult<'a, Vec<PendingUpload>> {
        Box::pin(self.pending(user, since))
    }

    fn accounts(&self) -> PortResult<'_, Vec<UserId>> {
        Box::pin(self.users())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn seed(pool: &SqlitePool) {
        for sql in [
            "INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1', '2026-10-01T00:00:00.000Z')",
            "INSERT INTO users (id, email, created_at) VALUES ('u2', 'u2', '2026-10-02T00:00:00.000Z')",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
        let uploads = [
            ("a", "u1", 100, "open", "2026-10-27T01:00:00.000Z"),
            ("b", "u1", 200, "completed", "2026-10-27T02:00:00.000Z"),
            ("c", "u1", 400, "completed", "2026-10-27T00:00:00.000Z"),
            ("d", "u2", 800, "open", "2026-10-27T01:00:00.000Z"),
        ];
        for row in uploads {
            add_upload(pool, row).await;
        }
    }

    /// A clip and its upload row: id (both), user, size, upload status, start time.
    async fn add_upload(
        pool: &SqlitePool,
        (id, user, size, status, at): (&str, &str, i64, &str, &str),
    ) {
        sqlx::query(
            "INSERT INTO clips (id, user_id, filename, ext, size_bytes, status, created_at) \
             VALUES (?, ?, 'a.mp4', 'mp4', ?, 'uploading', ?)",
        )
        .bind(id)
        .bind(user)
        .bind(size)
        .bind(at)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO uploads (id, user_id, clip_id, s3_upload_id, key, size_bytes, \
             part_size, status, created_at) VALUES (?, ?, ?, 's3', 'k', ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(user)
        .bind(id)
        .bind(size)
        .bind(size)
        .bind(status)
        .bind(at)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_measurement_is_kept_and_replaced_per_account() {
        let pool = test_pool().await;
        seed(&pool).await;
        let store = SqliteUsageStore::new(pool);
        let u1 = UserId::parse("u1").unwrap();
        assert_eq!(store.measured(&u1).await.unwrap(), None);

        let first = MeasuredUsage {
            bytes: 5,
            measured_at: 1_793_059_200_000,
        };
        store.record_measured(&u1, first).await.unwrap();
        let second = MeasuredUsage {
            bytes: 9,
            measured_at: 1_793_059_260_000,
        };
        store.record_measured(&u1, second).await.unwrap();

        assert_eq!(store.measured(&u1).await.unwrap(), Some(second));
        let u2 = UserId::parse("u2").unwrap();
        assert_eq!(store.measured(&u2).await.unwrap(), None);
        assert_eq!(store.accounts().await.unwrap(), [u1, u2]);
    }

    #[tokio::test]
    async fn pending_uploads_are_the_open_ones_and_those_completed_since() {
        let pool = test_pool().await;
        seed(&pool).await;
        let store = SqliteUsageStore::new(pool);
        let since = parse_utc("2026-10-27T01:30:00.000Z").unwrap();

        let mut got = store
            .pending_uploads(&UserId::parse("u1").unwrap(), since)
            .await
            .unwrap();
        got.sort_by_key(|u| u.size_bytes);

        assert_eq!(
            got,
            [
                PendingUpload {
                    size_bytes: 100,
                    created_at: parse_utc("2026-10-27T01:00:00.000Z").unwrap(),
                    open: true,
                },
                PendingUpload {
                    size_bytes: 200,
                    created_at: parse_utc("2026-10-27T02:00:00.000Z").unwrap(),
                    open: false,
                },
            ]
        );
    }
}
