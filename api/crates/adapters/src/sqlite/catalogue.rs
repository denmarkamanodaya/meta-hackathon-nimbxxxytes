//! [`Catalogue`] on SQLite: users, clips and uploads.

use nimbytes_core::AppError;
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::upload::{Upload, UploadStatus, plan_with_part_size};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{Catalogue, PortResult};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::{db_err, to_i64, to_u64};

/// Catalogue backed by the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteCatalogue {
    pool: SqlitePool,
}

impl SqliteCatalogue {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert_upload_tx(&self, clip: &Clip, upload: &Upload) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query(
            "INSERT INTO clips (id, user_id, filename, ext, size_bytes, status, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(clip.id.as_str())
        .bind(clip.user_id.as_str())
        .bind(&clip.filename)
        .bind(clip.ext.as_str())
        .bind(to_i64(clip.size_bytes, "size_bytes")?)
        .bind(clip.status.as_str())
        .bind(&clip.created_at)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        sqlx::query(
            "INSERT INTO uploads (id, user_id, clip_id, s3_upload_id, key, size_bytes, part_size, \
             status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(upload.id.as_str())
        .bind(upload.user_id.as_str())
        .bind(upload.clip_id.as_str())
        .bind(&upload.s3_upload_id)
        .bind(upload.key.as_str())
        .bind(to_i64(upload.size_bytes, "size_bytes")?)
        .bind(to_i64(upload.plan.part_size, "part_size")?)
        .bind(upload.status.as_str())
        .bind(&upload.created_at)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        tx.commit().await.map_err(db_err)
    }

    async fn finish_upload_tx(&self, upload: &UploadId, clip: &ClipId) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query("UPDATE uploads SET status = 'completed' WHERE id = ?")
            .bind(upload.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        sqlx::query("UPDATE clips SET status = 'uploaded' WHERE id = ? AND status = 'uploading'")
            .bind(clip.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)
    }
}

impl Catalogue for SqliteCatalogue {
    fn demo_user<'a>(&'a self, new_id: &'a UserId, now: &'a str) -> PortResult<'a, UserId> {
        Box::pin(async move {
            // One statement, so two first sign-ins at once still create a single demo row.
            sqlx::query(
                "INSERT INTO users (id, created_at) SELECT ?, ? \
                 WHERE NOT EXISTS (SELECT 1 FROM users)",
            )
            .bind(new_id.as_str())
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            let id: String = sqlx::query_scalar("SELECT id FROM users ORDER BY created_at, id")
                .fetch_one(&self.pool)
                .await
                .map_err(db_err)?;
            UserId::parse(id)
        })
    }

    fn insert_upload<'a>(&'a self, clip: &'a Clip, upload: &'a Upload) -> PortResult<'a, ()> {
        Box::pin(self.insert_upload_tx(clip, upload))
    }

    fn get_upload<'a>(&'a self, id: &'a UploadId) -> PortResult<'a, Option<Upload>> {
        Box::pin(async move {
            let row = sqlx::query("SELECT * FROM uploads WHERE id = ?")
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(db_err)?;
            row.as_ref().map(upload_from_row).transpose()
        })
    }

    fn finish_upload<'a>(&'a self, upload: &'a UploadId, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(self.finish_upload_tx(upload, clip))
    }

    fn list_clips<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Clip>> {
        Box::pin(async move {
            let rows = sqlx::query(
                "SELECT * FROM clips WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            )
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
            rows.iter().map(clip_from_row).collect()
        })
    }
}

fn upload_from_row(row: &SqliteRow) -> Result<Upload, AppError> {
    let size_bytes = to_u64(row.try_get("size_bytes").map_err(db_err)?, "size_bytes")?;
    let part_size = to_u64(row.try_get("part_size").map_err(db_err)?, "part_size")?;
    Ok(Upload {
        id: UploadId::parse(row.try_get::<String, _>("id").map_err(db_err)?)?,
        user_id: UserId::parse(row.try_get::<String, _>("user_id").map_err(db_err)?)?,
        clip_id: ClipId::parse(row.try_get::<String, _>("clip_id").map_err(db_err)?)?,
        s3_upload_id: row.try_get("s3_upload_id").map_err(db_err)?,
        key: ObjectKey::from_stored(row.try_get("key").map_err(db_err)?),
        size_bytes,
        plan: plan_with_part_size(size_bytes, part_size)?,
        status: UploadStatus::parse(row.try_get("status").map_err(db_err)?)?,
        created_at: row.try_get("created_at").map_err(db_err)?,
    })
}

