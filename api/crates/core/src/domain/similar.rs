//! Near-copies and same-moment footage, from the image vectors of each clip's moments (5–10 s
//! windows) and the clips' recording times. Pure: the caller hands in each moment's best-known
//! similarities to the other clip's moments.
//!
//! Thresholds were measured on a generated kit (re-encode, resize, trim, re-export with a title
//! card, shuffled thirds, a second crop of the same scene, unrelated clips) against 588 unrelated
//! clip pairs (2433 moment matches) of real footage and stock video:
//! - real near-copies: every moment ≥ 0.878, mean best match ≥ 0.919;
//! - the second crop of the same scene: mean 0.879, 75% of moments ordered at 0.85;
//! - two parts of one long video (same event, different moments): mean 0.883, 41% ordered;
//! - unrelated moments: max 0.957 (one shared logo slate), then 0.863; p99.9 0.860;
//! - black frames match each other at 1.000 across unrelated videos, hence the blank rule.

use crate::domain::clip::{Clip, ClipStatus, newer};
use crate::domain::ids::{ClipId, SegmentId};
use crate::domain::segmenting::Span;
use crate::domain::text_enum::text_enum;
use crate::time::parse_utc;

/// A moment matches its twin in a near-copy at this cosine similarity or more. Kept low because a
/// trim or a title card moves the windows, so a twin's thumbnail is taken seconds apart (a trim's
/// worst real moment scored 0.878).
pub const T_COPY: f64 = 0.85;
/// A near-copy's mean best-match similarity over the shorter clip's moments is at least this.
/// Separates copies (≥ 0.919) from the same place or event (≤ 0.883).
pub const MEAN_COPY: f64 = 0.90;
/// Share of the shorter clip's moments that must match at [`T_COPY`] in time order.
pub const MIN_ORDERED: f64 = 0.80;
/// A copy may be at most this much longer than its original (durations within 25%); a shorter
/// copy is a trim, inside the original.
pub const MAX_COPY_LENGTH: f64 = 1.25;
/// Two clips filmed the same moment share a moment at this similarity or more (the second crop
/// scored up to 0.938; unrelated moments other than a logo slate stay at or under 0.863).
pub const T_SCENE: f64 = 0.87;
/// Two real recording times at most this far apart can be the same moment.
pub const SAME_MOMENT_WINDOW_MS: i64 = 10 * 60 * 1000;
/// A thumbnail whose grey levels (0–255) have a standard deviation under this is blank (black,
/// covered lens, flat wall); it never matches and never counts.
pub const BLANK_GREY_STD: f32 = 12.0;
/// Nearest moments looked up per moment of the new clip.
pub const NEIGHBOURS: u32 = 5;

/// Whether a thumbnail with this grey-level standard deviation is blank.
pub fn is_blank(grey_std: f32) -> bool {
    grey_std < BLANK_GREY_STD
}

/// One stored moment of a clip.
#[derive(Debug, Clone, PartialEq)]
pub struct Moment {
    /// Its segment.
    pub segment: SegmentId,
    /// Owning clip.
    pub clip: ClipId,
    /// Time span in clip seconds.
    pub span: Span,
    /// Its thumbnail is blank.
    pub blank: bool,
}

/// The similarity of two moments (of two different clips), either way round.
#[derive(Debug, Clone, PartialEq)]
pub struct Score {
    /// One moment.
    pub a: SegmentId,
    /// The other.
    pub b: SegmentId,
    /// Cosine similarity.
    pub similarity: f64,
}

/// One side of a comparison.
#[derive(Debug, Clone, Copy)]
pub struct Footage<'a> {
    /// Length, seconds.
    pub duration_s: f64,
    /// The real recording time (the container's creation time), never the upload time.
    pub recorded_at: Option<&'a str>,
    /// Its moments in time order.
    pub moments: &'a [Moment],
}

impl<'a> Footage<'a> {
    /// The clip's side: its probed length and real recording time with `moments`.
    pub fn of(clip: &'a Clip, moments: &'a [Moment]) -> Self {
        let probe = clip.probe.as_ref();
        Self {
            duration_s: probe.map_or(0.0, |p| p.duration_s),
            recorded_at: probe.and_then(|p| p.recorded_at.as_deref()),
            moments,
        }
    }
}

