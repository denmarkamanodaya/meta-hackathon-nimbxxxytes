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
/// Long edge of the proxy and the 1 fps copy, pixels (ffmpeg scales both to it).
pub const PROXY_LONG_EDGE_PX: u32 = 1280;
/// Smallest short side a track's best box may have in proxy pixels: a smaller face upscaled to
/// [`CROP_PX`] is unrecognisable, so the track is dropped instead of showing a blur.
pub const MIN_CROP_SOURCE_PX: f64 = 64.0;
/// Width-to-height range of a face box. SAM sometimes returns one wide box over a row of faces
/// (seen up to 10.9:1 on a party clip); such a box is no single face and would win the crop.
pub const FACE_ASPECT: std::ops::RangeInclusive<f64> = 0.5..=1.6;
/// SAM can carry one object number across a hard cut onto someone else, so one number is split
/// into runs: a run ends when the object is unseen for more than this many frames (seconds),
pub const MAX_GAP_FRAMES: u32 = 2;
/// or its box centre moves more than this many box sizes between two sightings,
pub const MAX_JUMP_BOXES: f64 = 1.5;
/// or its box grows or shrinks by more than this factor.
pub const MAX_SIZE_CHANGE: f64 = 2.0;

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
    /// SAM's object number. It usually follows one person, but not across hard cuts.
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
    /// Track number within the clip (0, 1, …): SAM's object numbers in order, each split into
    /// its continuous runs.
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
    let aspect = if d.bbox.h() > 0.0 {
        d.bbox.w() / d.bbox.h()
    } else {
        0.0
    };
    d.conf >= MIN_CONFIDENCE
        && long_edge > 0.0
        && min_side >= MIN_SIDE_SHARE * long_edge
        && FACE_ASPECT.contains(&aspect)
}

/// Whether `next` continues the run that `prev` ends: seen again soon, near where it was, at a
/// similar size.
fn continues(prev: &Detection, next: &Detection) -> bool {
    let centre = |d: &Detection| ((d.bbox.x1 + d.bbox.x2) / 2.0, (d.bbox.y1 + d.bbox.y2) / 2.0);
    let size = |d: &Detection| d.bbox.w().max(d.bbox.h()).max(1.0);
    let ((px, py), (nx, ny)) = (centre(prev), centre(next));
    let jump = (nx - px).hypot(ny - py);
    let ratio = size(next) / size(prev);
    next.frame.saturating_sub(prev.frame) <= MAX_GAP_FRAMES
        && jump <= MAX_JUMP_BOXES * size(prev).max(size(next))
        && (1.0 / MAX_SIZE_CHANGE..=MAX_SIZE_CHANGE).contains(&ratio)
}

/// Splits one object's detections (any order) into continuous runs, in time order.
fn runs(mut ds: Vec<&Detection>) -> Vec<Vec<&Detection>> {
    ds.sort_by_key(|d| d.frame);
    let mut out: Vec<Vec<&Detection>> = Vec::new();
    for d in ds {
        match out.last_mut() {
            Some(run) if run.last().is_some_and(|prev| continues(prev, d)) => run.push(d),
            _ => out.push(vec![d]),
        }
    }
    out
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

/// Short side of `d`'s box in proxy pixels (frames are scaled so their long edge is
/// [`PROXY_LONG_EDGE_PX`]).
pub fn proxy_short_side(d: &Detection) -> f64 {
    let long_edge = f64::from(d.frame_w.max(d.frame_h).max(1));
    d.bbox.w().min(d.bbox.h()) * f64::from(PROXY_LONG_EDGE_PX) / long_edge
}

/// Groups kept detections by SAM object number, splits each into continuous runs, and keeps the
/// runs seen in at least two frames whose best box is big enough to crop. Tracks are numbered in
/// order of object number, then time.
pub fn tracks(detections: &[Detection]) -> Vec<FaceTrack> {
    track_runs(detections).into_iter().map(|(t, _)| t).collect()
}

/// [`tracks`], each with the kept detections of its run in time order (the boxes the privacy
/// blur follows).
pub fn track_runs(detections: &[Detection]) -> Vec<(FaceTrack, Vec<Detection>)> {
    let mut by_ordinal: std::collections::BTreeMap<u32, Vec<&Detection>> = Default::default();
    for d in detections.iter().filter(|d| keep(d)) {
        by_ordinal.entry(d.ordinal).or_default().push(d);
    }
    by_ordinal
        .into_values()
        .flat_map(runs)
        .filter_map(|run| Some((track(&run)?, run.into_iter().cloned().collect())))
        .zip(0u32..)
        .map(|((t, run), number)| {
            (
                FaceTrack {
                    ordinal: number,
                    ..t
                },
                run,
            )
        })
        .collect()
}

/// One run as a track (numbered later), or `None` when too short or too small to crop.
fn track(run: &[&Detection]) -> Option<FaceTrack> {
    let frames: std::collections::BTreeSet<u32> = run.iter().map(|d| d.frame).collect();
    if frames.len() < MIN_FRAMES {
        return None;
    }
    let best = run
        .iter()
        .max_by(|a, b| best_frame_score(a).total_cmp(&best_frame_score(b)))?;
    if proxy_short_side(best) < MIN_CROP_SOURCE_PX {
        return None;
    }
    let max_area = run
        .iter()
        .map(|d| d.bbox.w() * d.bbox.h() / f64::from(d.frame_w * d.frame_h).max(1.0))
        .fold(0.0, f64::max);
    Some(FaceTrack {
        ordinal: 0,
        first_s: f64::from(*frames.first()?),
        last_s: f64::from(*frames.last()?),
        best: (*best).clone(),
        max_area,
    })
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
