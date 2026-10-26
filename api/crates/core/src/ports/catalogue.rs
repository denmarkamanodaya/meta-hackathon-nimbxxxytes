//! Users, clips, uploads, segments and transcripts.

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::ids::{ClipId, UploadId, UserId};
use crate::domain::probe::ProbeInfo;
use crate::domain::segment::{Segment, TranscriptRows};
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
}
