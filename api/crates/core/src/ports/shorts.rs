//! Shorts storage and the video renderer.

use crate::domain::critique::Critique;
use crate::domain::ids::{SegmentId, ShortId, UserId};
use crate::domain::render::{Quality, ShortProps};
use crate::domain::short::{NewStep, Short, ShortSegment, ShortStatus, Step, Version};
use crate::domain::timeline::Timeline;
use crate::keys::ObjectKey;
use crate::ports::PortResult;

/// Shorts, their picked moments, versions and step log.
pub trait ShortStore: Send + Sync {
    /// Owner of each listed segment that exists (unknown ids are left out).
    fn segment_owners<'a>(
        &'a self,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<(SegmentId, UserId)>>;

    /// Stores a new short and its picked moments in pick order.
    fn create<'a>(&'a self, short: &'a Short, segments: &'a [SegmentId]) -> PortResult<'a, ()>;

    /// The user's shorts, newest first.
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Short>>;

    /// The short, if it exists.
    fn get<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Option<Short>>;

    /// The picked moments in pick order, with their clips' overlapping speech turns.
    fn segments<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<ShortSegment>>;

    /// The listed moments of `user` that exist outside duplicate clips, with their speech turns
    /// (others are left out).
    fn moments<'a>(
        &'a self,
        user: &'a UserId,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<ShortSegment>>;

    /// Every moment id of `user`'s library, duplicates left out.
    fn library<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<SegmentId>>;

    /// Appends moments to the short's picks (moments the planner found); known ones are skipped.
    fn add_segments<'a>(&'a self, id: &'a ShortId, segments: &'a [SegmentId])
    -> PortResult<'a, ()>;

    /// Stores version `n`; `n` must not exist yet.
    fn add_version<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        timeline: &'a Timeline,
    ) -> PortResult<'a, ()>;

    /// Versions in order.
    fn versions<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<Version>>;

    /// Records the preview MP4 of version `n`.
    fn set_preview<'a>(&'a self, id: &'a ShortId, n: u32, key: &'a ObjectKey)
    -> PortResult<'a, ()>;

    /// Records the critique of version `n`; its total becomes the version's score.
    fn set_critique<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        critique: &'a Critique,
    ) -> PortResult<'a, ()>;

    /// Sets the status.
    fn set_status<'a>(&'a self, id: &'a ShortId, status: ShortStatus) -> PortResult<'a, ()>;

    /// Sets the best version.
    fn set_best_version<'a>(&'a self, id: &'a ShortId, n: u32) -> PortResult<'a, ()>;

    /// Sets the final render and the version it shows, or clears it.
    fn set_render<'a>(
        &'a self,
        id: &'a ShortId,
        render: Option<(&'a ObjectKey, u32)>,
    ) -> PortResult<'a, ()>;

    /// Appends a step and returns its 0-based position.
    fn add_step<'a>(&'a self, id: &'a ShortId, step: &'a NewStep) -> PortResult<'a, u32>;

    /// The log in order.
    fn steps<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<Step>>;

    /// Removes the short with its picks, versions and step log. A missing short is not an error.
    /// Later writes for it fail and never bring it back.
    fn delete<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, ()>;
}

/// What a render produced.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderOutput {
    /// Video length, seconds.
    pub duration_s: f64,
    /// File size.
    pub bytes: u64,
}

/// Turns composition props into an MP4 uploaded to `out_url`.
pub trait Renderer: Send + Sync {
    /// Renders and uploads. `RENDER_FAILED` on any failure or timeout.
    fn render<'a>(
        &'a self,
        props: &'a ShortProps,
        quality: Quality,
        out_url: &'a str,
    ) -> PortResult<'a, RenderOutput>;
}
