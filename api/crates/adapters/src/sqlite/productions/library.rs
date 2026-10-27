//! Catalogue reads for the studio: what the library holds (for the shot list prompt) and when a
//! clip last became ready (for the coverage recheck). Only `ready` clips count, so duplicates and
//! clips still in the pipeline are left out.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::UserId;
use nimbytes_core::ports::LibrarySummary;
use sqlx::SqlitePool;

use crate::sqlite::db_err;

/// Places listed, most frequent first.
const TOP_PLACES: i64 = 8;
/// Named people listed, most seen first.
const TOP_PEOPLE: i64 = 10;
/// Actions listed, most frequent first.
const TOP_ACTIONS: i64 = 12;

async fn names(
    pool: &SqlitePool,
    sql: &'static str,
    user: &UserId,
    limit: i64,
) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar(sql)
        .bind(user.as_str())
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(db_err)
}

/// Clip count and minutes, top places, named people and top actions of `user`'s ready clips.
pub(super) async fn summary(pool: &SqlitePool, user: &UserId) -> Result<LibrarySummary, AppError> {
    let (clips, seconds): (i64, f64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(duration_s), 0.0) FROM clips \
         WHERE user_id = ? AND status = 'ready'",
    )
    .bind(user.as_str())
    .fetch_one(pool)
    .await
    .map_err(db_err)?;
    Ok(LibrarySummary {
        clips: u32::try_from(clips).unwrap_or(0),
        minutes: seconds / 60.0,
        places: names(pool, PLACES, user, TOP_PLACES).await?,
        people: names(pool, PEOPLE, user, TOP_PEOPLE).await?,
        actions: names(pool, ACTIONS, user, TOP_ACTIONS).await?,
    })
}

/// Places spelled as first stored, grouped ignoring case and outer spaces.
const PLACES: &str = "SELECT MIN(trim(s.place)) FROM segments s JOIN clips c ON c.id = s.clip_id \
     WHERE c.user_id = ? AND c.status = 'ready' AND trim(COALESCE(s.place, '')) <> '' \
     GROUP BY lower(trim(s.place)) ORDER BY COUNT(*) DESC, 1 LIMIT ?";

/// Named people by the face tracks named after them.
const PEOPLE: &str = "SELECT p.name FROM people p LEFT JOIN face_tracks t ON t.person_id = p.id \
     WHERE p.user_id = ? GROUP BY p.id ORDER BY COUNT(t.id) DESC, p.name LIMIT ?";

/// Actions in lower case, from each segment's `actions` JSON array.
const ACTIONS: &str = "SELECT lower(trim(j.value)) AS a FROM segments s \
     JOIN clips c ON c.id = s.clip_id, json_each(s.actions) j \
     WHERE c.user_id = ? AND c.status = 'ready' AND trim(j.value) <> '' \
     GROUP BY a ORDER BY COUNT(*) DESC, a LIMIT ?";

/// When `user`'s most recent clip became ready: the finish time of its ingest job (read only).
pub(super) async fn last_ready_at(
    pool: &SqlitePool,
    user: &UserId,
) -> Result<Option<String>, AppError> {
    sqlx::query_scalar(
        "SELECT MAX(j.updated_at) FROM jobs j JOIN clips c ON c.id = j.subject_id \
         WHERE j.kind = 'ingest' AND j.status = 'done' AND c.user_id = ? AND c.status = 'ready'",
    )
    .bind(user.as_str())
    .fetch_one(pool)
    .await
    .map_err(db_err)
}
