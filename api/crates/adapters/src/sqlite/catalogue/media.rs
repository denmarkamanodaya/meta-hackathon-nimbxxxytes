//! Probe facts, clip status, segments and transcripts.

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::segment::{Segment, TranscriptRows};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::{AppError, ErrorCode};
use sqlx::{Row, Sqlite, Transaction};

use super::SqliteCatalogue;
use crate::sqlite::db_err;

/// `UPPER_SNAKE` text of an error code, as stored in `clips.error_code`.
fn code_text(code: ErrorCode) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| format!("{code:?}"))
}

impl SqliteCatalogue {
    pub(super) async fn update_probe(&self, id: &ClipId, p: &ProbeInfo) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE clips SET duration_s = ?, width = ?, height = ?, fps = ?, rotation = ?, \
             codec = ?, recorded_at = ?, has_audio = ? WHERE id = ?",
        )
        .bind(p.duration_s)
        .bind(p.width)
        .bind(p.height)
        .bind(p.fps)
        .bind(p.rotation)
        .bind(&p.codec)
        .bind(&p.recorded_at)
        .bind(p.has_audio)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    pub(super) async fn update_status(
        &self,
        id: &ClipId,
        status: ClipStatus,
        error: Option<ErrorCode>,
    ) -> Result<(), AppError> {
        sqlx::query("UPDATE clips SET status = ?, error_code = ? WHERE id = ?")
            .bind(status.as_str())
            .bind(error.map(code_text))
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    pub(super) async fn replace_segments_tx(
        &self,
        id: &ClipId,
        segments: &[Segment],
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query("DELETE FROM segments WHERE clip_id = ?")
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        for s in segments {
            sqlx::query(
                "INSERT INTO segments (id, clip_id, idx, start_s, end_s) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(s.id.as_str())
            .bind(id.as_str())
            .bind(s.idx)
            .bind(s.span.start_s)
            .bind(s.span.end_s)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }

    pub(super) async fn segment_rows(&self, id: &ClipId) -> Result<Vec<Segment>, AppError> {
        let rows = sqlx::query(
            "SELECT id, idx, start_s, end_s FROM segments WHERE clip_id = ? ORDER BY start_s",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(Segment {
                    id: SegmentId::parse(r.try_get::<String, _>("id").map_err(db_err)?)?,
                    clip_id: id.clone(),
                    idx: r.try_get("idx").map_err(db_err)?,
                    span: Span {
                        start_s: r.try_get("start_s").map_err(db_err)?,
                        end_s: r.try_get("end_s").map_err(db_err)?,
                    },
                })
            })
            .collect()
    }

    pub(super) async fn replace_transcript_tx(
        &self,
        id: &ClipId,
        rows: &TranscriptRows,
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        // Links and turns cascade from turns/speakers; delete turns before speakers they point to.
        for sql in [
            "DELETE FROM transcript_turns WHERE clip_id = ?",
            "DELETE FROM speakers WHERE clip_id = ?",
        ] {
            sqlx::query(sql)
                .bind(id.as_str())
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        insert_transcript(&mut tx, id, rows).await?;
        tx.commit().await.map_err(db_err)
    }
}

async fn insert_transcript(
    tx: &mut Transaction<'_, Sqlite>,
    id: &ClipId,
    rows: &TranscriptRows,
) -> Result<(), AppError> {
    for s in &rows.speakers {
        sqlx::query("INSERT INTO speakers (id, clip_id, label) VALUES (?, ?, ?)")
            .bind(s.id.as_str())
            .bind(id.as_str())
            .bind(&s.label)
            .execute(&mut **tx)
            .await
            .map_err(db_err)?;
    }
    for t in &rows.turns {
        sqlx::query(
            "INSERT INTO transcript_turns (id, clip_id, turn_no, start_s, end_s, text, speaker_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(t.id.as_str())
        .bind(id.as_str())
        .bind(t.turn.turn_no)
        .bind(t.turn.span.start_s)
        .bind(t.turn.span.end_s)
        .bind(&t.turn.text)
        .bind(t.speaker_id.as_ref().map(|s| s.as_str()))
        .execute(&mut **tx)
        .await
        .map_err(db_err)?;
    }
    for (segment, turn) in &rows.links {
        sqlx::query("INSERT INTO segment_turns (segment_id, turn_id) VALUES (?, ?)")
            .bind(segment.as_str())
            .bind(turn.as_str())
            .execute(&mut **tx)
            .await
            .map_err(db_err)?;
    }
    Ok(())
}
