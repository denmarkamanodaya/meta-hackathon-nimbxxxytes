//! Segments and the transcript rows stored for a clip.

use crate::domain::ids::{ClipId, SegmentId, SpeakerId, TrackId, TurnId};
use crate::domain::segmenting::Span;
use crate::domain::transcript::Turn;
use crate::error::AppError;

/// One 5–10 s window of a clip (facts arrive in a later step).
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    /// Segment id.
    pub id: SegmentId,
    /// Owning clip.
    pub clip_id: ClipId,
    /// 0-based order in the clip.
    pub idx: u32,
    /// Time span in clip seconds.
    pub span: Span,
}

/// A speaker row for one clip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeakerRow {
    /// Speaker id.
    pub id: SpeakerId,
    /// Raw diarization label (`"A"`, …).
    pub label: String,
}

/// A turn row: the turn plus its id and speaker row.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnRow {
    /// Turn id.
    pub id: TurnId,
    /// The turn on the clip timeline.
    pub turn: Turn,
    /// Speaker row, when diarized.
    pub speaker_id: Option<SpeakerId>,
}

/// Everything the transcribe step stores for a clip, replacing any earlier transcript.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TranscriptRows {
    /// Speakers in first-appearance order.
    pub speakers: Vec<SpeakerRow>,
    /// Turns in time order.
    pub turns: Vec<TurnRow>,
    /// Segment ↔ turn overlap links.
    pub links: Vec<(SegmentId, TurnId)>,
}

/// A face track row; re-running the faces step updates it in place and keeps the person link and
/// hidden flag the user set.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackRow {
    /// Track id.
    pub id: TrackId,
    /// Tracker ordinal.
    pub ordinal: u32,
    /// First second seen.
    pub first_s: f64,
    /// Last second seen.
    pub last_s: f64,
    /// Object key of the face crop.
    pub crop_key: String,
    /// Largest box area as a share of the frame.
    pub max_area: f64,
}

/// Track id for tracker ordinal `ordinal` of `clip` (deterministic, as [`segment_id`]).
///
/// # Errors
/// As [`segment_id`].
pub fn track_id(clip: &ClipId, ordinal: u32) -> Result<TrackId, AppError> {
    TrackId::parse(format!("{clip}-f{ordinal}"))
}

/// Segment id for window `idx` of `clip`. Deterministic, so a rerun of the step overwrites the
/// same rows and S3 objects instead of orphaning them.
///
/// # Errors
/// `VALIDATION_FAILED` only for a clip id too long to take the suffix (UUIDv7 ids never are).
pub fn segment_id(clip: &ClipId, idx: u32) -> Result<SegmentId, AppError> {
    SegmentId::parse(format!("{clip}-s{idx}"))
}

/// Turn id for turn `n` of `clip` (deterministic, as [`segment_id`]).
///
/// # Errors
/// As [`segment_id`].
pub fn turn_id(clip: &ClipId, n: u32) -> Result<TurnId, AppError> {
    TurnId::parse(format!("{clip}-t{n}"))
}

/// Speaker id for the `i`-th distinct speaker of `clip` (deterministic, as [`segment_id`]).
///
/// # Errors
/// As [`segment_id`].
pub fn speaker_id(clip: &ClipId, i: usize) -> Result<SpeakerId, AppError> {
    SpeakerId::parse(format!("{clip}-p{i}"))
}
