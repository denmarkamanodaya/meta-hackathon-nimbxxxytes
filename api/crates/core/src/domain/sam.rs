//! SAM 3.1 segmentation as the core sees it: the prompt (a phrase, a tapped point or a box), the
//! media it runs on (a video or one image), and the records it returns (a box per object per
//! frame, a steady object id and the object's mask). The mask is kept opaque: only the renderer
//! decodes it.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::domain::faces::BoxPx;

/// Most objects one point or box prompt may name (a SAM limit).
pub const MAX_PROMPTED_OBJECTS: u32 = 16;

/// How a mask payload is encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaskEncoding {
    /// `~` payloads (SAM's default for phrase prompts).
    Lossless,
    /// `!` payloads (point and box prompts always answer with these).
    OneBit,
}

/// One object's mask in one frame. The `height` × `width` raster covers the record's box (its
/// top-left is the box's x1, y1), not the frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaskRef {
    /// `lossless` or `one_bit`, read from the payload's first character.
    pub encoding: MaskEncoding,
    /// Raster width, pixels.
    pub width: u32,
    /// Raster height, pixels.
    pub height: u32,
    /// The encoded raster exactly as SAM sent it, its leading `~` or `!` included.
    pub payload: String,
}

/// One object in one frame.
#[derive(Debug, Clone, PartialEq)]
pub struct SamRecord {
    /// Frame index of the media SAM saw (0 for an image).
    pub frame: u32,
    /// SAM's object id; steady while the object stays in view.
    pub id: u32,
    /// Box in frame pixels (x2, y2 inclusive).
    pub bbox: BoxPx,
    /// Frame width the box refers to.
    pub frame_w: u32,
    /// Frame height the box refers to.
    pub frame_h: u32,
    /// Confidence 0–1 (1 when the model gave none).
    pub conf: f64,
    /// The object's mask, when the record carried one.
    pub mask: Option<MaskRef>,
}

impl SamRecord {
    /// Box area in pixels.
    pub fn area(&self) -> f64 {
        (self.bbox.x2 - self.bbox.x1).max(0.0) * (self.bbox.y2 - self.bbox.y1).max(0.0)
    }
}

/// What to segment.
#[derive(Debug, Clone, PartialEq)]
pub enum SamPrompt {
    /// Every object a short phrase names ("screen", "license plate", "dog").
    Concept(String),
    /// The object under one point of frame `frame`, in integer pixels of a `w` × `h` frame.
    Point {
        /// Frame index.
        frame: u32,
        /// Id given to the object.
        id: u32,
        /// Point, pixels from the left.
        x: u32,
        /// Point, pixels from the top.
        y: u32,
        /// Frame width, pixels.
        w: u32,
        /// Frame height, pixels.
        h: u32,
    },
    /// The object inside one box of frame `frame` (x2, y2 inclusive).
    Boxed {
        /// Frame index.
        frame: u32,
        /// Id given to the object.
        id: u32,
        /// Box, pixels.
        bbox: (u32, u32, u32, u32),
        /// Frame width, pixels.
        w: u32,
        /// Frame height, pixels.
        h: u32,
    },
}

/// Which way a point or box prompt follows the object through a video.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Propagation {
    /// Before and after the prompted frame.
    Both,
    /// From the prompted frame on.
    Forward,
    /// Up to the prompted frame.
    Backward,
}

impl Propagation {
    /// Wire text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Both => "both",
            Self::Forward => "forward",
            Self::Backward => "backward",
        }
    }
}

/// The media one request runs on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SamMedia<'a> {
    /// An H.264 MP4 (every frame is billed, at least 50).
    Video(&'a Path),
    /// One JPEG (billed per image).
    Image(&'a Path),
}

/// One segmentation request.
#[derive(Debug, Clone, PartialEq)]
pub struct SamRequest<'a> {
    /// What it runs on.
    pub media: SamMedia<'a>,
    /// What to find.
    pub prompt: SamPrompt,
    /// Set for point and box prompts on a video.
    pub propagation: Option<Propagation>,
    /// What the call is for (the cost log groups by it).
    pub purpose: &'static str,
}

/// The records of the object `id`.
pub fn of_object(records: &[SamRecord], id: u32) -> Vec<SamRecord> {
    records.iter().filter(|r| r.id == id).cloned().collect()
}

/// The largest record (by box area); the earlier one on a tie.
pub fn largest(records: &[SamRecord]) -> Option<&SamRecord> {
    records
        .iter()
        .fold(None, |best: Option<&SamRecord>, r| match best {
            Some(b) if b.area() >= r.area() => Some(b),
            _ => Some(r),
        })
}

/// The id of the track to follow: seen in the most frames, then the largest mean box area, then
/// the lowest id. `None` without records.
pub fn pick_track(records: &[SamRecord]) -> Option<u32> {
    let mut ids: Vec<u32> = records.iter().map(|r| r.id).collect();
    ids.sort_unstable();
    ids.dedup();
    let score = |id: u32| {
        let mine: Vec<&SamRecord> = records.iter().filter(|r| r.id == id).collect();
        let mut frames: Vec<u32> = mine.iter().map(|r| r.frame).collect();
        frames.sort_unstable();
        frames.dedup();
        let mean = mine.iter().map(|r| r.area()).sum::<f64>() / mine.len().max(1) as f64;
        (frames.len(), mean)
    };
    ids.into_iter()
        .fold(None, |best: Option<(u32, (usize, f64))>, id| {
            let s = score(id);
            match best {
                Some((_, b)) if b.0 > s.0 || (b.0 == s.0 && b.1 >= s.1) => best,
                _ => Some((id, s)),
            }
        })
        .map(|(id, _)| id)
}

/// Clip seconds of frame `frame` of a range proxy cut from `in_s` at `fps` (the proxy's first
/// frame is the frame at `in_s`).
pub fn frame_time(in_s: f64, frame: u32, fps: u32) -> f64 {
    in_s + f64::from(frame) / f64::from(fps.max(1))
}

/// The frame of a `fps` copy of the whole clip that shows clip second `t_s` (the nearest one,
/// never before the first).
pub fn frame_at_time(t_s: f64, fps: u32) -> u32 {
    let f = (t_s.max(0.0) * f64::from(fps.max(1))).round();
    if f >= f64::from(u32::MAX) {
        u32::MAX
    } else {
        f as u32
    }
}

/// A share (0–1) of a `size`-pixel side as an integer pixel inside it.
pub fn to_px(share: f64, size: u32) -> u32 {
    let max = size.saturating_sub(1);
    let v = (share.clamp(0.0, 1.0) * f64::from(size)).floor();
    (v as u32).min(max)
}

#[cfg(test)]
mod tests;
