//! Privacy blur: face boxes kept per track (normalised to the upright frame, one per second), the
//! finish settings of a short, and which boxes a render blurs.

use serde::{Deserialize, Serialize};

use crate::domain::faces::Detection;
use crate::domain::ids::{SegmentId, TrackId};
use crate::domain::segmenting::Span;
use crate::error::{AppError, ErrorCode};

/// Boxes this far outside a segment still go to the render, seconds, so the blur can
/// interpolate into the segment's first and last second.
pub const EDGE_S: f64 = 1.0;
/// Longest opening title, characters.
pub const MAX_TITLE_CHARS: usize = 80;

/// One face box at one second of its clip, as shares (0–1) of the upright frame.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FaceBox {
    /// Clip second (the 1 fps frame index).
    pub t_s: f64,
    /// Left.
    pub x: f64,
    /// Top.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
}

/// `d`'s box as shares of its frame, clipped to the frame; `None` for an empty frame or box.
pub fn normalised_box(d: &Detection) -> Option<FaceBox> {
    let (fw, fh) = (f64::from(d.frame_w), f64::from(d.frame_h));
    if fw <= 0.0 || fh <= 0.0 {
        return None;
    }
    let x1 = (d.bbox.x1 / fw).clamp(0.0, 1.0);
    let y1 = (d.bbox.y1 / fh).clamp(0.0, 1.0);
    let x2 = (d.bbox.x2 / fw).clamp(0.0, 1.0);
    let y2 = (d.bbox.y2 / fh).clamp(0.0, 1.0);
    (x2 > x1 && y2 > y1).then_some(FaceBox {
        t_s: f64::from(d.frame),
        x: x1,
        y: y1,
        w: x2 - x1,
        h: y2 - y1,
    })
}

/// A track's boxes in time order, one per second (the largest when a second has two).
pub fn run_boxes(run: &[Detection]) -> Vec<FaceBox> {
    let mut out: Vec<FaceBox> = Vec::with_capacity(run.len());
    let mut boxes: Vec<FaceBox> = run.iter().filter_map(normalised_box).collect();
    boxes.sort_by(|a, b| a.t_s.total_cmp(&b.t_s));
    for b in boxes {
        match out.last_mut() {
            Some(last) if last.t_s == b.t_s => {
                if b.w * b.h > last.w * last.h {
                    *last = b;
                }
            }
            _ => out.push(b),
        }
    }
    out
}

/// The boxes one hidden track has in one segment it is seen in.
#[derive(Debug, Clone, PartialEq)]
pub struct HiddenBoxes {
    /// The segment.
    pub segment_id: SegmentId,
    /// Its time on the clip.
    pub span: Span,
    /// The hidden track.
    pub track_id: TrackId,
    /// Width / height of the clip as displayed (upright); `None` before it was probed.
    pub aspect: Option<f64>,
    /// Every box of the track, in time order.
    pub boxes: Vec<FaceBox>,
}

/// One hidden face in one shot's segment, as the composition blurs it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SegmentBlur {
    /// The segment (a shot shows it when its `segment_id` matches).
    pub segment_id: SegmentId,
    /// Width / height of the upright source video, so the boxes follow the shot's cover crop.
    pub aspect: f64,
    /// One face's boxes in clip seconds, in time order.
    pub boxes: Vec<FaceBox>,
}

/// The blur entries of a render: when `on`, one per hidden track per segment the shots use, with
/// the track's boxes inside the segment (plus [`EDGE_S`] each side); entries without boxes, or
/// whose clip size is unknown, are dropped. Ordered by the segment's first shot, then by track.
pub fn blur_entries(
    shot_segments: &[SegmentId],
    mut hidden: Vec<HiddenBoxes>,
    on: bool,
) -> Vec<SegmentBlur> {
    if !on {
        return Vec::new();
    }
    let first_use = |id: &SegmentId| shot_segments.iter().position(|s| s == id);
    hidden.retain(|h| first_use(&h.segment_id).is_some());
    hidden.sort_by(|a, b| {
        (first_use(&a.segment_id), &a.track_id).cmp(&(first_use(&b.segment_id), &b.track_id))
    });
    hidden
        .into_iter()
        .filter_map(|h| {
            let (from, to) = (h.span.start_s - EDGE_S, h.span.end_s + EDGE_S);
            let boxes: Vec<FaceBox> = h
                .boxes
                .into_iter()
                .filter(|b| (from..=to).contains(&b.t_s))
                .collect();
            let aspect = h.aspect.filter(|a| a.is_finite() && *a > 0.0)?;
            (!boxes.is_empty()).then_some(SegmentBlur {
                segment_id: h.segment_id,
                aspect,
                boxes,
            })
        })
        .collect()
}

/// A finishing effect on the short's subject.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Effect {
    /// None.
    None,
    /// Darken around the subject.
    Spotlight,
    /// Blur behind the subject.
    BlurBg,
}

impl Effect {
    /// Stored text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Spotlight => "spotlight",
            Self::BlurBg => "blur_bg",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for text this type did not write.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::None, Self::Spotlight, Self::BlurBg]
            .into_iter()
            .find(|e| e.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad effect {raw}")))
    }
}

/// How a short is finished before it is rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShortFinish {
    /// Blur the faces hidden in People.
    pub blur_bystanders: bool,
    /// Opening title text.
    pub title_text: Option<String>,
    /// Colour captions by speaker.
    pub speaker_colors: bool,
    /// Subject effect.
    pub effect: Effect,
    /// Vertical exports follow each shot's subject instead of the centre.
    pub keep_subject: bool,
}

/// The stored finish, else the defaults: blur on, no title, plain captions, no effect.
pub fn finish_or_default(stored: Option<ShortFinish>) -> ShortFinish {
    stored.unwrap_or(ShortFinish {
        blur_bystanders: true,
        title_text: None,
        speaker_colors: false,
        effect: Effect::None,
        keep_subject: true,
    })
}

/// The finish with its title trimmed (an empty title is none).
///
/// # Errors
/// `VALIDATION_FAILED` for a title over [`MAX_TITLE_CHARS`].
pub fn checked_finish(mut f: ShortFinish) -> Result<ShortFinish, AppError> {
    f.title_text = f
        .title_text
        .map(|t| t.trim().to_owned())
        .filter(|t| !t.is_empty());
    if f.title_text
        .as_ref()
        .is_some_and(|t| t.chars().count() > MAX_TITLE_CHARS)
    {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            format!("title_text must be at most {MAX_TITLE_CHARS} characters"),
        ));
    }
    Ok(f)
}

#[cfg(test)]
mod tests;
