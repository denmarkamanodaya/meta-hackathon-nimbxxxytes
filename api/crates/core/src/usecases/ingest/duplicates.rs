//! Exact duplicates: an original whose bytes match another clip of the same owner is a copy. The
//! newer of the two is marked `duplicate`, is not ingested any further, and leaves the search
//! indexes; the owner decides whether to remove it.

use std::path::Path;

use super::{IngestSteps, Work};
use crate::domain::clip::{Clip, newer};
use crate::domain::ids::SegmentId;
use crate::error::AppError;

impl IngestSteps {
    /// Hashes the local original, stores the hash, and marks the newer of a same-content pair as
    /// the duplicate. Returns whether `clip` itself is the copy.
    pub(super) async fn settle_duplicate(
        &self,
        clip: &Clip,
        original: &Path,
    ) -> Result<bool, AppError> {
        let sha = self.scratch.sha256(original).await?;
        self.catalogue.record_hash(&clip.id, &sha).await?;
        let twins = self.catalogue.same_content(&clip.user_id, &sha).await?;
        let others = twins.iter().filter(|c| c.id != clip.id);
        let Some(oldest) =
            others.min_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)))
        else {
            return Ok(false);
        };
        let copy = newer(clip, oldest);
        let kept = if copy.id == clip.id { oldest } else { clip };
        self.catalogue.mark_duplicate(&copy.id, &kept.id).await?;
        let segments: Vec<SegmentId> = self
            .catalogue
            .list_segments(&copy.id)
            .await?
            .into_iter()
            .map(|s| s.id)
            .collect();
        self.text_index.remove(&segments).await?;
        self.vectors.remove(&segments).await?;
        Ok(copy.id == clip.id)
    }

    /// The `hash` step of a backfill job: hashes an already ingested clip, then frees its scratch
    /// directory.
    pub(super) async fn hash(&self, work: &Work) -> Result<(), AppError> {
        let original = self.local_original(work).await?;
        self.settle_duplicate(&work.clip, &original).await?;
        self.scratch.remove_clip_dir(&work.clip.id).await
    }
}
