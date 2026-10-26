//! The search document for one segment, and the read models of the library and clip screens.

use crate::domain::clip::Clip;
use crate::domain::facts::SegmentFacts;
use crate::domain::ids::{ClipId, SegmentId, SpeakerId, TrackId, TurnId, UserId};
use crate::domain::segment::Segment;
use crate::domain::segmenting::Span;

/// Everything the text index stores for one segment.
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentDoc {
    /// Segment id (the document key).
    pub segment_id: SegmentId,
    /// Owning clip.
    pub clip_id: ClipId,
    /// Owner; every search filters on it.
    pub user_id: UserId,
    /// Facts text fields (empty strings when not described yet).
    pub description: String,
    /// Joined actions.
    pub actions: String,
    /// Joined objects.
    pub objects: String,
    /// Place.
    pub place: String,
    /// Mood.
    pub mood: String,
    /// Turn texts overlapping the segment.
    pub transcript: String,
    /// Names of the non-hidden people seen in the segment.
    pub people: String,
    /// Display names of the speakers heard in the segment.
    pub speakers: String,
    /// Clip recording time (ISO-8601 UTC).
    pub recorded_at: Option<String>,
    /// 0–10.
    pub quality: Option<u8>,
    /// 0–10.
    pub hook_score: Option<u8>,
}

/// Which segments to build documents for.
#[derive(Debug, Clone, Copy)]
pub enum DocScope<'a> {
    /// Every segment of a clip.
    Clip(&'a ClipId),
    /// One segment.
    Segment(&'a SegmentId),
}

/// One library row: the clip and what the card shows besides it.
#[derive(Debug, Clone, PartialEq)]
pub struct LibraryRow {
    /// The clip.
    pub clip: Clip,
    /// Number of segments.
    pub segment_count: u32,
    /// First segment, whose thumbnail is the card image.
    pub first_segment: Option<SegmentId>,
    /// Distinct names of the non-hidden people in the clip.
    pub people: Vec<String>,
}

/// A segment with its facts (absent until described).
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentView {
    /// The segment.
    pub segment: Segment,
    /// Facts, once described.
    pub facts: Option<SegmentFacts>,
}

/// A transcript turn as the clip screen shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnView {
    /// Turn id.
    pub id: TurnId,
    /// Time span.
    pub span: Span,
    /// Words.
    pub text: String,
    /// Speaker row.
    pub speaker_id: Option<SpeakerId>,
}

/// A speaker as the clip screen shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpeakerView {
    /// Speaker id.
    pub id: SpeakerId,
    /// Raw label.
    pub label: String,
    /// Name the user gave.
    pub display_name: Option<String>,
}

/// A face track as the clip screen shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct TrackView {
    /// Track id.
    pub id: TrackId,
    /// First second seen.
    pub first_s: f64,
    /// Last second seen.
    pub last_s: f64,
    /// Stored crop object key, once cropped.
    pub crop_key: Option<String>,
    /// Linked person's name.
    pub person_name: Option<String>,
    /// Marked as a bystander.
    pub hidden: bool,
}

/// Everything the clip screen needs from the catalogue.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipDetailRows {
    /// The library row of the clip.
    pub row: LibraryRow,
    /// Segments in time order.
    pub segments: Vec<SegmentView>,
    /// Turns in time order.
    pub turns: Vec<TurnView>,
    /// Speakers.
    pub speakers: Vec<SpeakerView>,
    /// Face tracks by first appearance.
    pub tracks: Vec<TrackView>,
}
