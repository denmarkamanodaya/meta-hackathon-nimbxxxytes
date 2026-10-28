//! [`SubjectStore`] on SQLite: `users.blur_objects`, `short_reframes` (upserted per short,
//! version and moment), `object_tracks` and the sqlite-vec `object_vectors` table, plus KNN over
//! `face_vectors` for Find this.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ClipId, SegmentId, ShortId, UserId};
use nimbytes_core::domain::objects::FindMatch;
use nimbytes_core::domain::reframe::{CropKey, ShotReframe};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::{ObjectTrack, PortResult, SubjectStore};
use sqlx::{Row, SqlitePool};

use super::db_err;
use super::vectors::blob;

/// Subject rows in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteSubjectStore {
    pool: SqlitePool,
}

/// `short_id, version_n, segment_id, subject, crop_path, frames_tracked, frames_total, lost_s,
/// updated_at` of a `short_reframes` row.
type ReframeRow = (String, i64, String, String, String, i64, i64, f64, String);

fn bad_json(e: serde_json::Error) -> AppError {
    AppError::new(
        nimbytes_core::ErrorCode::Internal,
        format!("crop_path: {e}"),
    )
}

fn count(v: i64) -> u32 {
    u32::try_from(v).unwrap_or(0)
}

impl SqliteSubjectStore {
    /// Wraps a migrated pool (sqlite-vec registered).
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn read_reframes(&self, short: &ShortId) -> Result<Vec<ShotReframe>, AppError> {
        let rows: Vec<ReframeRow> = sqlx::query_as(
            "SELECT short_id, version_n, segment_id, subject, crop_path, frames_tracked, \
             frames_total, lost_s, updated_at FROM short_reframes WHERE short_id = ? \
             ORDER BY version_n, segment_id",
        )
        .bind(short.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.into_iter()
            .map(|(s, n, seg, subject, path, tracked, total, lost_s, at)| {
                let crop_path: Vec<CropKey> = serde_json::from_str(&path).map_err(bad_json)?;
                Ok(ShotReframe {
                    short_id: ShortId::parse(s)?,
                    version_n: count(n),
                    segment_id: SegmentId::parse(seg)?,
                    subject,
                    crop_path,
                    frames_tracked: count(tracked),
                    frames_total: count(total),
                    lost_s,
                    updated_at: at,
                })
            })
            .collect()
    }

    async fn write_reframe(&self, r: &ShotReframe) -> Result<(), AppError> {
        let path = serde_json::to_string(&r.crop_path).map_err(bad_json)?;
        sqlx::query(
            "INSERT INTO short_reframes (short_id, version_n, segment_id, subject, crop_path, \
             frames_tracked, frames_total, lost_s, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (short_id, version_n, segment_id) DO UPDATE SET \
             subject = excluded.subject, crop_path = excluded.crop_path, \
             frames_tracked = excluded.frames_tracked, frames_total = excluded.frames_total, \
             lost_s = excluded.lost_s, updated_at = excluded.updated_at",
        )
        .bind(r.short_id.as_str())
        .bind(i64::from(r.version_n))
        .bind(r.segment_id.as_str())
        .bind(&r.subject)
        .bind(path)
        .bind(i64::from(r.frames_tracked))
        .bind(i64::from(r.frames_total))
        .bind(r.lost_s)
        .bind(&r.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn write_object(&self, t: &ObjectTrack, vector: &[f32]) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query(
            "INSERT INTO object_tracks (id, clip_id, user_id, label, t_s, start_s, end_s, \
             created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET \
             label = excluded.label, t_s = excluded.t_s, start_s = excluded.start_s, \
             end_s = excluded.end_s",
        )
        .bind(&t.id)
        .bind(t.clip_id.as_str())
        .bind(t.user_id.as_str())
        .bind(&t.label)
        .bind(t.t_s)
        .bind(t.start_s)
        .bind(t.end_s)
        .bind(&t.created_at)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        // vec0 tables have no upsert, so replace inside the same transaction.
        sqlx::query("DELETE FROM object_vectors WHERE track_id = ?")
            .bind(&t.id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        sqlx::query("INSERT INTO object_vectors (track_id, user_id, embedding) VALUES (?, ?, ?)")
            .bind(&t.id)
            .bind(t.user_id.as_str())
            .bind(blob(vector))
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)
    }

    /// KNN over a vec0 table joined to its tracks: `sql` selects `clip_id, start_s, end_s,
    /// distance` from a `knn` CTE bound to (vector, k, user).
    async fn nearest(
        &self,
        sql: &'static str,
        (user, vector, k): (&UserId, &[f32], u32),
    ) -> Result<Vec<FindMatch>, AppError> {
        let rows = sqlx::query(sql)
            .bind(blob(vector))
            .bind(k)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                let clip: String = r.try_get(0).map_err(db_err)?;
                let distance: f64 = r.try_get(3).map_err(db_err)?;
                Ok(FindMatch {
                    clip_id: ClipId::parse(clip)?,
                    segment_id: None,
                    span: Span {
                        start_s: r.try_get(1).map_err(db_err)?,
                        end_s: r.try_get(2).map_err(db_err)?,
                    },
                    score: (1.0 - distance).clamp(0.0, 1.0),
                })
            })
            .collect()
    }
}

