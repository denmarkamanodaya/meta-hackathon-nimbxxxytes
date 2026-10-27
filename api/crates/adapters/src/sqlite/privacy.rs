//! [`PrivacyStore`] on SQLite: `face_boxes` (one row per track and second) and `short_finish`.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ClipId, SegmentId, ShortId, TrackId};
use nimbytes_core::domain::privacy::{Effect, FaceBox, HiddenBoxes, ShortFinish};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::{PortResult, PrivacyStore};
use sqlx::SqlitePool;

use super::db_err;

/// Face boxes and finishes on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqlitePrivacyStore {
    pool: SqlitePool,
}

/// `segment_id, start_s, end_s, track_id, width, height, t_s, x, y, w, h` of one hidden box.
type BoxRow = (
    String,
    f64,
    f64,
    String,
    Option<i64>,
    Option<i64>,
    f64,
    f64,
    f64,
    f64,
    f64,
);

/// `blur_bystanders, title_text, speaker_colors, effect` of a `short_finish` row.
type FinishRow = (bool, Option<String>, bool, String);

impl SqlitePrivacyStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn write_boxes(
        &self,
        clip: &ClipId,
        boxes: &[(TrackId, Vec<FaceBox>)],
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query(
            "DELETE FROM face_boxes WHERE track_id IN (SELECT id FROM face_tracks WHERE clip_id = ?)",
        )
        .bind(clip.as_str())
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        for (track, list) in boxes {
            for b in list {
                sqlx::query(
                    "INSERT OR REPLACE INTO face_boxes (track_id, t_s, x, y, w, h) \
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(track.as_str())
                .bind(b.t_s)
                .bind(b.x)
                .bind(b.y)
                .bind(b.w)
                .bind(b.h)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            }
        }
        tx.commit().await.map_err(db_err)
    }

    async fn read_hidden(&self, segments: &[SegmentId]) -> Result<Vec<HiddenBoxes>, AppError> {
        if segments.is_empty() {
            return Ok(Vec::new());
        }
        // Only `?` placeholders are formatted in; every id is bound.
        let marks = vec!["?"; segments.len()].join(", ");
        let sql = format!(
            "SELECT ts.segment_id, s.start_s, s.end_s, t.id, c.width, c.height, b.t_s, b.x, b.y, b.w, b.h \
             FROM track_segments ts \
             JOIN face_tracks t ON t.id = ts.track_id AND t.hidden = 1 \
             JOIN segments s ON s.id = ts.segment_id \
             JOIN clips c ON c.id = s.clip_id \
             JOIN face_boxes b ON b.track_id = t.id \
             WHERE ts.segment_id IN ({marks}) ORDER BY ts.segment_id, t.id, b.t_s"
        );
        let mut q = sqlx::query_as::<_, BoxRow>(sqlx::AssertSqlSafe(sql));
        for s in segments {
            q = q.bind(s.as_str());
        }
        let rows = q.fetch_all(&self.pool).await.map_err(db_err)?;
        group(rows)
    }
}

/// Width / height of a probed clip (stored sizes are as displayed, rotation applied).
fn aspect(width: Option<i64>, height: Option<i64>) -> Option<f64> {
    match (
        width.and_then(|w| u32::try_from(w).ok()),
        height.and_then(|h| u32::try_from(h).ok()),
    ) {
        (Some(w), Some(h)) if w > 0 && h > 0 => Some(f64::from(w) / f64::from(h)),
        _ => None,
    }
}

/// Consecutive rows of one segment and track become one entry.
fn group(rows: Vec<BoxRow>) -> Result<Vec<HiddenBoxes>, AppError> {
    let mut out: Vec<HiddenBoxes> = Vec::new();
    for (segment, start_s, end_s, track, width, height, t_s, x, y, w, h) in rows {
        let b = FaceBox { t_s, x, y, w, h };
        match out.last_mut() {
            Some(last)
                if last.segment_id.as_str() == segment && last.track_id.as_str() == track =>
            {
                last.boxes.push(b);
            }
            _ => out.push(HiddenBoxes {
                segment_id: SegmentId::parse(segment)?,
                span: Span { start_s, end_s },
                track_id: TrackId::parse(track)?,
                aspect: aspect(width, height),
                boxes: vec![b],
            }),
        }
    }
    Ok(out)
}

impl PrivacyStore for SqlitePrivacyStore {
    fn replace_boxes<'a>(
        &'a self,
        clip: &'a ClipId,
        boxes: &'a [(TrackId, Vec<FaceBox>)],
    ) -> PortResult<'a, ()> {
        Box::pin(self.write_boxes(clip, boxes))
    }

    fn hidden_boxes<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, Vec<HiddenBoxes>> {
        Box::pin(self.read_hidden(segments))
    }

    fn finish<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<ShortFinish>> {
        Box::pin(async move {
            let row: Option<FinishRow> = sqlx::query_as(
                "SELECT blur_bystanders, title_text, speaker_colors, effect FROM short_finish \
                 WHERE short_id = ?",
            )
            .bind(short.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
            row.map(|(blur_bystanders, title_text, speaker_colors, effect)| {
                Ok(ShortFinish {
                    blur_bystanders,
                    title_text,
                    speaker_colors,
                    effect: Effect::parse(&effect)?,
                })
            })
            .transpose()
        })
    }

    fn put_finish<'a>(&'a self, short: &'a ShortId, f: &'a ShortFinish) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "INSERT INTO short_finish (short_id, blur_bystanders, title_text, speaker_colors, \
                 effect) VALUES (?, ?, ?, ?, ?) ON CONFLICT (short_id) DO UPDATE SET \
                 blur_bystanders = excluded.blur_bystanders, title_text = excluded.title_text, \
                 speaker_colors = excluded.speaker_colors, effect = excluded.effect",
            )
            .bind(short.as_str())
            .bind(f.blur_bystanders)
            .bind(&f.title_text)
            .bind(f.speaker_colors)
            .bind(f.effect.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }

    fn production_blur<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<bool>> {
        Box::pin(async move {
            sqlx::query_scalar("SELECT blur_bystanders FROM productions WHERE short_id = ? LIMIT 1")
                .bind(short.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(db_err)
        })
    }
}

#[cfg(test)]
mod tests;
