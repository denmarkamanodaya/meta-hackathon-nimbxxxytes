//! Model-backed understanding: segment facts, face tracking, embeddings.

use std::path::{Path, PathBuf};

use crate::domain::faces::Detection;
use crate::domain::facts::SegmentFacts;
use crate::ports::PortResult;

/// One segment to describe.
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentPrompt {
    /// Local 360p snippet of the segment (sent inline; its bytes key the model cache).
    pub snippet: PathBuf,
    /// Start in clip seconds.
    pub start_s: f64,
    /// End in clip seconds.
    pub end_s: f64,
    /// Recording time shown to the model (`unknown` when not known).
    pub recorded_at: String,
    /// Speech in the window, at most 600 characters, or `(none)`.
    pub transcript: String,
    /// Validation error of the previous answer, appended so the model can fix it.
    pub previous_error: Option<String>,
}

/// One model answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FactsAttempt {
    /// Valid against the schema.
    Valid(SegmentFacts),
    /// The answer failed validation (or was not JSON).
    Invalid {
        /// The model's raw text.
        text: String,
        /// Why it failed, for the retry prompt.
        error: String,
    },
}

/// Segment facts from a vision model.
pub trait SegmentDescriber: Send + Sync {
    /// Describes every prompt, running a few calls at a time; answers come back in prompt order.
    /// `MODEL_UNAVAILABLE` when a call fails after its retries.
    fn describe_all<'a>(
        &'a self,
        prompts: &'a [SegmentPrompt],
    ) -> PortResult<'a, Vec<FactsAttempt>>;
}

/// Face detection and tracking over a video.
pub trait FaceTracker: Send + Sync {
    /// Detections of faces in every frame of `video` (the 1 fps copy), ordinal per person.
    fn track_faces<'a>(&'a self, video: &'a Path) -> PortResult<'a, Vec<Detection>>;
}

/// Shared image–text embedding space.
pub trait Embedder: Send + Sync {
    /// L2-normalised embedding of an image file.
    fn embed_image<'a>(&'a self, image: &'a Path) -> PortResult<'a, Vec<f32>>;

    /// L2-normalised embedding of a text query.
    fn embed_text<'a>(&'a self, text: &'a str) -> PortResult<'a, Vec<f32>>;
}
