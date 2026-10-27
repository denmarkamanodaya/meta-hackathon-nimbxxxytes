//! Segment facts, turn texts per segment, and face tracks.

use nimbytes_core::AppError;
use nimbytes_core::domain::facts::SegmentFacts;
use nimbytes_core::domain::ids::{ClipId, SegmentId, TrackId};
use nimbytes_core::domain::segment::TrackRow;
use sqlx::{Row, Sqlite, Transaction};

use super::SqliteCatalogue;
use crate::sqlite::db_err;
use crate::sqlite::face_store::forget_clip_faces;

/// Stores a string list as a JSON array column.
pub(super) fn json_list(items: &[String]) -> String {
    serde_json::to_string(items).unwrap_or_else(|_| "[]".into())
}

impl SqliteCatalogue {
    pub(super) async fn update_facts(
        &self,
        id: &SegmentId,
        f: &SegmentFacts,
    ) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE segments SET description = ?, actions = ?, objects = ?, place = ?, mood = ?, \
             quality = ?, hook_score = ?, facts_status = ? WHERE id = ?",
        )
        .bind(&f.description)
        .bind(json_list(&f.actions))
        .bind(json_list(&f.objects))
        .bind(&f.place)
        .bind(&f.mood)
        .bind(f.quality)
        .bind(f.hook_score)
        .bind(f.status.as_str())
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    pub(super) async fn turn_texts(
        &self,
        id: &ClipId,
    ) -> Result<Vec<(SegmentId, Vec<String>)>, AppError> {
        let rows = sqlx::query(
            "SELECT s.id AS segment_id, t.text AS text FROM segments s \
             LEFT JOIN segment_turns st ON st.segment_id = s.id \
             LEFT JOIN transcript_turns t ON t.id = st.turn_id \
             WHERE s.clip_id = ? ORDER BY s.start_s, t.start_s",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        let mut out: Vec<(SegmentId, Vec<String>)> = Vec::new();
        for r in rows {
            let seg = SegmentId::parse(r.try_get::<String, _>("segment_id").map_err(db_err)?)?;
            let text: Option<String> = r.try_get("text").map_err(db_err)?;
            match out.last_mut() {
                Some((last, texts)) if *last == seg => texts.extend(text),
                _ => out.push((seg, text.into_iter().collect())),
            }
        }
        Ok(out)
    }

    pub(super) async fn upsert_tracks(
        &self,
        id: &ClipId,
        tracks: &[TrackRow],
        links: &[(TrackId, SegmentId)],
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        // New crops: the old vectors and verdicts no longer describe them.
        forget_clip_faces(&mut tx, id).await?;
        let keep: Vec<&str> = tracks.iter().map(|t| t.id.as_str()).collect();
        let existing: Vec<String> =
            sqlx::query_scalar("SELECT id FROM face_tracks WHERE clip_id = ?")
                .bind(id.as_str())
                .fetch_all(&mut *tx)
                .await
                .map_err(db_err)?;
        for gone in existing.iter().filter(|e| !keep.contains(&e.as_str())) {
            sqlx::query("DELETE FROM face_tracks WHERE id = ?")
                .bind(gone)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        for t in tracks {
            upsert_track(&mut tx, id, t).await?;
        }
        sqlx::query("DELETE FROM track_segments WHERE track_id IN (SELECT id FROM face_tracks WHERE clip_id = ?)")
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        for (track, segment) in links {
            sqlx::query("INSERT INTO track_segments (track_id, segment_id) VALUES (?, ?)")
                .bind(track.as_str())
                .bind(segment.as_str())
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }
}

/// Inserts a track or updates its geometry and crop, leaving `person_id` and `hidden` as the user
/// set them.
async fn upsert_track(
    tx: &mut Transaction<'_, Sqlite>,
    clip: &ClipId,
    t: &TrackRow,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO face_tracks (id, clip_id, ordinal, first_s, last_s, crop_key, max_area) \
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET ordinal = excluded.ordinal, \
         first_s = excluded.first_s, last_s = excluded.last_s, crop_key = excluded.crop_key, \
         max_area = excluded.max_area",
    )
    .bind(t.id.as_str())
    .bind(clip.as_str())
    .bind(t.ordinal)
    .bind(t.first_s)
    .bind(t.last_s)
    .bind(&t.crop_key)
    .bind(t.max_area)
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(())
}
