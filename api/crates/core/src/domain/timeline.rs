//! Timeline of a short: the cut the planner writes and the user edits, and the pure rule that
//! makes any timeline safe to render (shots inside their segments, no slivers, close to the
//! target length). Every change the rule makes is reported so the step log can show it.

use serde::{Deserialize, Serialize};

use crate::domain::ids::SegmentId;
use crate::domain::segmenting::Span;
use crate::error::{AppError, ErrorCode};

/// Shortest shot kept, seconds; anything shorter reads as a glitch.
pub const MIN_SHOT_S: f64 = 0.6;
/// Allowed distance of the total length from the target, as a fraction of the target.
pub const LENGTH_TOLERANCE: f64 = 0.2;
/// Largest zoom the renderer accepts.
pub const MAX_PUNCH_IN: f64 = 3.0;
/// Most shots in one timeline.
pub const MAX_SHOTS: usize = 20;
/// Accepted target lengths, seconds.
pub const TARGET_RANGE_S: (f64, f64) = (3.0, 90.0);

/// Output frame of a short.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Aspect {
    /// 4:5 portrait (1080×1350).
    #[serde(rename = "4:5")]
    Portrait,
    /// 1:1 square (1080×1080).
    #[serde(rename = "1:1")]
    Square,
}

impl Aspect {
    /// Stored and wire text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Portrait => "4:5",
            Self::Square => "1:1",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text (only this type writes the column).
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::Portrait, Self::Square]
            .into_iter()
            .find(|a| a.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad aspect {raw}")))
    }
}

fn no_zoom() -> f64 {
    1.0
}

/// One shot: a part of a segment's clip, in seconds on that clip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimelineClip {
    /// The segment the shot comes from.
    pub segment_id: SegmentId,
    /// Start, seconds on the clip.
    #[serde(rename = "in")]
    pub in_s: f64,
    /// End, seconds on the clip.
    #[serde(rename = "out")]
    pub out_s: f64,
    /// What the shot is about; `None` for no subject.
    #[serde(default)]
    pub subject: Option<String>,
    /// Zoom over the cover crop, 1.0 = none.
    #[serde(default = "no_zoom")]
    pub punch_in: f64,
    /// Why the shot is there.
    #[serde(default)]
    pub reason: String,
}

/// Whether captions are drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptionStyle {
    /// Phrase captions from the transcript.
    Phrase,
    /// No captions.
    None,
}

/// Where caption text comes from (only the transcript today).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptionSource {
    /// The clip's speech turns.
    Transcript,
}

/// Caption settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptionPlan {
    /// Phrase or none.
    pub style: CaptionStyle,
    /// Text source.
    pub source: CaptionSource,
}

/// Text posted with the short.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Post {
    /// Caption line.
    pub caption: String,
    /// Hashtags, each starting with `#`.
    pub hashtags: Vec<String>,
}

/// Kind of change a revision made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionAction {
    /// Shot added.
    Add,
    /// Shot removed.
    Remove,
    /// Shot replaced.
    Swap,
    /// Shot shortened or lengthened.
    Trim,
    /// Shots moved.
    Reorder,
    /// Caption timing changed.
    RetimeCaptions,
}

/// One change of a revision and the critique note it answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevisionChange {
    /// Kind of change.
    pub action: RevisionAction,
    /// What changed.
    pub detail: String,
    /// Why.
    pub why: String,
    /// 0-based critique note index; `None` only on manual edits.
    #[serde(default)]
    pub note_index: Option<u32>,
}

/// What a version changed relative to an earlier one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Revision {
    /// The version it changed (1-based).
    pub from_version: u32,
    /// The changes.
    pub changes: Vec<RevisionChange>,
}

/// A cut: shots in play order, captions, post text and the reasoning behind it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Timeline {
    /// Output frame.
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_seconds: f64,
    /// Shots in play order.
    pub clips: Vec<TimelineClip>,
    /// Caption settings.
    pub captions: CaptionPlan,
    /// Post text.
    pub post: Post,
    /// Why the cut looks like this.
    pub rationale: String,
    /// `None` on a first version and on manual edits.
    #[serde(default)]
    pub revision: Option<Revision>,
}

impl Timeline {
    /// Sum of the shot lengths, seconds.
    pub fn length_s(&self) -> f64 {
        self.clips.iter().map(|c| c.out_s - c.in_s).sum()
    }
}

/// The span a segment covers on its clip.
#[derive(Debug, Clone, PartialEq)]
pub struct Bounds {
    /// Segment.
    pub segment_id: SegmentId,
    /// Its span, clip seconds.
    pub span: Span,
}

/// One change [`fit`] made, in words for the step log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clamp {
    /// 0-based shot position in the timeline as given; `None` for whole-timeline changes.
    pub shot: Option<usize>,
    /// What changed, for example `the latte pour: in 1.40 → 3.00 s (segment starts at 3.00 s)`.
    pub note: String,
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg.into())
}

/// Milliseconds are the finest step that matters at 30 fps.
fn ms(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

fn label(shot: usize, c: &TimelineClip) -> String {
    c.subject
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("Shot {}", shot + 1))
}

