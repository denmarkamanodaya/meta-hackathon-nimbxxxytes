//! [`Catalogue`] on SQLite. Queries live in `uploads.rs` (users, clips, uploads) and `media.rs`
//! (probe facts, status, segments, transcript); this file binds them to the port.

mod duplicates;
mod faces;
mod media;
mod moments;
mod people;
mod people_overview;
mod titles;
mod understanding;
mod uploads;
mod views;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::facts::SegmentFacts;
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::ids::{SegmentId, TrackId};
use nimbytes_core::domain::index::{ClipDetailRows, DocScope, LibraryRow, SegmentDoc};
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::search::Candidate;
use nimbytes_core::domain::segment::{Segment, TrackRow, TranscriptRows};
use nimbytes_core::domain::similar::Moment;
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

    fn record_hash<'a>(&'a self, id: &'a ClipId, sha256: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.hashed(id, sha256))
    }

    fn same_content<'a>(&'a self, user: &'a UserId, sha256: &'a str) -> PortResult<'a, Vec<Clip>> {
        Box::pin(self.same_hash(user, sha256))
    }

    fn mark_duplicate<'a>(&'a self, id: &'a ClipId, of: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(self.duplicate(id, of))
    }

    fn set_segment_blank<'a>(&'a self, id: &'a SegmentId, blank: bool) -> PortResult<'a, ()> {
        Box::pin(self.blank(id, blank))
    }

    fn moments<'a>(&'a self, ids: &'a [SegmentId]) -> PortResult<'a, Vec<Moment>> {
        Box::pin(self.moment_rows(ids))
    }

    fn unchecked_ready(&self) -> PortResult<'_, Vec<ClipId>> {
        Box::pin(self.ready_unchecked())
    }

    fn unhashed(&self) -> PortResult<'_, Vec<ClipId>> {
        Box::pin(self.without_hash())
    }

    fn same_upload<'a>(
        &'a self,
        user: &'a UserId,
        filename: &'a str,
        size_bytes: u64,
    ) -> PortResult<'a, Option<Clip>> {
        Box::pin(self.same_name_and_size(user, filename, size_bytes))
    }

    fn delete_clip<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(self.delete(id))
    }

    fn mark_viewed<'a>(&'a self, id: &'a ClipId, at: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.viewed(id, at))
    }

    fn set_title<'a>(&'a self, id: &'a ClipId, title: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.titled(id, title))
    }

    fn ready_clips(&self) -> PortResult<'_, Vec<ClipId>> {
        Box::pin(self.ready_ids())
    }

    fn untitled_ready(&self) -> PortResult<'_, Vec<ClipId>> {
        Box::pin(self.untitled())
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

    fn set_segment_facts<'a>(
        &'a self,
        id: &'a SegmentId,
        facts: &'a SegmentFacts,
    ) -> PortResult<'a, ()> {
        Box::pin(self.update_facts(id, facts))
    }

    fn segment_transcripts<'a>(
        &'a self,
        id: &'a ClipId,
    ) -> PortResult<'a, Vec<(SegmentId, Vec<String>)>> {
        Box::pin(self.turn_texts(id))
    }

    fn replace_face_tracks<'a>(
        &'a self,
        id: &'a ClipId,
        tracks: &'a [TrackRow],
        links: &'a [(TrackId, SegmentId)],
    ) -> PortResult<'a, ()> {
        Box::pin(self.upsert_tracks(id, tracks, links))
    }

    fn index_docs<'a>(&'a self, scope: DocScope<'a>) -> PortResult<'a, Vec<SegmentDoc>> {
        Box::pin(self.docs(scope))
    }

    fn library<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<LibraryRow>> {
        Box::pin(self.library_rows(user))
    }

    fn clip_detail<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Option<ClipDetailRows>> {
        Box::pin(self.detail(id))
    }

    fn candidates<'a>(
        &'a self,
        user: &'a UserId,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<Candidate>> {
        Box::pin(self.candidate_rows(user, ids))
    }
}

#[cfg(test)]
mod duplicates_tests;
#[cfg(test)]
mod people_tests;
#[cfg(test)]
mod redesign_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub(crate) mod views_tests;
