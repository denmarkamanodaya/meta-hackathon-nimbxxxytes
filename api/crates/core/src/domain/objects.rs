//! Things SAM finds besides faces: screens and number plates blurred in exports, an object
//! tapped in a clip ("Find this") and the moments it shows up in again, and cut-outs.

use serde::{Deserialize, Serialize};

use crate::domain::ids::{ClipId, SegmentId};
use crate::domain::privacy::{FaceBox, SegmentBlur};
use crate::domain::sam::{SamRecord, frame_time};
use crate::domain::segmenting::Span;

/// Phrases blurred when the owner turns on "Also blur screens and number plates".
pub const BLUR_CONCEPTS: [&str; 2] = ["screen", "license plate"];
/// Frame rate of the shot range SAM looks for screens and plates on.
pub const BLUR_FPS: u32 = 10;
/// Most shots one render looks for screens and plates in.
pub const MAX_BLUR_SHOTS: usize = 20;
/// Padding around a screen or plate box, as a share of its size on each side.
pub const BLUR_PAD: f64 = 0.15;
/// Lowest kept confidence for a screen or plate.
pub const MIN_BLUR_CONFIDENCE: f64 = 0.5;
/// Most moments Find this returns.
pub const MAX_FIND_HITS: usize = 12;
/// Nearest neighbours asked of each vector index.
pub const FIND_K: u32 = 24;
/// Side of the fallback crop around the tap, as a share of the frame's short side.
pub const FALLBACK_CROP_SHARE: f64 = 0.25;
/// Phrase a cut-out cover looks for when the first shot has no subject.
pub const DEFAULT_CUTOUT_SUBJECT: &str = "person";

/// The blur entries of one shot's screens and plates: one per object, boxes padded and placed
/// in clip seconds (frame `f` of the shot's range at [`BLUR_FPS`] is `in_s + f / fps`). Weak
/// detections and empty boxes are dropped.
pub fn object_blur(segment: &SegmentId, in_s: f64, records: &[SamRecord]) -> Vec<SegmentBlur> {
    let mut ids: Vec<u32> = records.iter().map(|r| r.id).collect();
    ids.sort_unstable();
    ids.dedup();
    ids.into_iter()
        .filter_map(|id| {
            let mine: Vec<&SamRecord> = records
                .iter()
                .filter(|r| r.id == id && r.conf >= MIN_BLUR_CONFIDENCE)
                .collect();
            let first = mine.first()?;
            let aspect = f64::from(first.frame_w) / f64::from(first.frame_h.max(1));
            let mut boxes: Vec<FaceBox> = mine
                .iter()
                .filter_map(|r| padded(r, frame_time(in_s, r.frame, BLUR_FPS)))
                .collect();
            boxes.sort_by(|a, b| a.t_s.total_cmp(&b.t_s));
            (!boxes.is_empty() && aspect > 0.0).then(|| SegmentBlur {
                segment_id: segment.clone(),
                aspect,
                boxes,
            })
        })
        .collect()
}

fn padded(r: &SamRecord, t_s: f64) -> Option<FaceBox> {
    let (fw, fh) = (f64::from(r.frame_w), f64::from(r.frame_h));
    if fw <= 0.0 || fh <= 0.0 {
        return None;
    }
    let (w, h) = (r.bbox.x2 - r.bbox.x1, r.bbox.y2 - r.bbox.y1);
    if w <= 0.0 || h <= 0.0 {
        return None;
    }
    let x1 = ((r.bbox.x1 - w * BLUR_PAD) / fw).clamp(0.0, 1.0);
    let y1 = ((r.bbox.y1 - h * BLUR_PAD) / fh).clamp(0.0, 1.0);
    let x2 = ((r.bbox.x2 + w * BLUR_PAD) / fw).clamp(0.0, 1.0);
    let y2 = ((r.bbox.y2 + h * BLUR_PAD) / fh).clamp(0.0, 1.0);
    Some(FaceBox {
        t_s,
        x: x1,
        y: y1,
        w: x2 - x1,
        h: y2 - y1,
    })
}

/// A square crop in frame pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    /// Left.
    pub x: u32,
    /// Top.
    pub y: u32,
    /// Width.
    pub w: u32,
    /// Height.
    pub h: u32,
}

