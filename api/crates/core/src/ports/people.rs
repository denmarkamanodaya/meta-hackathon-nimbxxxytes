//! Naming people (face tracks) and speakers.

use crate::domain::ids::{PersonId, SegmentId, SpeakerId, TrackId, UserId};
use crate::domain::index::{SpeakerView, TrackView};
use crate::domain::people::PeopleOverviewRows;
use crate::ports::PortResult;

/// A user's named person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    /// Person id.
    pub id: PersonId,
    /// Name as the user typed it (trimmed).
    pub name: String,
}

/// Change to a face track; `None` leaves the field as it is.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrackUpdate {
    /// New linked person.
    pub person: Option<PersonId>,
    /// New hidden flag.
    pub hidden: Option<bool>,
}

/// People, face-track names and speaker names.
pub trait PeopleStore: Send + Sync {
    /// The user's named people, unnamed visible tracks and hidden tracks (any order), counting
    /// nothing from duplicate clips.
    fn overview<'a>(&'a self, user: &'a UserId) -> PortResult<'a, PeopleOverviewRows>;

    /// Names of the user's people, and the display names of their named speakers (distinct).
    fn known_names<'a>(&'a self, user: &'a UserId) -> PortResult<'a, (Vec<String>, Vec<String>)>;

    /// The user's people whose name starts with `prefix` (case-insensitive), by name.
    fn people_with_prefix<'a>(
        &'a self,
        user: &'a UserId,
        prefix: &'a str,
        limit: u32,
    ) -> PortResult<'a, Vec<Person>>;

    /// Returns the user's person called `name` (case-insensitive), creating it with `new_id`.
    fn upsert_person<'a>(
        &'a self,
        user: &'a UserId,
        new_id: &'a PersonId,
        name: &'a str,
    ) -> PortResult<'a, PersonId>;

    /// Owner of the track's clip, `None` when no such track exists.
    fn track_owner<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Option<UserId>>;

    /// Applies an update to a track.
    fn update_track<'a>(&'a self, id: &'a TrackId, update: &'a TrackUpdate) -> PortResult<'a, ()>;

    /// The track as the clip screen shows it.
    fn track<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Option<TrackView>>;

    /// Segments the track appears in.
    fn track_segments<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Vec<SegmentId>>;

    /// Owner of the speaker's clip, `None` when no such speaker exists.
    fn speaker_owner<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Option<UserId>>;

    /// Sets a speaker's display name.
    fn rename_speaker<'a>(&'a self, id: &'a SpeakerId, name: &'a str) -> PortResult<'a, ()>;

    /// The speaker as the clip screen shows it.
    fn speaker<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Option<SpeakerView>>;

    /// Segments where the speaker is heard.
    fn speaker_segments<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Vec<SegmentId>>;
}
