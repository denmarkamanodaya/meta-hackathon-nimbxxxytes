//! MyWay ports: the guide rows, Spark writing the steps and the voice.

use std::path::Path;

use crate::domain::guide::{Guide, GuideDraft, GuideStage, GuideStatus, GuideStep, Safety};
use crate::domain::ids::{ClipId, GuideId, UserId};
use crate::ports::PortResult;

/// A guide's status change.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GuideProgress<'a> {
    /// New status.
    pub status: GuideStatus,
    /// Stage in flight (`None` clears it).
    pub stage: Option<GuideStage>,
    /// Why it failed (`None` clears it).
    pub error: Option<&'a str>,
    /// ISO-8601 UTC.
    pub at: &'a str,
}

/// Spark's verdict and title, stored with the steps.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GuideVerdict<'a> {
    /// The guide's title.
    pub title: &'a str,
    /// The safety label.
    pub safety: Safety,
    /// Spark's reason.
    pub reason: &'a str,
}

/// Guide rows and their steps.
pub trait GuideStore: Send + Sync {
    /// Inserts a guide; `false` (and nothing written) when its clip already has one.
    fn create<'a>(&'a self, guide: &'a Guide) -> PortResult<'a, bool>;

    /// The guide, if it exists.
    fn get<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, Option<Guide>>;

    /// The clip's guide, if it has one.
    fn for_clip<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, Option<Guide>>;

    /// The user's guides, newest first.
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Guide>>;

    /// The guide's steps by number.
    fn steps<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, Vec<GuideStep>>;

    /// Sets status, stage and error.
    fn set_progress<'a>(
        &'a self,
        id: &'a GuideId,
        progress: GuideProgress<'a>,
    ) -> PortResult<'a, ()>;

    /// Stores Spark's verdict and replaces every step with `steps`.
    fn set_plan<'a>(
        &'a self,
        id: &'a GuideId,
        verdict: GuideVerdict<'a>,
        steps: &'a [GuideStep],
    ) -> PortResult<'a, ()>;

    /// Sets the guide's title (already checked).
    fn set_title<'a>(&'a self, id: &'a GuideId, title: &'a str, at: &'a str) -> PortResult<'a, ()>;

    /// Replaces one step's row (texts and files).
    fn put_step<'a>(&'a self, id: &'a GuideId, step: &'a GuideStep) -> PortResult<'a, ()>;

    /// Deletes the guide and its steps; none is not an error.
    fn delete<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, ()>;
}

/// What Spark is shown to write a guide.
#[derive(Debug, Clone, PartialEq)]
pub struct GuideRequest<'a> {
    /// The clip's 360p copy.
    pub video: &'a Path,
    /// Clip length, seconds.
    pub duration_s: f64,
    /// The clip's speech, one `[start–end] text` line per turn (`(no speech)` when none).
    pub transcript: String,
}

/// Writes a guide's steps from its clip.
pub trait GuideWriter: Send + Sync {
    /// Spark's schema-checked answer. `MODEL_UNAVAILABLE` on failure or an invalid answer.
    fn write_steps<'a>(&'a self, request: &'a GuideRequest<'a>) -> PortResult<'a, GuideDraft>;
}

/// Speaks a sentence.
pub trait Narrator: Send + Sync {
    /// 16 kHz mono 16-bit PCM WAV bytes of `text`. `VALIDATION_FAILED` when nothing in `text`
    /// can be spoken; `INTERNAL` when the model fails.
    fn speak<'a>(&'a self, text: &'a str) -> PortResult<'a, Vec<u8>>;
}