/// Makes `timeline` safe to render: every shot inside its segment, no shot under
/// [`MIN_SHOT_S`], zoom within 1–[`MAX_PUNCH_IN`], and the total within [`LENGTH_TOLERANCE`] of
/// the target (shots are trimmed proportionally, or extended inside their segments). Returns
/// the fixed timeline and every change made.
///
/// # Errors
/// `VALIDATION_FAILED` for no shots, too many shots, a target outside [`TARGET_RANGE_S`], a
/// segment not in `bounds`, a non-finite time, or when no shot is long enough to keep.
pub fn fit(mut timeline: Timeline, bounds: &[Bounds]) -> Result<(Timeline, Vec<Clamp>), AppError> {
    let target = timeline.target_seconds;
    if !(TARGET_RANGE_S.0..=TARGET_RANGE_S.1).contains(&target) {
        return Err(invalid("target_seconds must be 3 to 90"));
    }
    if timeline.clips.is_empty() || timeline.clips.len() > MAX_SHOTS {
        return Err(invalid("a timeline needs 1 to 20 shots"));
    }
    let mut clamps = Vec::new();
    let mut kept: Vec<(TimelineClip, Span)> = Vec::new();
    for (i, c) in std::mem::take(&mut timeline.clips).into_iter().enumerate() {
        let span = bounds
            .iter()
            .find(|b| b.segment_id == c.segment_id)
            .map(|b| b.span)
            .ok_or_else(|| {
                invalid(format!(
                    "segment {} is not part of this short",
                    c.segment_id
                ))
            })?;
        if let Some(fixed) = fix_shot(i, c, span, &mut clamps)? {
            kept.push((fixed, span));
        }
    }
    if kept.is_empty() {
        return Err(invalid("no shot is long enough to keep"));
    }
    let before: f64 = kept.iter().map(|(c, _)| c.out_s - c.in_s).sum();
    fit_length(&mut kept, target);
    let after: f64 = kept.iter().map(|(c, _)| c.out_s - c.in_s).sum();
    if (after - before).abs() >= 0.001 {
        clamps.push(Clamp {
            shot: None,
            note: format!("length {before:.1} → {after:.1} s to fit the {target} s target"),
        });
    }
    timeline.clips = kept.into_iter().map(|(c, _)| c).collect();
    Ok((timeline, clamps))
}

/// `punch_in` within 1–[`MAX_PUNCH_IN`]; no zoom when it is not a number.
fn zoom(punch_in: f64) -> f64 {
    if punch_in.is_finite() {
        punch_in.clamp(1.0, MAX_PUNCH_IN)
    } else {
        1.0
    }
}

/// Clamps one shot into its segment span and its zoom into range, noting each change; `None`
/// when what is left is shorter than [`MIN_SHOT_S`].
fn fix_shot(
    i: usize,
    mut c: TimelineClip,
    span: Span,
    clamps: &mut Vec<Clamp>,
) -> Result<Option<TimelineClip>, AppError> {
    if !(c.in_s.is_finite() && c.out_s.is_finite()) {
        return Err(invalid("in and out must be numbers"));
    }
    let name = label(i, &c);
    let mut note = |text: String| {
        clamps.push(Clamp {
            shot: Some(i),
            note: format!("{name}: {text}"),
        });
    };
    let (start, end) = (span.start_s, span.end_s);
    let in_s = ms(c.in_s).clamp(start, end);
    let out_s = ms(c.out_s).clamp(start, end);
    if in_s != ms(c.in_s) {
        note(format!(
            "in {:.2} → {in_s:.2} s (segment {start:.2}–{end:.2} s)",
            c.in_s
        ));
    }
    if out_s != ms(c.out_s) {
        note(format!(
            "out {:.2} → {out_s:.2} s (segment {start:.2}–{end:.2} s)",
            c.out_s
        ));
    }
    if out_s - in_s < MIN_SHOT_S {
        let len = (out_s - in_s).max(0.0);
        note(format!(
            "dropped, {len:.2} s is shorter than {MIN_SHOT_S} s"
        ));
        return Ok(None);
    }
    let punch = zoom(c.punch_in);
    if punch != c.punch_in {
        note(format!("zoom {} → {punch}", c.punch_in));
    }
    (c.in_s, c.out_s, c.punch_in) = (in_s, out_s, punch);
    Ok(Some(c))
}

/// Trims every shot by the same factor (never below [`MIN_SHOT_S`]) when the cut is too long;
/// extends shots inside their segments, first shot first, when it is too short.
fn fit_length(shots: &mut [(TimelineClip, Span)], target: f64) {
    let (lo, hi) = (
        target * (1.0 - LENGTH_TOLERANCE),
        target * (1.0 + LENGTH_TOLERANCE),
    );
    let total: f64 = shots.iter().map(|(c, _)| c.out_s - c.in_s).sum();
    if total > hi {
        let factor = hi / total;
        for (c, _) in shots.iter_mut() {
            let len = c.out_s - c.in_s;
            c.out_s = ms(c.in_s + (len * factor).max(MIN_SHOT_S.min(len)));
        }
    } else if total < lo {
        let mut need = lo - total;
        for (c, span) in shots.iter_mut() {
            let more = (span.end_s - c.out_s).min(need).max(0.0);
            c.out_s = ms(c.out_s + more).min(span.end_s);
            need -= more;
        }
        for (c, span) in shots.iter_mut() {
            let more = (c.in_s - span.start_s).min(need).max(0.0);
            c.in_s = ms(c.in_s - more).max(span.start_s);
            need -= more;
        }
    }
}

#[cfg(test)]
mod tests;
