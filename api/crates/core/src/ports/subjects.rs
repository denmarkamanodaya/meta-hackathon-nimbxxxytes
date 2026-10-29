//! SAM 3.1 beyond faces: segmenting a phrase, point or box; what is stored about tracked
//! subjects and tapped objects; naming an object; and the renderer's mask work (the only place
//! masks are decoded).

use std::path::Path;

use crate::domain::ids::{ClipId, ShortId, UserId};
use crate::domain::objects::FindMatch;
use crate::domain::reframe::ShotReframe;
use crate::domain::render::{BoxRect, CutoutRequest, StepStillProps};
use crate::domain::sam::{MaskRef, SamRecord, SamRequest};
use crate::ports::PortResult;

/// Finds, outlines and follows things in a video or an image (separate from the ingest
/// [`crate::ports::FaceTracker`]).
pub trait SubjectTracker: Send + Sync {
    /// Every record SAM returns for `request`, in any frame order. `MODEL_UNAVAILABLE` when the
    /// call fails after retries.
    fn segment<'a>(&'a self, request: &'a SamRequest<'a>) -> PortResult<'a, Vec<SamRecord>>;
}

/// An object tapped in a clip, stored with its vector so later taps find it.
#[derive(Debug, Clone, PartialEq)]
pub struct ObjectTrack {
    /// Row id.
    pub id: String,
    /// The clip.
    pub clip_id: ClipId,
    /// Owner.
    pub user_id: UserId,
    /// Spark's 1–3 word name.
    pub label: String,
    /// The tapped second.
    pub t_s: f64,
    /// First second in view.
    pub start_s: f64,
    /// Last second in view (exclusive).
    pub end_s: f64,
    /// When it was stored, ISO-8601 UTC.
    pub created_at: String,
}

/// Screens-and-plates switch, reframe rows, and tapped objects with their vectors.
pub trait SubjectStore: Send + Sync {
    /// Whether the user blurs screens and number plates in exports.
    fn blur_objects<'a>(&'a self, user: &'a UserId) -> PortResult<'a, bool>;

    /// Turns that switch on or off.
    fn set_blur_objects<'a>(&'a self, user: &'a UserId, on: bool) -> PortResult<'a, ()>;

    /// Every reframe row of the short, any version.
    fn reframes<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Vec<ShotReframe>>;

    /// Inserts or replaces the row of (short, version, moment).
    fn put_reframe<'a>(&'a self, row: &'a ShotReframe) -> PortResult<'a, ()>;

    /// Stores a tapped object and its vector.
    fn put_object<'a>(&'a self, track: &'a ObjectTrack, vector: &'a [f32]) -> PortResult<'a, ()>;

    /// The `k` stored objects of `user` nearest to `vector`, as clip ranges.
    fn nearest_objects<'a>(
        &'a self,
        user: &'a UserId,
        vector: &'a [f32],
        k: u32,
    ) -> PortResult<'a, Vec<FindMatch>>;

    /// The `k` visible face tracks of `user` nearest to `vector`, as clip ranges (face vectors
    /// exist only while face matching is on).
    fn nearest_faces<'a>(
        &'a self,
        user: &'a UserId,
        vector: &'a [f32],
        k: u32,
    ) -> PortResult<'a, Vec<FindMatch>>;
}

/// Names what a crop shows.
pub trait ObjectNamer: Send + Sync {
    /// 1–3 words for the main thing in `crop` (a JPEG). `MODEL_UNAVAILABLE` on failure or an
    /// invalid answer.
    fn name_object<'a>(&'a self, crop: &'a Path) -> PortResult<'a, String>;
}

/// Mask work done by the renderer.
pub trait MaskRenderer: Send + Sync {
    /// The mask's outline as an SVG path in frame pixels (`mask` covers `bbox`). `RENDER_FAILED`
    /// on a bad mask or any failure.
    fn mask_path<'a>(&'a self, mask: &'a MaskRef, bbox: BoxRect) -> PortResult<'a, String>;

    /// Writes the cut-out PNG (or the sticker) to `out_url`. `RENDER_FAILED` on any failure.
    fn cutout<'a>(&'a self, request: &'a CutoutRequest, out_url: &'a str) -> PortResult<'a, ()>;

    /// Writes a guide step's JPEG (the frame with a ring along the outline) to `out_url`.
    /// `RENDER_FAILED` on any failure.
    fn step_still<'a>(&'a self, props: &'a StepStillProps, out_url: &'a str) -> PortResult<'a, ()>;
}
