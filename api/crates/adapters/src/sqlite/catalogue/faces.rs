//! Named faces per search candidate.

use nimbytes_core::AppError;
use nimbytes_core::domain::search::{Candidate, FaceSeen};

use super::SqliteCatalogue;
use crate::sqlite::db_err;

impl SqliteCatalogue {
    /// Fills each candidate's named, visible face tracks linked to its segment, biggest face
    /// first. Picking one per person happens in the core.
    pub(super) async fn fill_faces(&self, candidates: &mut [Candidate]) -> Result<(), AppError> {
        for c in candidates.iter_mut() {
            let rows: Vec<(String, Option<String>)> = sqlx::query_as(
                "SELECT p.name, f.crop_key FROM track_segments ts \
                 JOIN face_tracks f ON f.id = ts.track_id JOIN people p ON p.id = f.person_id \
                 WHERE ts.segment_id = ? AND f.hidden = 0 ORDER BY f.max_area DESC, f.id",
            )
            .bind(c.segment_id.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
            c.faces = rows
                .into_iter()
                .map(|(name, crop_key)| FaceSeen { name, crop_key })
                .collect();
        }
        Ok(())
    }
}
