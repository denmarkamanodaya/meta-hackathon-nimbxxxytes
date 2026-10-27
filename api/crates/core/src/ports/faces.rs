//! Opt-in face matching: the per-user switch, face vectors, and Spark's verdicts on pairs.

use std::path::Path;

use crate::domain::face_match::{FaceLink, FaceVerdict, NamedTrack};
use crate::domain::ids::{ClipId, TrackId, UserId};
use crate::ports::PortResult;

/// A visible face track that has a crop but no vector yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceToEmbed {
    /// Track.
    pub track: TrackId,
    /// Its clip.
    pub clip: ClipId,
    /// Stored key of its crop.
    pub crop_key: String,
}

/// Two tracks whose vectors are close and that Spark has not judged yet.
#[derive(Debug, Clone, PartialEq)]
pub struct FacePair {
    /// One track (the smaller id) and its crop key.
    pub a: (TrackId, String),
    /// The other track and its crop key.
    pub b: (TrackId, String),
    /// Cosine similarity of their vectors.
    pub similarity: f64,
}

/// The switch, the vectors and the verdicts. Hidden tracks and tracks of duplicate clips never
/// take part.
pub trait FaceMatchStore: Send + Sync {
    /// Whether the user turned face matching on.
    fn matching<'a>(&'a self, user: &'a UserId) -> PortResult<'a, bool>;

    /// Turns the switch on or off. Off deletes the user's vectors and verdicts in the same
    /// transaction.
    fn set_matching<'a>(&'a self, user: &'a UserId, on: bool) -> PortResult<'a, ()>;

    /// The user's visible tracks with a crop and no vector, outside duplicate clips.
    fn unembedded<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<FaceToEmbed>>;

    /// Stores a track's vector; does nothing when the user's switch is off.
    fn put_vector<'a>(
        &'a self,
        track: &'a TrackId,
        user: &'a UserId,
        vector: &'a [f32],
    ) -> PortResult<'a, ()>;

    /// Unjudged pairs of the user's tracks whose vectors have cosine similarity of at least
    /// `min_similarity`, looking at the `k` nearest of each, most similar first.
    fn proposals<'a>(
        &'a self,
        user: &'a UserId,
        min_similarity: f64,
        k: u32,
    ) -> PortResult<'a, Vec<FacePair>>;

    /// Stores Spark's verdict on a pair; does nothing when the user's switch is off.
    fn put_verdict<'a>(
        &'a self,
        user: &'a UserId,
        pair: (&'a TrackId, &'a TrackId),
        verdict: &'a FaceVerdict,
    ) -> PortResult<'a, ()>;

    /// Confirmed pairs (same, confidence at least `min_confidence`) whose tracks are both still
    /// visible and outside duplicate clips.
    fn links<'a>(&'a self, user: &'a UserId, min_confidence: f64) -> PortResult<'a, Vec<FaceLink>>;

    /// The user's visible named tracks outside duplicate clips.
    fn named_tracks<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<NamedTrack>>;
}

/// Decides whether two face crops show the same individual.
pub trait FaceMatcher: Send + Sync {
    /// Spark's verdict on crop `a` and crop `b`. `MODEL_UNAVAILABLE` on failure or an invalid
    /// answer.
    fn same_face<'a>(&'a self, a: &'a Path, b: &'a Path) -> PortResult<'a, FaceVerdict>;
}
