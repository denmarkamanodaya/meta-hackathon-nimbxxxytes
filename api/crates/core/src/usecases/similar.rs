//! Near-copies and same-moment clips on the library and clip screens, and Keep both.

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::ids::{ClipId, UserId};
use crate::domain::job::{JobKind, KEEP_RESUMES_AFTER};
use crate::domain::similar::{ClipLink, LinkKind, LinkRole};
use crate::error::{AppError, ErrorCode};
use crate::ports::{Catalogue, ClipLinkStore, Clock, JobQueue};
use crate::usecases::clips::owned_clip;

/// The original a library card copies.
#[derive(Debug, Clone, PartialEq)]
pub struct CopyOf {
    /// The original.
    pub clip: ClipId,
    /// Its title.
    pub title: String,
    /// How alike, 0–1.
    pub score: f64,
}

/// What a library card shows about its links.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CardLinks {
    /// The original, when the clip looks like a copy of one (the oldest when several).
    pub near_copy_of: Option<CopyOf>,
    /// Clips filmed at the same moment.
    pub angles: u32,
}

/// The card links of `clip` from all of its owner's `links`, with `clips` (the owner's library)
/// for the originals' titles and ages.
pub fn card_links(clip: &ClipId, links: &[ClipLink], clips: &[&Clip]) -> CardLinks {
    let mut out = CardLinks::default();
    let mut originals: Vec<(&Clip, f64)> = Vec::new();
    for link in links {
        match link.seen_from(clip) {
            Some((other, LinkRole::NearCopyOf)) => {
                if let Some(c) = clips.iter().find(|c| &c.id == other) {
                    originals.push((c, link.score));
                }
            }
            Some((_, LinkRole::SameMoment)) => out.angles += 1,
            Some((_, LinkRole::CopiedBy)) | None => {}
        }
    }
    out.near_copy_of = originals
        .into_iter()
        .min_by(|a, b| (&a.0.created_at, &a.0.id).cmp(&(&b.0.created_at, &b.0.id)))
        .map(|(c, score)| CopyOf {
            clip: c.id.clone(),
            title: c.display_title(),
            score,
        });
    out
}

/// Ports Keep both needs.
pub struct KeepDeps<'a> {
    /// The clip row.
    pub catalogue: &'a dyn Catalogue,
    /// Its links.
    pub links: &'a dyn ClipLinkStore,
    /// Its ingest job.
    pub jobs: &'a dyn JobQueue,
    /// Requeue time.
    pub clock: &'a dyn Clock,
}

/// Keep both: the owner keeps a clip that looks like a copy. Its near-copy links become kept
/// pairs (never linked again); a `near_copy` clip turns `processing` and its ingest resumes from
/// `transcribe`. A ready clip the backfill linked stays ready. Returns the clip's status now.
///
/// # Errors
/// As [`owned_clip`]; `VALIDATION_FAILED` when the clip is not a near-copy; store and queue
/// errors pass through.
pub async fn keep_clip(
    deps: &KeepDeps<'_>,
    user: &UserId,
    id: &ClipId,
) -> Result<ClipStatus, AppError> {
    let clip = owned_clip(deps.catalogue, user, id).await?;
    let linked = deps
        .links
        .of_clip(id)
        .await?
        .iter()
        .any(|l| l.kind == LinkKind::NearCopyOf && &l.clip == id);
    if clip.status != ClipStatus::NearCopy && !linked {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "clip is not a near-copy",
        ));
    }
    deps.links.keep(id).await?;
    if clip.status != ClipStatus::NearCopy {
        return Ok(clip.status);
    }
    deps.catalogue
        .set_clip_status(id, ClipStatus::Processing, None)
        .await?;
    let now = deps.clock.now_millis();
    deps.jobs
        .resume_after((JobKind::Ingest, id.as_str()), KEEP_RESUMES_AFTER, now)
        .await?;
    Ok(ClipStatus::Processing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::media::MediaExt;

    fn clip(id: &str, created_at: &str, title: &str) -> Clip {
        Clip {
            id: ClipId::parse(id).unwrap(),
            user_id: UserId::parse("u1").unwrap(),
            filename: format!("{id}.mov"),
            ext: MediaExt::Mov,
            size_bytes: 1,
            status: ClipStatus::Ready,
            probe: None,
            created_at: created_at.into(),
            title: Some(title.into()),
            last_viewed_at: None,
            content_sha256: None,
            duplicate_of: None,
        }
    }

    fn link(clip: &str, other: &str, kind: LinkKind, score: f64) -> ClipLink {
        ClipLink {
            clip: ClipId::parse(clip).unwrap(),
            other: ClipId::parse(other).unwrap(),
            kind,
            score,
        }
    }

    #[test]
    fn a_card_shows_its_oldest_original_and_counts_its_angles() {
        let (a, b, c, d) = (
            clip("a", "2026-10-27T01:00:00.000Z", "Beach walk"),
            clip("b", "2026-10-27T00:00:00.000Z", "Beach walk, first"),
            clip("c", "2026-10-27T03:00:00.000Z", "Me"),
            clip("d", "2026-10-27T04:00:00.000Z", "Angle"),
        );
        let links = [
            link("c", "a", LinkKind::NearCopyOf, 0.95),
            link("c", "b", LinkKind::NearCopyOf, 0.93),
            ClipLink::same_moment(&c.id, &d.id, 0.9),
            link("d", "a", LinkKind::Kept, 0.96),
        ];
        let all = [&a, &b, &c, &d];
        let mine = card_links(&c.id, &links, &all);
        assert_eq!(
            mine.near_copy_of,
            Some(CopyOf {
                clip: b.id.clone(),
                title: "Beach walk, first".into(),
                score: 0.93
            })
        );
        assert_eq!(mine.angles, 1);
        assert_eq!(
            card_links(&a.id, &links, &all),
            CardLinks::default(),
            "an original has no near_copy_of; a kept pair shows nothing"
        );
        assert_eq!(card_links(&d.id, &links, &all).angles, 1);
    }
}
