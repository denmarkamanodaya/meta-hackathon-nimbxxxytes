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

    /// Records that the owner opened the clip at `at` (ISO-8601 UTC).
    fn mark_viewed<'a>(&'a self, id: &'a ClipId, at: &'a str) -> PortResult<'a, ()>;

    /// Stores the clip's title.
    fn set_title<'a>(&'a self, id: &'a ClipId, title: &'a str) -> PortResult<'a, ()>;

    /// Every ready clip (any user), oldest first.
    fn ready_clips(&self) -> PortResult<'_, Vec<ClipId>>;

    /// Every ready clip (any user) that has no title yet.
    fn untitled_ready(&self) -> PortResult<'_, Vec<ClipId>>;

    /// Stores the SHA-256 of a clip's original.
    fn record_hash<'a>(&'a self, id: &'a ClipId, sha256: &'a str) -> PortResult<'a, ()>;

    /// The user's clips whose original has this SHA-256, leaving out failed clips and duplicates.
    fn same_content<'a>(&'a self, user: &'a UserId, sha256: &'a str) -> PortResult<'a, Vec<Clip>>;

    /// Marks `id` a duplicate of `of` (status `duplicate`).
    fn mark_duplicate<'a>(&'a self, id: &'a ClipId, of: &'a ClipId) -> PortResult<'a, ()>;

    /// Every ready clip (any user) whose original has no hash yet, oldest first. Clips still
    /// ingesting are left out: the hash job shares their scratch directory and would remove it.
    fn unhashed(&self) -> PortResult<'_, Vec<ClipId>>;

    /// The user's clip with this file name and size, leaving out failed clips and duplicates;
    /// the oldest when several match.
    fn same_upload<'a>(
        &'a self,
        user: &'a UserId,
        filename: &'a str,
        size_bytes: u64,
    ) -> PortResult<'a, Option<Clip>>;

    /// Deletes the clip and every row about it (its upload row, then the clip; the rest
    /// cascades).
    fn delete_clip<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, ()>;

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

    /// Sets a clip's segments: upserts the listed ones by id (so links to them, such as shorts'
    /// picks, survive) and deletes those no longer listed, with anything linked to them.
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

    /// Search candidates for `ids` that belong to `user` and are not in a duplicate clip (others
    /// are left out), in no order.
    fn candidates<'a>(
        &'a self,
        user: &'a UserId,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<Candidate>>;
}
