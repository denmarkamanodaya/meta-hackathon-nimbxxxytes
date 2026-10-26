//! Users, clips and uploads.

use nimbytes_core::AppError;
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::upload::{Upload, UploadStatus, plan_with_part_size};
use nimbytes_core::keys::ObjectKey;
use sqlx::Row;
use sqlx::sqlite::SqliteRow;

use super::SqliteCatalogue;
use crate::sqlite::{db_err, to_i64, to_u64};

impl SqliteCatalogue {
    pub(super) async fn demo_user_row(
        &self,
        new_id: &UserId,
        now: &str,
    ) -> Result<UserId, AppError> {
        // One statement, so two first sign-ins at once still create a single demo row.
        sqlx::query(
            "INSERT INTO users (id, created_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)",
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
    }

    pub(super) async fn insert_upload_tx(
        &self,
        clip: &Clip,
        upload: &Upload,
    ) -> Result<(), AppError> {
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

    pub(super) async fn finish_upload_tx(
        &self,
        upload: &UploadId,
        clip: &ClipId,
    ) -> Result<(), AppError> {
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

    pub(super) async fn upload_row(&self, id: &UploadId) -> Result<Option<Upload>, AppError> {
        let row = sqlx::query("SELECT * FROM uploads WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(upload_from_row).transpose()
    }

    pub(super) async fn clip_rows(&self, user: &UserId) -> Result<Vec<Clip>, AppError> {
        let rows =
            sqlx::query("SELECT * FROM clips WHERE user_id = ? ORDER BY created_at DESC, id DESC")
                .bind(user.as_str())
                .fetch_all(&self.pool)
                .await
                .map_err(db_err)?;
        rows.iter().map(clip_from_row).collect()
    }

    pub(super) async fn clip_row(&self, id: &ClipId) -> Result<Option<Clip>, AppError> {
        let row = sqlx::query("SELECT * FROM clips WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(clip_from_row).transpose()
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

pub(super) fn clip_from_row(row: &SqliteRow) -> Result<Clip, AppError> {
    Ok(Clip {
        id: ClipId::parse(row.try_get::<String, _>("id").map_err(db_err)?)?,
        user_id: UserId::parse(row.try_get::<String, _>("user_id").map_err(db_err)?)?,
        filename: row.try_get("filename").map_err(db_err)?,
        ext: MediaExt::parse(row.try_get("ext").map_err(db_err)?)?,
        size_bytes: to_u64(row.try_get("size_bytes").map_err(db_err)?, "size_bytes")?,
        status: ClipStatus::parse(row.try_get("status").map_err(db_err)?)?,
        probe: probe_from_row(row)?,
        created_at: row.try_get("created_at").map_err(db_err)?,
    })
}

/// Probe columns are all set together by the probe step; `has_audio` marks that it ran.
fn probe_from_row(row: &SqliteRow) -> Result<Option<ProbeInfo>, AppError> {
    let Some(has_audio) = row
        .try_get::<Option<bool>, _>("has_audio")
        .map_err(db_err)?
    else {
        return Ok(None);
    };
    let get_u32 = |col: &str| -> Result<u32, AppError> {
        let v: i64 = row.try_get(col).map_err(db_err)?;
        u32::try_from(v)
            .map_err(|_| AppError::new(nimbytes_core::ErrorCode::Internal, format!("bad {col}")))
    };
    Ok(Some(ProbeInfo {
        duration_s: row.try_get("duration_s").map_err(db_err)?,
        width: get_u32("width")?,
        height: get_u32("height")?,
        fps: row.try_get("fps").map_err(db_err)?,
        rotation: row.try_get("rotation").map_err(db_err)?,
        codec: row.try_get("codec").map_err(db_err)?,
        recorded_at: row.try_get("recorded_at").map_err(db_err)?,
        has_audio,
    }))
}