/// The crop embedded when SAM finds nothing at the tap: a square of
/// [`FALLBACK_CROP_SHARE`] of the short side centred on the tap, moved inside the frame.
pub fn fallback_crop((x, y): (f64, f64), (w, h): (u32, u32)) -> PixelRect {
    let side = ((f64::from(w.min(h)) * FALLBACK_CROP_SHARE).round() as u32).max(1);
    let place = |share: f64, size: u32| {
        let centre = share.clamp(0.0, 1.0) * f64::from(size);
        let start = (centre - f64::from(side) / 2.0).round().max(0.0) as u32;
        start.min(size.saturating_sub(side))
    };
    PixelRect {
        x: place(x, w),
        y: place(y, h),
        w: side.min(w),
        h: side.min(h),
    }
}

/// A record's box as a pixel rectangle inside its frame.
pub fn box_rect(r: &SamRecord) -> PixelRect {
    let x1 = r.bbox.x1.max(0.0).round() as u32;
    let y1 = r.bbox.y1.max(0.0).round() as u32;
    let x2 = (r.bbox.x2.round() as u32)
        .min(r.frame_w.saturating_sub(1))
        .max(x1);
    let y2 = (r.bbox.y2.round() as u32)
        .min(r.frame_h.saturating_sub(1))
        .max(y1);
    PixelRect {
        x: x1,
        y: y1,
        w: x2 - x1 + 1,
        h: y2 - y1 + 1,
    }
}

/// `rect` of a `from` frame scaled onto a `to` frame (the same picture at another size).
pub fn scale_rect(rect: PixelRect, from: (u32, u32), to: (u32, u32)) -> PixelRect {
    let sx = f64::from(to.0) / f64::from(from.0.max(1));
    let sy = f64::from(to.1) / f64::from(from.1.max(1));
    let x = ((f64::from(rect.x) * sx).round() as u32).min(to.0.saturating_sub(1));
    let y = ((f64::from(rect.y) * sy).round() as u32).min(to.1.saturating_sub(1));
    PixelRect {
        x,
        y,
        w: ((f64::from(rect.w) * sx).round() as u32)
            .min(to.0.saturating_sub(x))
            .max(1),
        h: ((f64::from(rect.h) * sy).round() as u32)
            .min(to.1.saturating_sub(y))
            .max(1),
    }
}

/// Where the tapped object is in view: the first to the last second of its track at `fps`.
pub fn in_view(track: &[SamRecord], fps: u32) -> Option<Span> {
    let first = track.iter().map(|r| r.frame).min()?;
    let last = track.iter().map(|r| r.frame).max()?;
    let fps = f64::from(fps.max(1));
    Some(Span {
        start_s: f64::from(first) / fps,
        end_s: (f64::from(last) + 1.0) / fps,
    })
}

/// One match of the tapped object in the library, before grouping.
#[derive(Debug, Clone, PartialEq)]
pub struct FindMatch {
    /// The clip.
    pub clip_id: ClipId,
    /// The moment, when the match is one.
    pub segment_id: Option<SegmentId>,
    /// Where in the clip, seconds.
    pub span: Span,
    /// Similarity 0–1 (1 − cosine distance).
    pub score: f64,
}

/// The matches grouped into one moment per clip: the tapped clip first with its in-view range,
/// then the other clips by their best score; in each clip the best match gives the range and
/// score. At most [`MAX_FIND_HITS`].
pub fn group_hits(this: (&ClipId, Option<Span>), matches: Vec<FindMatch>) -> Vec<FindMatch> {
    let mut best: Vec<FindMatch> = Vec::new();
    for m in matches {
        match best.iter_mut().find(|b| b.clip_id == m.clip_id) {
            Some(b) if m.score > b.score => *b = m,
            Some(_) => {}
            None => best.push(m),
        }
    }
    best.sort_by(|a, b| b.score.total_cmp(&a.score));
    let (clip, view) = this;
    if let Some(pos) = best.iter().position(|b| &b.clip_id == clip) {
        let mut own = best.remove(pos);
        if let Some(v) = view {
            own.span = v;
        }
        best.insert(0, own);
    } else if let Some(v) = view {
        best.insert(
            0,
            FindMatch {
                clip_id: clip.clone(),
                segment_id: None,
                span: v,
                score: 1.0,
            },
        );
    }
    best.truncate(MAX_FIND_HITS);
    best
}

/// The background of a cut-out cover.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CutoutBackground {
    /// A Muse Image scene drawn from the frame without its subject.
    Scene,
    /// The frame itself, blurred.
    Blur,
}

/// An object label as shown: 1 to 3 lowercase words, else `thing`.
pub fn clean_label(raw: &str) -> String {
    let words: Vec<String> = raw
        .split_whitespace()
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '\'')
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .take(3)
        .collect();
    if words.is_empty() {
        "thing".to_owned()
    } else {
        words.join(" ")
    }
}

#[cfg(test)]
mod tests;