fn clip_from_row(row: &SqliteRow) -> Result<Clip, AppError> {
    Ok(Clip {
        id: ClipId::parse(row.try_get::<String, _>("id").map_err(db_err)?)?,
        user_id: UserId::parse(row.try_get::<String, _>("user_id").map_err(db_err)?)?,
        filename: row.try_get("filename").map_err(db_err)?,
        ext: MediaExt::parse(row.try_get("ext").map_err(db_err)?)?,
        size_bytes: to_u64(row.try_get("size_bytes").map_err(db_err)?, "size_bytes")?,
        status: ClipStatus::parse(row.try_get("status").map_err(db_err)?)?,
        duration_s: row.try_get("duration_s").map_err(db_err)?,
        recorded_at: row.try_get("recorded_at").map_err(db_err)?,
        created_at: row.try_get("created_at").map_err(db_err)?,
    })
}

#[cfg(test)]
mod tests {
    use nimbytes_core::domain::upload::plan_parts;
    use nimbytes_core::keys;

    use super::*;
    use crate::sqlite::test_pool;

    fn rows(user: &UserId, n: u32, created_at: &str) -> (Clip, Upload) {
        let clip_id = ClipId::parse(format!("c{n}")).unwrap();
        let upload = Upload {
            id: UploadId::parse(format!("up{n}")).unwrap(),
            user_id: user.clone(),
            clip_id: clip_id.clone(),
            s3_upload_id: format!("s3-{n}"),
            key: keys::original(user, &clip_id, MediaExt::Mp4),
            size_bytes: 20_000_000,
            plan: plan_parts(20_000_000).unwrap(),
            status: UploadStatus::Open,
            created_at: created_at.into(),
        };
        let clip = Clip {
            id: clip_id,
            user_id: user.clone(),
            filename: format!("clip{n}.mp4"),
            ext: MediaExt::Mp4,
            size_bytes: 20_000_000,
            status: ClipStatus::Uploading,
            duration_s: None,
            recorded_at: None,
            created_at: created_at.into(),
        };
        (clip, upload)
    }

    async fn demo(cat: &SqliteCatalogue) -> UserId {
        cat.demo_user(&UserId::parse("u1").unwrap(), "2026-10-27T00:00:00.000Z")
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn demo_user_is_created_once() {
        let cat = SqliteCatalogue::new(test_pool().await);
        let first = demo(&cat).await;
        let again = cat
            .demo_user(&UserId::parse("u2").unwrap(), "2026-10-28T00:00:00.000Z")
            .await
            .unwrap();
        assert_eq!(first.as_str(), "u1");
        assert_eq!(again, first);
    }

    #[tokio::test]
    async fn upload_round_trips_and_finishing_marks_the_clip_uploaded() {
        let cat = SqliteCatalogue::new(test_pool().await);
        let user = demo(&cat).await;
        let (clip, upload) = rows(&user, 1, "2026-10-27T01:00:00.000Z");
        cat.insert_upload(&clip, &upload).await.unwrap();

        assert_eq!(
            cat.get_upload(&upload.id).await.unwrap(),
            Some(upload.clone())
        );
        cat.finish_upload(&upload.id, &clip.id).await.unwrap();

        let stored = cat.get_upload(&upload.id).await.unwrap().unwrap();
        assert_eq!(stored.status, UploadStatus::Completed);
        assert_eq!(
            cat.list_clips(&user).await.unwrap()[0].status,
            ClipStatus::Uploaded
        );
    }

    #[tokio::test]
    async fn list_clips_is_newest_first_and_only_the_users_own() {
        let cat = SqliteCatalogue::new(test_pool().await);
        let user = demo(&cat).await;
        for (n, at) in [
            (1, "2026-10-27T01:00:00.000Z"),
            (2, "2026-10-27T02:00:00.000Z"),
        ] {
            let (clip, upload) = rows(&user, n, at);
            cat.insert_upload(&clip, &upload).await.unwrap();
        }
        let ids: Vec<String> = cat
            .list_clips(&user)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.id.to_string())
            .collect();
        assert_eq!(ids, ["c2", "c1"]);
        assert!(
            cat.list_clips(&UserId::parse("other").unwrap())
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn unknown_upload_is_none() {
        let cat = SqliteCatalogue::new(test_pool().await);
        assert_eq!(
            cat.get_upload(&UploadId::parse("x").unwrap())
                .await
                .unwrap(),
            None
        );
    }
}