/// How two clips relate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Verdict {
    /// The newer clip copies the older; the mean best-match similarity.
    NearCopy(f64),
    /// Filmed at the same moment (another device or angle); the best moment similarity.
    SameMoment(f64),
    /// Neither.
    Unrelated,
}

text_enum!(
    /// A stored link between two clips.
    LinkKind {
        /// `clip` is a near-copy of `other`.
        NearCopyOf => "near_copy_of",
        /// `clip` and `other` were filmed at the same moment (stored once per pair).
        SameMoment => "same_moment",
        /// The owner kept `clip` although it looked like a copy of `other`; never linked again.
        Kept => "kept",
    }
);

text_enum!(
    /// How a linked clip relates to the clip on screen.
    LinkRole {
        /// The clip on screen copies it.
        NearCopyOf => "near_copy_of",
        /// It copies the clip on screen.
        CopiedBy => "copied_by",
        /// Filmed at the same moment.
        SameMoment => "same_moment",
    }
);

/// A link row.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipLink {
    /// From.
    pub clip: ClipId,
    /// To.
    pub other: ClipId,
    /// What the link says.
    pub kind: LinkKind,
    /// The verdict's similarity, 0–1.
    pub score: f64,
}

impl ClipLink {
    /// The other clip of the link seen from `viewer`, and how it relates; `None` for a kept pair
    /// (never shown) or a link that does not touch `viewer`.
    pub fn seen_from(&self, viewer: &ClipId) -> Option<(&ClipId, LinkRole)> {
        let (other, mine) = if &self.clip == viewer {
            (&self.other, true)
        } else if &self.other == viewer {
            (&self.clip, false)
        } else {
            return None;
        };
        let role = match (self.kind, mine) {
            (LinkKind::Kept, _) => return None,
            (LinkKind::NearCopyOf, true) => LinkRole::NearCopyOf,
            (LinkKind::NearCopyOf, false) => LinkRole::CopiedBy,
            (LinkKind::SameMoment, _) => LinkRole::SameMoment,
        };
        Some((other, role))
    }

    /// A same-moment link, stored with the lower id first so a pair has one row.
    pub fn same_moment(a: &ClipId, b: &ClipId, score: f64) -> Self {
        let (clip, other) = if a.as_str() <= b.as_str() {
            (a, b)
        } else {
            (b, a)
        };
        Self {
            clip: clip.clone(),
            other: other.clone(),
            kind: LinkKind::SameMoment,
            score,
        }
    }
}

fn similarity(scores: &[Score], x: &SegmentId, y: &SegmentId) -> f64 {
    scores
        .iter()
        .filter(|s| (&s.a == x && &s.b == y) || (&s.a == y && &s.b == x))
        .map(|s| s.similarity)
        .fold(0.0, f64::max)
}

/// For each non-blank moment of `from`, in time order: its best similarity to a non-blank moment
/// of `to`, and that moment's start.
fn best_matches(from: &[Moment], to: &[Moment], scores: &[Score]) -> Vec<(f64, f64)> {
    from.iter()
        .filter(|m| !m.blank)
        .map(|m| {
            to.iter()
                .filter(|t| !t.blank)
                .map(|t| (similarity(scores, &m.segment, &t.segment), t.span.start_s))
                .fold((0.0, 0.0), |best, x| if x.0 > best.0 { x } else { best })
        })
        .collect()
}

/// Length of the longest strictly increasing run (subsequence) of `times`.
fn longest_increasing(times: &[f64]) -> usize {
    let mut tails: Vec<f64> = Vec::new();
    for &t in times {
        let at = tails.partition_point(|&x| x < t);
        if at == tails.len() {
            tails.push(t);
        } else {
            tails[at] = t;
        }
    }
    tails.len()
}

