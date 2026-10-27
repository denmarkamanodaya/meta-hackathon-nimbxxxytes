//! Model-backed understanding: segment facts, face tracking, embeddings.

use std::path::{Path, PathBuf};

use crate::domain::critique::Critique;
use crate::domain::faces::Detection;
use crate::domain::facts::SegmentFacts;
use crate::domain::ids::SegmentId;
use crate::domain::search::{Candidate, Rewritten};
use crate::domain::short::{MomentCard, ShortSegment};
use crate::domain::timeline::{Aspect, Timeline};
use crate::ports::{BoxFuture, PortResult};

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

/// What the query rewrite sees.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteRequest {
    /// The user's words.
    pub query: String,
    /// Today as `YYYY-MM-DD (Weekday)` (for relative dates).
    pub today: String,
    /// Names the user has given to people.
    pub people: Vec<String>,
    /// Names the user has given to speakers.
    pub speakers: Vec<String>,
}

/// Purposes model calls are logged under (the cost log groups and filters by them).
pub mod purpose {
    /// Search query rewrite.
    pub const QUERY_REWRITE: &str = "query_rewrite";
    /// Search rerank.
    pub const RERANK: &str = "rerank";
    /// Clip title.
    pub const CLIP_TITLE: &str = "clip_title";
    /// Whether two face crops show the same individual.
    pub const FACE_MATCH: &str = "face_match";
}

/// Writes a short title for a clip.
pub trait Titler: Send + Sync {
    /// A raw title from the clip's segment descriptions (cleaned by the caller).
    /// `MODEL_UNAVAILABLE` on failure or an invalid answer.
    fn title<'a>(&'a self, descriptions: &'a [String]) -> PortResult<'a, String>;
}

/// Language-model reasoning over search requests.
pub trait Reasoner: Send + Sync {
    /// Keywords and filters for a request. `MODEL_UNAVAILABLE` on failure or an invalid answer.
    fn rewrite<'a>(&'a self, request: &'a RewriteRequest) -> PortResult<'a, Rewritten>;

    /// The best candidates for `query`, best first, each with a short reason.
    /// `MODEL_UNAVAILABLE` on failure, timeout or an invalid answer.
    fn rerank<'a>(
        &'a self,
        query: &'a str,
        candidates: &'a [Candidate],
    ) -> PortResult<'a, Vec<(SegmentId, String)>>;

    /// The review of a rendered preview. `MODEL_UNAVAILABLE` on failure or an invalid answer.
    fn critique<'a>(&'a self, request: &'a CritiqueRequest<'a>) -> PortResult<'a, Critique>;

    /// A timeline cutting `request.segments` into one short. Only listed segment ids can come
    /// back; times are not yet clamped. `MODEL_UNAVAILABLE` on failure or an invalid answer.
    fn plan_edit<'a>(&'a self, request: &'a PlanRequest<'a>) -> PortResult<'a, Timeline>;
}

/// What the planner is asked to cut.
#[derive(Clone, Copy)]
pub struct PlanRequest<'a> {
    /// The owner's words; may be empty.
    pub prompt: &'a str,
    /// Output frame.
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// The picked moments, in pick order.
    pub segments: &'a [ShortSegment],
    /// The version being revised and its critique; `None` for a first version.
    pub previous: Option<Previous<'a>>,
    /// Why the planner's last answer was refused, for its one retry.
    pub rejection: Option<&'a str>,
    /// Ids the answer may cut: the picked moments plus any the tools can find.
    pub allowed_ids: &'a [SegmentId],
    /// Library lookups the planner may call before answering; `None` offers no tools.
    pub tools: Option<&'a dyn PlannerTools>,
}

/// A library lookup the planner asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannerToolCall {
    /// `search_moments`: moments matching a description.
    SearchMoments {
        /// What to look for.
        query: String,
    },
    /// `get_segment`: one moment's details.
    GetSegment {
        /// The moment.
        segment_id: String,
    },
}

/// Answers the planner's lookups (implemented by the agent, which logs and budgets each call).
pub trait PlannerTools: Send + Sync {
    /// The moments found, or a message telling the planner what went wrong.
    fn call<'a>(&'a self, call: PlannerToolCall) -> BoxFuture<'a, Result<Vec<MomentCard>, String>>;
}

/// The version a revision starts from.
#[derive(Debug, Clone, Copy)]
pub struct Previous<'a> {
    /// Its timeline.
    pub timeline: &'a Timeline,
    /// Its critique (the notes a revision must cite).
    pub critique: &'a Critique,
}

/// What the critic is asked to review.
#[derive(Debug, Clone, Copy)]
pub struct CritiqueRequest<'a> {
    /// The preview MP4 on local disk (sent inline).
    pub video: &'a Path,
    /// Version number reviewed.
    pub version: u32,
    /// The owner's words; may be empty.
    pub prompt: &'a str,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// The version's timeline.
    pub timeline: &'a Timeline,
    /// The picked moments.
    pub segments: &'a [ShortSegment],
}