const NEAREST_OBJECTS: &str = "WITH knn AS (SELECT track_id, distance FROM object_vectors \
     WHERE embedding MATCH ? AND k = ? AND user_id = ?) \
     SELECT o.clip_id, o.start_s, o.end_s, knn.distance FROM knn \
     JOIN object_tracks o ON o.id = knn.track_id \
     JOIN clips c ON c.id = o.clip_id AND c.status != 'duplicate' \
     ORDER BY knn.distance";

const NEAREST_FACES: &str = "WITH knn AS (SELECT track_id, distance FROM face_vectors \
     WHERE embedding MATCH ? AND k = ? AND user_id = ?) \
     SELECT t.clip_id, t.first_s, t.last_s + 1.0, knn.distance FROM knn \
     JOIN face_tracks t ON t.id = knn.track_id AND t.hidden = 0 \
     JOIN clips c ON c.id = t.clip_id AND c.status != 'duplicate' \
     ORDER BY knn.distance";

impl SubjectStore for SqliteSubjectStore {
    fn blur_objects<'a>(&'a self, user: &'a UserId) -> PortResult<'a, bool> {
        Box::pin(async move {
            let on: Option<bool> =
                sqlx::query_scalar("SELECT blur_objects FROM users WHERE id = ?")
                    .bind(user.as_str())
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(db_err)?;
            Ok(on.unwrap_or(false))
        })
    }

    fn set_blur_objects<'a>(&'a self, user: &'a UserId, on: bool) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("UPDATE users SET blur_objects = ? WHERE id = ?")
                .bind(on)
                .bind(user.as_str())
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        })
    }

    fn reframes<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Vec<ShotReframe>> {
        Box::pin(self.read_reframes(short))
    }

    fn put_reframe<'a>(&'a self, row: &'a ShotReframe) -> PortResult<'a, ()> {
        Box::pin(self.write_reframe(row))
    }

    fn put_object<'a>(&'a self, track: &'a ObjectTrack, vector: &'a [f32]) -> PortResult<'a, ()> {
        Box::pin(self.write_object(track, vector))
    }

    fn nearest_objects<'a>(
        &'a self,
        user: &'a UserId,
        vector: &'a [f32],
        k: u32,
    ) -> PortResult<'a, Vec<FindMatch>> {
        Box::pin(self.nearest(NEAREST_OBJECTS, (user, vector, k)))
    }

    fn nearest_faces<'a>(
        &'a self,
        user: &'a UserId,
        vector: &'a [f32],
        k: u32,
    ) -> PortResult<'a, Vec<FindMatch>> {
        Box::pin(self.nearest(NEAREST_FACES, (user, vector, k)))
    }
}

#[cfg(test)]
mod tests;
