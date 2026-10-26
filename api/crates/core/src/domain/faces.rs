//! Face tracks from per-frame detections: filtering, best frame, coordinate scaling and crops.

use crate::domain::segmenting::Span;

/// Smallest kept box side, as a share of the frame's long edge (faces in POV street footage are
/// tiny, so an area rule drops real faces).
pub const MIN_SIDE_SHARE: f64 = 0.015;
/// Lowest kept detection confidence.
pub const MIN_CONFIDENCE: f64 = 0.5;
/// A track must be seen in at least this many frames.
pub const MIN_FRAMES: usize = 2;
/// Padding around a face box, as a share of the box's longer side, on each side.
pub const CROP_PAD: f64 = 0.20;
/// Output crop size, pixels (square).
pub const CROP_PX: u32 = 256;

/// An axis-aligned box in pixels of a `frame_w` × `frame_h` frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoxPx {
    /// Left.
    pub x1: f64,
    /// Top.
    pub y1: f64,
    /// Right.
    pub x2: f64,
    /// Bottom.
    pub y2: f64,
}

impl BoxPx {
    fn w(self) -> f64 {
        (self.x2 - self.x1).max(0.0)
    }
    fn h(self) -> f64 {
        (self.y2 - self.y1).max(0.0)
    }
}

/// One detection of one object in one frame of the 1 fps copy.
#[derive(Debug, Clone, PartialEq)]
pub struct Detection {
    /// Frame index; at 1 fps also the second.
    pub frame: u32,
    /// Object ordinal; the same person keeps it across frames.
    pub ordinal: u32,
    /// Box in frame pixels.
    pub bbox: BoxPx,
    /// Frame width the box refers to.
    pub frame_w: u32,
    /// Frame height the box refers to.
    pub frame_h: u32,
    /// Confidence 0–1 (1 when the model gave none).
    pub conf: f64,
}

/// One person within one clip.
#[derive(Debug, Clone, PartialEq)]
pub struct FaceTrack {
    /// Object ordinal from the tracker.
    pub ordinal: u32,
    /// First second seen.
    pub first_s: f64,
    /// Last second seen (inclusive frame start).
    pub last_s: f64,
    /// The detection the crop is cut from.
    pub best: Detection,
    /// Largest box area seen, as a share of the frame.
    pub max_area: f64,
}

impl FaceTrack {
    /// Time the track covers: `[first_s, last_s + 1)` at 1 fps.
    pub fn span(&self) -> Span {
        Span {
            start_s: self.first_s,
            end_s: self.last_s + 1.0,
        }
    }
}

fn keep(d: &Detection) -> bool {
    let long_edge = f64::from(d.frame_w.max(d.frame_h));
    let min_side = d.bbox.w().min(d.bbox.h());
    d.conf >= MIN_CONFIDENCE && long_edge > 0.0 && min_side >= MIN_SIDE_SHARE * long_edge
}

/// Score for the best crop: box area share × centredness (1 at the centre, 0 at a corner) × conf.
pub fn best_frame_score(d: &Detection) -> f64 {
    let (fw, fh) = (f64::from(d.frame_w), f64::from(d.frame_h));
    if fw <= 0.0 || fh <= 0.0 {
        return 0.0;
    }
    let area = d.bbox.w() * d.bbox.h() / (fw * fh);
    let (cx, cy) = (
        (d.bbox.x1 + d.bbox.x2) / 2.0 / fw,
        (d.bbox.y1 + d.bbox.y2) / 2.0 / fh,
    );
    let off_centre = ((cx - 0.5).powi(2) + (cy - 0.5).powi(2)).sqrt() / 0.5_f64.hypot(0.5);
    area * (1.0 - off_centre).max(0.0) * d.conf
}

/// Groups kept detections by ordinal into tracks seen in at least two frames, ordered by ordinal.
pub fn tracks(detections: &[Detection]) -> Vec<FaceTrack> {
    let mut by_ordinal: std::collections::BTreeMap<u32, Vec<&Detection>> = Default::default();
    for d in detections.iter().filter(|d| keep(d)) {
        by_ordinal.entry(d.ordinal).or_default().push(d);
    }
    by_ordinal
        .into_iter()
        .filter_map(|(ordinal, ds)| {
            let frames: std::collections::BTreeSet<u32> = ds.iter().map(|d| d.frame).collect();
            if frames.len() < MIN_FRAMES {
                return None;
            }
            let best = ds
                .iter()
                .max_by(|a, b| best_frame_score(a).total_cmp(&best_frame_score(b)))?;
            let max_area = ds
                .iter()
                .map(|d| d.bbox.w() * d.bbox.h() / f64::from(d.frame_w * d.frame_h).max(1.0))
                .fold(0.0, f64::max);
            Some(FaceTrack {
                ordinal,
                first_s: f64::from(*frames.first()?),
                last_s: f64::from(*frames.last()?),
                best: (*best).clone(),
                max_area,
            })
        })
        .collect()
}

/// A square crop in target-frame pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CropRect {
    /// Left.
    pub x: u32,
    /// Top.
    pub y: u32,
    /// Side length.
    pub side: u32,
}

/// A crop of one frame: the instant and the square.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameCrop {
    /// Frame time in seconds.
    pub at_s: f64,
    /// Square in frame pixels.
    pub rect: CropRect,
}

/// Maps `d`'s box onto a `target_w` × `target_h` frame (e.g. the 720p proxy), pads it by 20 % of
/// its longer side, squares it and shifts or shrinks it so it stays inside the frame.
pub fn crop_rect(d: &Detection, target_w: u32, target_h: u32) -> CropRect {
    let sx = f64::from(target_w) / f64::from(d.frame_w.max(1));
    let sy = f64::from(target_h) / f64::from(d.frame_h.max(1));
    let (x1, y1, x2, y2) = (
        d.bbox.x1 * sx,
        d.bbox.y1 * sy,
        d.bbox.x2 * sx,
        d.bbox.y2 * sy,
    );
    let long = (x2 - x1).max(y2 - y1);
    let max_side = f64::from(target_w.min(target_h));
    let side = (long * (1.0 + 2.0 * CROP_PAD))
        .clamp(1.0, max_side.max(1.0))
        .floor();
    let (cx, cy) = ((x1 + x2) / 2.0, (y1 + y2) / 2.0);
    let x = (cx - side / 2.0)
        .clamp(0.0, f64::from(target_w) - side)
        .floor();
    let y = (cy - side / 2.0)
        .clamp(0.0, f64::from(target_h) - side)
        .floor();
    // Values are clamped to the frame, so the conversions cannot overflow.
    CropRect {
        x: x as u32,
        y: y as u32,
        side: side as u32,
    }
}

#[cfg(test)]
mod tests;
