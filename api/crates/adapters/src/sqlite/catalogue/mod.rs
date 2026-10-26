//! [`Catalogue`] on SQLite. Queries live in `uploads.rs` (users, clips, uploads) and `media.rs`
//! (probe facts, status, segments, transcript); this file binds them to the port.

mod media;
mod uploads;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::segment::{Segment, TranscriptRows};
use nimbytes_core::domain::upload::Upload;
use nimbytes_core::ports::{Catalogue, PortResult};
use sqlx::SqlitePool;

/// Catalogue backed by the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteCatalogue {
    pool: SqlitePool,
}

impl SqliteCatalogue {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

impl Catalogue for SqliteCatalogue {
    fn demo_user<'a>(&'a self, new_id: &'a UserId, now: &'a str) -> PortResult<'a, UserId> {
        Box::pin(self.demo_user_row(new_id, now))
    }

    fn insert_upload<'a>(&'a self, clip: &'a Clip, upload: &'a Upload) -> PortResult<'a, ()> {
        Box::pin(self.insert_upload_tx(clip, upload))
    }

    fn get_upload<'a>(&'a self, id: &'a UploadId) -> PortResult<'a, Option<Upload>> {
        Box::pin(self.upload_row(id))
    }

    fn finish_upload<'a>(&'a self, upload: &'a UploadId, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(self.finish_upload_tx(upload, clip))
    }

    fn list_clips<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Clip>> {
        Box::pin(self.clip_rows(user))
    }

    fn get_clip<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Option<Clip>> {
        Box::pin(self.clip_row(id))
    }

    fn record_probe<'a>(&'a self, id: &'a ClipId, probe: &'a ProbeInfo) -> PortResult<'a, ()> {
        Box::pin(self.update_probe(id, probe))
    }

    fn set_clip_status<'a>(
        &'a self,
        id: &'a ClipId,
        status: ClipStatus,
        error: Option<ErrorCode>,
    ) -> PortResult<'a, ()> {
        Box::pin(self.update_status(id, status, error))
    }

    fn replace_segments<'a>(
        &'a self,
        id: &'a ClipId,
        segments: &'a [Segment],
    ) -> PortResult<'a, ()> {
        Box::pin(self.replace_segments_tx(id, segments))
    }

    fn list_segments<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Vec<Segment>> {
        Box::pin(self.segment_rows(id))
    }

    fn replace_transcript<'a>(
        &'a self,
        id: &'a ClipId,
        rows: &'a TranscriptRows,
    ) -> PortResult<'a, ()> {
        Box::pin(self.replace_transcript_tx(id, rows))
    }
}

#[cfg(test)]
mod tests;
