//! The people screen's rows on SQLite.

use std::collections::HashMap;

use nimbytes_core::AppError;
use nimbytes_core::domain::clip::Clip;
use nimbytes_core::domain::ids::{ClipId, PersonId, TrackId, UserId};
use nimbytes_core::domain::people::{FaceRow, PeopleOverviewRows, PersonRow};

use super::SqliteCatalogue;
use crate::sqlite::db_err;

/// `id, clip_id, first_s, last_s, crop_key` of a face track.
type FaceTrack = (String, String, f64, f64, Option<String>);

/// Visible tracks no one has named.
const UNNAMED: &str = "SELECT f.id, f.clip_id, f.first_s, f.last_s, f.crop_key FROM face_tracks f \
    JOIN clips c ON c.id = f.clip_id WHERE c.user_id = ? AND f.person_id IS NULL AND f.hidden = 0 \
    AND c.status != 'duplicate'";

/// Tracks the user hid, named or not.
const HIDDEN: &str = "SELECT f.id, f.clip_id, f.first_s, f.last_s, f.crop_key FROM face_tracks f \
    JOIN clips c ON c.id = f.clip_id WHERE c.user_id = ? AND f.hidden = 1 \
    AND c.status != 'duplicate'";

impl SqliteCatalogue {
    pub(super) async fn overview_rows(
        &self,
        user: &UserId,
    ) -> Result<PeopleOverviewRows, AppError> {
        Ok(PeopleOverviewRows {
            people: self.person_rows(user).await?,
            unnamed: self.face_rows(UNNAMED, user).await?,
            hidden: self.face_rows(HIDDEN, user).await?,
        })
    }

    async fn person_rows(&self, user: &UserId) -> Result<Vec<PersonRow>, AppError> {
        let rows: Vec<(String, String, i64, Option<String>)> = sqlx::query_as(
            "SELECT p.id, p.name, COUNT(DISTINCT f.clip_id), \
             (SELECT b.crop_key FROM face_tracks b JOIN clips bc ON bc.id = b.clip_id \
              WHERE b.person_id = p.id AND b.hidden = 0 AND bc.status != 'duplicate' \
              ORDER BY b.max_area DESC, b.id LIMIT 1) \
             FROM people p LEFT JOIN face_tracks f ON f.person_id = p.id AND f.hidden = 0 \
               AND f.clip_id IN (SELECT id FROM clips WHERE status != 'duplicate') \
             WHERE p.user_id = ? GROUP BY p.id, p.name",
        )
        .bind(user.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.into_iter()
            .map(|(id, name, clips, crop_key)| {
                Ok(PersonRow {
                    id: PersonId::parse(id)?,
                    name,
                    clip_count: u32::try_from(clips).unwrap_or(0),
                    crop_key,
                })
            })
            .collect()
    }

    /// Tracks picked by `sql` ([`UNNAMED`] or [`HIDDEN`]) with their clips.
    async fn face_rows(&self, sql: &'static str, user: &UserId) -> Result<Vec<FaceRow>, AppError> {
        let rows: Vec<FaceTrack> = sqlx::query_as(sql)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        let mut clips: HashMap<String, Clip> = HashMap::new();
        let mut out = Vec::with_capacity(rows.len());
        for (id, clip_id, first_s, last_s, crop_key) in rows {
            if !clips.contains_key(&clip_id)
                && let Some(clip) = self.clip_row(&ClipId::parse(clip_id.clone())?).await?
            {
                clips.insert(clip_id.clone(), clip);
            }
            let Some(clip) = clips.get(&clip_id).cloned() else {
                continue;
            };
            out.push(FaceRow {
                track_id: TrackId::parse(id)?,
                clip,
                first_s,
                last_s,
                crop_key,
            });
        }
        Ok(out)
    }
}
