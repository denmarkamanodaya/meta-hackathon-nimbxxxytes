//! The `similar` step: links a clip to its near-copies and same-moment clips from the nearest
//! moments in the owner's library. A near-copy found during ingest stops there, like an exact
//! duplicate; a backfill over the existing library only records links and never downgrades a
//! ready clip.

use crate::domain::clip::{Clip, ClipStatus, newer};
use crate::domain::ids::{ClipId, SegmentId};
use crate::domain::similar::{
    ClipLink, Footage, LinkKind, Moment, NEIGHBOURS, Outcome, Score, Verdict, judge, outcome,
};
use crate::error::AppError;
use crate::time::format_utc;

use super::{IngestSteps, Work};

/// Who runs the step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Pass {
    /// Ingest of a new clip: a near-copy (this clip, or a newer clip still processing) stops.
    Ingest,
    /// The backfill over ready clips: links only.
    Backfill,
}

/// Clips other clips may be compared with: still ingesting, searchable, or a near-copy waiting
/// for the owner.
fn comparable(clip: &Clip) -> bool {
    matches!(
        clip.status,
        ClipStatus::Processing | ClipStatus::Ready | ClipStatus::NearCopy
    )
}

/// One candidate clip with its moments and the scores between them and the clip's.
struct Candidate {
    clip: Clip,
    moments: Vec<Moment>,
    scores: Vec<Score>,
}

impl IngestSteps {
    async fn moments_of(&self, clip: &ClipId) -> Result<Vec<Moment>, AppError> {
        let ids: Vec<SegmentId> = self
            .catalogue
            .list_segments(clip)
            .await?
            .into_iter()
            .map(|s| s.id)
            .collect();
        let mut moments = self.catalogue.moments(&ids).await?;
        moments.sort_by(|a, b| a.span.start_s.total_cmp(&b.span.start_s));
        Ok(moments)
    }

    /// The nearest moments of every non-blank moment of the clip, scored against it.
    async fn nearest(&self, own: &[Moment]) -> Result<Vec<Score>, AppError> {
        let skip: Vec<SegmentId> = own.iter().map(|m| m.segment.clone()).collect();
        let mut scores = Vec::new();
        for m in own.iter().filter(|m| !m.blank) {
            let near = self
                .vectors
                .similar_to(&m.segment, &skip, NEIGHBOURS)
                .await?;
            scores.extend(near.into_iter().map(|(b, similarity)| Score {
                a: m.segment.clone(),
                b,
                similarity,
            }));
        }
        Ok(scores)
    }

    /// The clips those nearest moments belong to, with their moments and scores.
    async fn candidates(&self, clip: &Clip, own: &[Moment]) -> Result<Vec<Candidate>, AppError> {
        let scores = self.nearest(own).await?;
        let found: Vec<SegmentId> = scores.iter().map(|s| s.b.clone()).collect();
        let mut clips: Vec<ClipId> = self
            .catalogue
            .moments(&found)
            .await?
            .into_iter()
            .map(|m| m.clip)
            .filter(|c| c != &clip.id)
            .collect();
        clips.sort();
        clips.dedup();
        let mut out = Vec::with_capacity(clips.len());
        for id in clips {
            let Some(other) = self.catalogue.get_clip(&id).await? else {
                continue;
            };
            if other.user_id != clip.user_id || !comparable(&other) {
                continue;
            }
            let moments = self.moments_of(&id).await?;
            let scores = scores
                .iter()
                .filter(|s| moments.iter().any(|m| m.segment == s.b))
                .cloned()
                .collect();
            out.push(Candidate {
                clip: other,
                moments,
                scores,
            });
        }
        Ok(out)
    }

    /// The other clips of pairs the owner kept.
    async fn kept_with(&self, clip: &ClipId) -> Result<Vec<ClipId>, AppError> {
        Ok(self
            .links
            .of_clip(clip)
            .await?
            .into_iter()
            .filter(|l| l.kind == LinkKind::Kept)
            .map(|l| if &l.clip == clip { l.other } else { l.clip })
            .collect())
    }

    /// Compares the clip with the nearest clips in its owner's library and stores the links. In
    /// ingest, a near-copy is marked `near_copy` (this clip, or a newer one still processing).
    pub(super) async fn similar(&self, work: &Work, pass: Pass) -> Result<(), AppError> {
        let clip = &work.clip;
        let own = self.moments_of(&clip.id).await?;
        let candidates = self.candidates(clip, &own).await?;
        let mine = Footage::of(clip, &own);
        let verdicts: Vec<(&Clip, Verdict)> = candidates
            .iter()
            .map(|c| {
                let theirs = Footage::of(&c.clip, &c.moments);
                let verdict = if newer(clip, &c.clip).id == clip.id {
                    judge(&mine, &theirs, &c.scores)
                } else {
                    judge(&theirs, &mine, &c.scores)
                };
                (&c.clip, verdict)
            })
            .collect();
        let found = outcome(clip, verdicts, &self.kept_with(&clip.id).await?);
        let processing: Vec<ClipId> = candidates
            .iter()
            .filter(|c| c.clip.status == ClipStatus::Processing)
            .map(|c| c.clip.id.clone())
            .collect();
        self.record(clip, (&found, &processing), pass).await
    }

    /// Stores the links of `found`; in ingest, marks this clip and newer copies that are still
    /// `processing` as near-copies.
    async fn record(
        &self,
        clip: &Clip,
        (found, processing): (&Outcome, &[ClipId]),
        pass: Pass,
    ) -> Result<(), AppError> {
        let mut links = Vec::new();
        if let Some((original, score)) = &found.copy_of {
            links.push(near_copy(&clip.id, original, *score));
        }
        for (copy, score) in &found.copied_by {
            links.push(near_copy(copy, &clip.id, *score));
        }
        for (other, score) in &found.same_moment {
            links.push(ClipLink::same_moment(&clip.id, other, *score));
        }
        if links.is_empty() {
            return Ok(());
        }
        let now = format_utc(self.clock.now_millis());
        self.links.save(&clip.user_id, &links, &now).await?;
        if pass == Pass::Backfill {
            return Ok(());
        }
        let mut stopped: Vec<&ClipId> = found
            .copied_by
            .iter()
            .map(|(c, _)| c)
            .filter(|c| processing.contains(c))
            .collect();
        if found.copy_of.is_some() {
            stopped.push(&clip.id);
        }
        for id in stopped {
            self.catalogue
                .set_clip_status(id, ClipStatus::NearCopy, None)
                .await?;
        }
        Ok(())
    }
}

fn near_copy(copy: &ClipId, original: &ClipId, score: f64) -> ClipLink {
    ClipLink {
        clip: copy.clone(),
        other: original.clone(),
        kind: LinkKind::NearCopyOf,
        score,
    }
}