/// The mean best match when `copy` and `original` are near-copies, else `None`.
fn near_copy(copy: &Footage<'_>, original: &Footage<'_>, scores: &[Score]) -> Option<f64> {
    if copy.duration_s > original.duration_s * MAX_COPY_LENGTH {
        return None;
    }
    let (short, long) = if copy.duration_s <= original.duration_s {
        (copy, original)
    } else {
        (original, copy)
    };
    let best = best_matches(short.moments, long.moments, scores);
    if best.is_empty() {
        return None;
    }
    let n = best.len() as f64;
    let mean = best.iter().map(|b| b.0).sum::<f64>() / n;
    let matched: Vec<f64> = best.iter().filter(|b| b.0 >= T_COPY).map(|b| b.1).collect();
    let ordered = longest_increasing(&matched) as f64 / n;
    (ordered >= MIN_ORDERED && mean >= MEAN_COPY).then_some(mean)
}

fn within_window(a: Option<&str>, b: Option<&str>) -> bool {
    match (a.and_then(parse_utc), b.and_then(parse_utc)) {
        (Some(a), Some(b)) => (a - b).abs() <= SAME_MOMENT_WINDOW_MS,
        _ => false,
    }
}

/// How the newer clip `copy` relates to the older `original`. Blank moments never count; a clip
/// that is all blank never links. Same-moment needs both real recording times.
pub fn judge(copy: &Footage<'_>, original: &Footage<'_>, scores: &[Score]) -> Verdict {
    if let Some(mean) = near_copy(copy, original, scores) {
        return Verdict::NearCopy(mean);
    }
    if !within_window(copy.recorded_at, original.recorded_at) {
        return Verdict::Unrelated;
    }
    let best = best_matches(copy.moments, original.moments, scores)
        .into_iter()
        .map(|b| b.0)
        .fold(0.0, f64::max);
    if best >= T_SCENE {
        Verdict::SameMoment(best)
    } else {
        Verdict::Unrelated
    }
}

/// What the similar step records for one clip.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Outcome {
    /// The clip this one copies (the oldest matching original) and the score.
    pub copy_of: Option<(ClipId, f64)>,
    /// Newer clips that copy this one, with their scores.
    pub copied_by: Vec<(ClipId, f64)>,
    /// Same-moment clips, with their scores.
    pub same_moment: Vec<(ClipId, f64)>,
}

/// Sorts the verdicts of `clip` against each candidate into an [`Outcome`]. A copy (this clip, or a
/// candidate already marked as one) never gets same-moment links. Pairs the owner kept
/// (`kept` holds the other clip of each) never link again, so the kept mark stays. Of several originals, the
/// oldest wins (ties go to the lower id, as with exact duplicates).
pub fn outcome<'a>(
    clip: &Clip,
    verdicts: impl IntoIterator<Item = (&'a Clip, Verdict)>,
    kept: &[ClipId],
) -> Outcome {
    let mut out = Outcome::default();
    let mut originals: Vec<(&Clip, f64)> = Vec::new();
    for (other, verdict) in verdicts {
        match verdict {
            _ if kept.contains(&other.id) => {}
            Verdict::NearCopy(score) => {
                if newer(clip, other).id == clip.id {
                    originals.push((other, score));
                } else {
                    out.copied_by.push((other.id.clone(), score));
                }
            }
            Verdict::SameMoment(score) if !is_copy(other) => {
                out.same_moment.push((other.id.clone(), score));
            }
            Verdict::SameMoment(_) => {}
            Verdict::Unrelated => {}
        }
    }
    out.copy_of = originals
        .into_iter()
        .min_by(|a, b| (&a.0.created_at, &a.0.id).cmp(&(&b.0.created_at, &b.0.id)))
        .map(|(c, s)| (c.id.clone(), s));
    if out.copy_of.is_some() {
        // A copy is hidden from the library, so it is never another clip's angle.
        out.same_moment.clear();
    }
    out
}

/// A clip already set aside as a copy (exact or near); it never links as a same moment.
fn is_copy(clip: &Clip) -> bool {
    matches!(clip.status, ClipStatus::Duplicate | ClipStatus::NearCopy)
}

#[cfg(test)]
mod tests;
