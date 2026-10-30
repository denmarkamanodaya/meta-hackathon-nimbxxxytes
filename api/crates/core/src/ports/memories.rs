//! Memory Lane ports: the session rows and Muse Spark writing and checking a session's lines from
//! its moments, the faces of the people in them and one frame per moment.

use std::path::PathBuf;

use crate::domain::ids::{MemoryId, UserId};
use crate::domain::memory::{LineCheck, Memory, MemoryMoment, WriteAnswer};
use crate::ports::PortResult;

/// Session rows (the moments are kept with the row).
pub trait MemoryStore: Send + Sync {
    /// Inserts a new session.
    fn create<'a>(&'a self, memory: &'a Memory) -> PortResult<'a, ()>;

    /// The session, if it exists.
    fn get<'a>(&'a self, id: &'a MemoryId) -> PortResult<'a, Option<Memory>>;

    /// The user's sessions, newest first.
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Memory>>;

    /// Replaces the stored row with `memory` (title, status, step, moments, counts, cover,
    /// error, `updated_at`); a deleted session is not an error.
    fn save<'a>(&'a self, memory: &'a Memory) -> PortResult<'a, ()>;

    /// Deletes the session; none is not an error.
    fn delete<'a>(&'a self, id: &'a MemoryId) -> PortResult<'a, ()>;
}

/// A face picture of one named person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceImage {
    /// Their name.
    pub name: String,
    /// The JPEG crop on the box.
    pub path: PathBuf,
}

/// What Spark is shown to write or check a session.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryRequest<'a> {
    /// The moments, numbered from 0.
    pub moments: &'a [MemoryMoment],
    /// Who watches; `None` when nobody watching is named.
    pub viewer: Option<&'a str>,
    /// One face per named person present.
    pub faces: &'a [FaceImage],
    /// One JPEG frame per moment, by moment index (same order as `moments`).
    pub frames: &'a [PathBuf],
}

/// Muse Spark writing and checking sessions. Every call answers `MODEL_UNAVAILABLE` on failure,
/// a timeout or an invalid answer.
pub trait MemoryWriter: Send + Sync {
    /// A title and one line plus one gentle question per moment.
    fn write<'a>(&'a self, request: MemoryRequest<'a>) -> PortResult<'a, WriteAnswer>;

    /// Each line of `request.moments` (their `line`) judged against the inputs.
    fn check<'a>(&'a self, request: MemoryRequest<'a>) -> PortResult<'a, Vec<LineCheck>>;
}
