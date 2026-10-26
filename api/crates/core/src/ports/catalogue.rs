//! Users, clips, uploads, segments and transcripts.

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::facts::SegmentFacts;
use crate::domain::ids::{ClipId, UploadId, UserId};
use crate::domain::ids::{SegmentId, TrackId};
use crate::domain::index::{ClipDetailRows, DocScope, LibraryRow, SegmentDoc};
use crate::domain::probe::ProbeInfo;
use crate::domain::search::Candidate;
use crate::domain::segment::{Segment, TrackRow, TranscriptRows};
use crate::domain::upload::Upload;
use crate::error::ErrorCode;
use crate::ports::PortResult;

/// The relational store behind the library.
pub trait Catalogue: Send + Sync {
    /// Returns the demo account's id, creating the row with `new_id` the first time.
    fn demo_user<'a>(&'a self, new_id: &'a UserId, now: &'a str) -> PortResult<'a, UserId>;

    /// Inserts a new clip and its upload in one transaction.
    fn insert_upload<'a>(&'a self, clip: &'a Clip, upload: &'a Upload) -> PortResult<'a, ()>;

    /// Looks up an upload by our id.
    fn get_upload<'a>(&'a self, id: &'a UploadId) -> PortResult<'a, Option<Upload>>;

    /// Marks the upload completed and its clip `uploaded`, in one transaction.
    fn finish_upload<'a>(&'a self, upload: &'a UploadId, clip: &'a ClipId) -> PortResult<'a, ()>;

    /// Lists a user's clips, newest first.
    fn list_clips<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Clip>>;

    /// Looks up one clip.
    fn get_clip<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Option<Clip>>;

    /// Stores the probe facts of a clip.
    fn record_probe<'a>(&'a self, id: &'a ClipId, probe: &'a ProbeInfo) -> PortResult<'a, ()>;

    /// Sets a clip's status; `error` is stored for `failed` and cleared otherwise.
    fn set_clip_status<'a>(
        &'a self,
        id: &'a ClipId,
        status: ClipStatus,
        error: Option<ErrorCode>,
    ) -> PortResult<'a, ()>;

    /// Replaces all segments of a clip (and anything linked to the old ones).
    fn replace_segments<'a>(
        &'a self,
        id: &'a ClipId,
        segments: &'a [Segment],
    ) -> PortResult<'a, ()>;

    /// A clip's segments in time order.
    fn list_segments<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Vec<Segment>>;

    /// Replaces a clip's speakers, turns and segment links in one transaction.
    fn replace_transcript<'a>(
        &'a self,
        id: &'a ClipId,
        rows: &'a TranscriptRows,
    ) -> PortResult<'a, ()>;

    /// Stores the facts of one segment.
    fn set_segment_facts<'a>(
        &'a self,
        id: &'a SegmentId,
        facts: &'a SegmentFacts,
    ) -> PortResult<'a, ()>;

    /// Each segment of a clip with the texts of its linked turns, in time order.
    fn segment_transcripts<'a>(
        &'a self,
        id: &'a ClipId,
    ) -> PortResult<'a, Vec<(SegmentId, Vec<String>)>>;

    /// Upserts a clip's face tracks (keeping user-set names and hidden flags), deletes tracks no
    /// longer found, and replaces the track ↔ segment links.
    fn replace_face_tracks<'a>(
        &'a self,
        id: &'a ClipId,
        tracks: &'a [TrackRow],
        links: &'a [(TrackId, SegmentId)],
    ) -> PortResult<'a, ()>;

    /// Search documents for a clip's segments or one segment.
    fn index_docs<'a>(&'a self, scope: DocScope<'a>) -> PortResult<'a, Vec<SegmentDoc>>;

    /// The user's library rows, newest first.
    fn library<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<LibraryRow>>;

    /// Everything the clip screen shows; `None` when the clip does not exist.
    fn clip_detail<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Option<ClipDetailRows>>;

    /// Search candidates for `ids` that belong to `user` (others are left out), in no order.
    fn candidates<'a>(
        &'a self,
        user: &'a UserId,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<Candidate>>;
}
