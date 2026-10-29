//! Driven ports the core needs from outside. Each is `Send + Sync`, speaks domain types only and
//! returns [`BoxFuture`] so ports can be used as trait objects.

mod brand;
mod catalogue;
mod exports;
mod faces;
mod guides;
mod images;
mod index;
mod jobs;
mod ledger;
mod media;
mod people;
mod privacy;
mod projects;
mod shorts;
mod storage;
mod subjects;
mod understanding;
mod usage;

use std::future::Future;
use std::pin::Pin;

pub use brand::BrandStore;
pub use catalogue::Catalogue;
pub use exports::{ExportStore, PackAnswer, PackRequest, PackWriter};
pub use faces::{FaceMatchStore, FaceMatcher, FacePair, FaceToEmbed};
pub use guides::{GuideProgress, GuideRequest, GuideStore, GuideVerdict, GuideWriter, Narrator};
pub use images::{ArtRequest, CoverRequest, ImageMaker, RedrawRequest, SceneRequest};
pub use index::{TextIndex, VectorIndex};
pub use jobs::{JobFailure, JobQueue, NewJob, ProgressSink, StepRunner};
pub use ledger::{CacheEntry, ModelLedger};
pub use media::{MediaTool, Transcriber};
pub use people::{PeopleStore, Person, TrackUpdate};
pub use privacy::PrivacyStore;
pub use projects::ProjectStore;
pub use shorts::{RenderOutput, Renderer, ShortStore};
pub use storage::{BlobStore, PutFile, Scratch};
pub use subjects::{MaskRenderer, ObjectNamer, ObjectTrack, SubjectStore, SubjectTracker};
pub use understanding::{
    CritiqueRequest, Embedder, FaceTracker, FactsAttempt, IntentReader, PlanRequest,
    PlannerToolCall, PlannerTools, Previous, Reasoner, RewriteRequest, SegmentDescriber,
    SegmentPrompt, Titler, purpose,
};
pub use usage::{MeasuredUsage, UsageStore};

/// Wall-clock instant as milliseconds since the Unix epoch (UTC).
pub type EpochMillis = i64;

/// Boxed, sendable future returned by async port methods.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Result of a port call.
pub type PortResult<'a, T> = BoxFuture<'a, Result<T, crate::AppError>>;

/// Source of the current time; the only way core code learns "now".
pub trait Clock: Send + Sync {
    /// Returns the current instant in milliseconds since the Unix epoch (UTC).
    fn now_millis(&self) -> EpochMillis;
}

/// Source of new unique ids (UUIDv7 text in production, so ids sort by creation time).
pub trait IdGenerator: Send + Sync {
    /// Returns a new id that sorts after every id this generator returned before.
    fn new_id(&self) -> String;
}
