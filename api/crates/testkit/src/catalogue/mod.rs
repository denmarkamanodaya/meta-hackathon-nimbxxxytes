//! In-memory [`Catalogue`].

mod read;

use std::sync::Mutex;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::facts::SegmentFacts;
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::ids::{SegmentId, TrackId};
use nimbytes_core::domain::index::{ClipDetailRows, DocScope, LibraryRow, SegmentDoc};
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::search::Candidate;
use nimbytes_core::domain::search::FaceSeen;
use nimbytes_core::domain::segment::{Segment, TrackRow, TranscriptRows};
use nimbytes_core::domain::upload::{Upload, UploadStatus};
use nimbytes_core::ports::{Catalogue, PortResult};
use nimbytes_core::{AppError, ErrorCode};

#[derive(Debug, Default)]
struct State {
    demo_user: Option<UserId>,
    clips: Vec<Clip>,
    uploads: Vec<Upload>,
    segments: Vec<Segment>,
    transcripts: Vec<(ClipId, TranscriptRows)>,
    errors: Vec<(ClipId, Option<ErrorCode>)>,
    facts: Vec<(SegmentId, SegmentFacts)>,
    tracks: Vec<StoredTracks>,
    faces: Vec<(SegmentId, FaceSeen)>,
}

/// Track ↔ segment links of one clip.
pub type TrackLinks = Vec<(TrackId, SegmentId)>;

/// The face tracks last stored for one clip.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredTracks {
    /// Clip.
    pub clip: ClipId,
    /// Track rows.
    pub rows: Vec<TrackRow>,
    /// Links.
    pub links: TrackLinks,
}

/// Vec-backed catalogue with the same semantics as the SQLite one.
#[derive(Debug, Default)]
pub struct InMemoryCatalogue {
    state: Mutex<State>,
}

impl InMemoryCatalogue {
    /// The stored clip with `id`, if any.
    pub fn clip(&self, id: &ClipId) -> Option<Clip> {
        crate::lock(&self.state)
            .clips
            .iter()
            .find(|c| &c.id == id)
            .cloned()
    }

    /// Stores a clip directly (test setup).
    pub fn put_clip(&self, clip: Clip) {
        crate::lock(&self.state).clips.push(clip);
    }

    /// Forgets a clip's hash, as for a clip ingested before hashing.
    pub fn clear_hash(&self, id: &ClipId) {
        self.update_clip(id, |c| c.content_sha256 = None);
    }

    /// A named face seen in `segment`, listed on its search candidate (biggest first: add in
    /// that order).
    pub fn put_face(&self, segment: SegmentId, face: FaceSeen) {
        crate::lock(&self.state).faces.push((segment, face));
    }

    /// The transcript last stored for a clip.
    pub fn transcript(&self, id: &ClipId) -> Option<TranscriptRows> {
        let state = crate::lock(&self.state);
        state
            .transcripts
            .iter()
            .rev()
            .find(|(c, _)| c == id)
            .map(|(_, t)| t.clone())
    }

    /// Facts stored for a segment.
    pub fn facts(&self, id: &SegmentId) -> Option<SegmentFacts> {
        let state = crate::lock(&self.state);
        state
            .facts
            .iter()
            .rev()
            .find(|(s, _)| s == id)
            .map(|(_, f)| f.clone())
    }

    /// Track rows and links last stored for a clip.
    pub fn face_tracks(&self, id: &ClipId) -> Option<StoredTracks> {
        let state = crate::lock(&self.state);
        state.tracks.iter().rev().find(|t| &t.clip == id).cloned()
    }

    /// The error code last stored with a status change of a clip.
    pub fn last_error(&self, id: &ClipId) -> Option<ErrorCode> {
        let state = crate::lock(&self.state);
        state
            .errors
            .iter()
            .rev()
            .find(|(c, _)| c == id)
            .and_then(|(_, e)| *e)
    }

    /// Stores an upload directly (test setup, e.g. another user's upload).
    pub fn put_upload(&self, upload: Upload) {
        crate::lock(&self.state).uploads.push(upload);
    }
}

impl Catalogue for InMemoryCatalogue {
    fn demo_user<'a>(&'a self, new_id: &'a UserId, _now: &'a str) -> PortResult<'a, UserId> {
        Box::pin(async move {
            Ok(crate::lock(&self.state)
                .demo_user
                .get_or_insert_with(|| new_id.clone())
                .clone())
        })
    }

    fn insert_upload<'a>(&'a self, clip: &'a Clip, upload: &'a Upload) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state.clips.push(clip.clone());
            state.uploads.push(upload.clone());
            Ok(())
        })
    }

    fn get_upload<'a>(&'a self, id: &'a UploadId) -> PortResult<'a, Option<Upload>> {
        Box::pin(async move {
            Ok(crate::lock(&self.state)
                .uploads
                .iter()
                .find(|u| &u.id == id)
                .cloned())
        })
    }

    fn finish_upload<'a>(&'a self, upload: &'a UploadId, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            let missing = || AppError::new(ErrorCode::NotFound, "missing row");
            let u = state
                .uploads
                .iter_mut()
                .find(|u| &u.id == upload)
                .ok_or_else(missing)?;
            u.status = UploadStatus::Completed;
            let c = state
                .clips
                .iter_mut()
                .find(|c| &c.id == clip)
                .ok_or_else(missing)?;
            c.status = ClipStatus::Uploaded;
            Ok(())
        })
    }

    fn list_clips<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Clip>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let mut clips: Vec<Clip> = state
                .clips
                .iter()
                .filter(|c| &c.user_id == user)
                .cloned()
                .collect();
            clips.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
            Ok(clips)
        })
    }

    fn record_hash<'a>(&'a self, id: &'a ClipId, sha256: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update_clip(id, |c| c.content_sha256 = Some(sha256.to_owned()));
            Ok(())
        })
    }

    fn same_content<'a>(&'a self, user: &'a UserId, sha256: &'a str) -> PortResult<'a, Vec<Clip>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let same = state.clips.iter().filter(|c| {
                &c.user_id == user
                    && c.content_sha256.as_deref() == Some(sha256)
                    && !matches!(c.status, ClipStatus::Failed | ClipStatus::Duplicate)
            });
            Ok(same.cloned().collect())
        })
    }

    fn mark_duplicate<'a>(&'a self, id: &'a ClipId, of: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update_clip(id, |c| {
                (c.status, c.duplicate_of) = (ClipStatus::Duplicate, Some(of.clone()));
            });
            Ok(())
        })
    }

    fn unhashed(&self) -> PortResult<'_, Vec<ClipId>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let open = state
                .clips
                .iter()
                .filter(|c| c.content_sha256.is_none() && c.status == ClipStatus::Ready);
            Ok(open.map(|c| c.id.clone()).collect())
        })
    }

    fn same_upload<'a>(
        &'a self,
        user: &'a UserId,
        filename: &'a str,
        size_bytes: u64,
    ) -> PortResult<'a, Option<Clip>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let found = state.clips.iter().find(|c| {
                &c.user_id == user
                    && c.filename == filename
                    && c.size_bytes == size_bytes
                    && !matches!(c.status, ClipStatus::Failed | ClipStatus::Duplicate)
            });
            Ok(found.cloned())
        })
    }

    fn delete_clip<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state.clips.retain(|c| &c.id != id);
            state.uploads.retain(|u| &u.clip_id != id);
            state.segments.retain(|s| &s.clip_id != id);
            state.tracks.retain(|t| &t.clip != id);
            Ok(())
        })
    }

    fn mark_viewed<'a>(&'a self, id: &'a ClipId, at: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            for c in state.clips.iter_mut().filter(|c| &c.id == id) {
                c.last_viewed_at = Some(at.to_owned());
            }
            Ok(())
        })
    }

    fn set_title<'a>(&'a self, id: &'a ClipId, title: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            for c in state.clips.iter_mut().filter(|c| &c.id == id) {
                c.title = Some(title.to_owned());
            }
            Ok(())
        })
    }

    fn untitled_ready(&self) -> PortResult<'_, Vec<ClipId>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let untitled = state.clips.iter().filter(|c| {
                c.status == nimbytes_core::domain::clip::ClipStatus::Ready && c.title.is_none()
            });
            Ok(untitled.map(|c| c.id.clone()).collect())
        })
    }

    fn get_clip<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Option<Clip>> {
        Box::pin(async move { Ok(self.clip(id)) })
    }

    fn record_probe<'a>(&'a self, id: &'a ClipId, probe: &'a ProbeInfo) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update_clip(id, |c| c.probe = Some(probe.clone()));
            Ok(())
        })
    }

    fn set_clip_status<'a>(
        &'a self,
        id: &'a ClipId,
        status: ClipStatus,
        error: Option<ErrorCode>,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update_clip(id, |c| c.status = status);
            crate::lock(&self.state).errors.push((id.clone(), error));
            Ok(())
        })
    }

    fn replace_segments<'a>(
        &'a self,
        id: &'a ClipId,
        segments: &'a [Segment],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state.segments.retain(|s| &s.clip_id != id);
            state.segments.extend_from_slice(segments);
            Ok(())
        })
    }

    fn list_segments<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Vec<Segment>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            Ok(state
                .segments
                .iter()
                .filter(|s| &s.clip_id == id)
                .cloned()
                .collect())
        })
    }

    fn replace_transcript<'a>(
        &'a self,
        id: &'a ClipId,
        rows: &'a TranscriptRows,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.state)
                .transcripts
                .push((id.clone(), rows.clone()));
            Ok(())
        })
    }

    fn set_segment_facts<'a>(
        &'a self,
        id: &'a SegmentId,
        facts: &'a SegmentFacts,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.state)
                .facts
                .push((id.clone(), facts.clone()));
            Ok(())
        })
    }

    fn segment_transcripts<'a>(
        &'a self,
        id: &'a ClipId,
    ) -> PortResult<'a, Vec<(SegmentId, Vec<String>)>> {
        Box::pin(async move { Ok(self.transcripts_of(id)) })
    }

    fn replace_face_tracks<'a>(
        &'a self,
        id: &'a ClipId,
        tracks: &'a [TrackRow],
        links: &'a [(TrackId, SegmentId)],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.state).tracks.push(StoredTracks {
                clip: id.clone(),
                rows: tracks.to_vec(),
                links: links.to_vec(),
            });
            Ok(())
        })
    }

    fn index_docs<'a>(&'a self, scope: DocScope<'a>) -> PortResult<'a, Vec<SegmentDoc>> {
        Box::pin(async move { Ok(self.docs(scope)) })
    }

    fn library<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<LibraryRow>> {
        Box::pin(async move { Ok(self.library_rows(user)) })
    }

    fn clip_detail<'a>(&'a self, id: &'a ClipId) -> PortResult<'a, Option<ClipDetailRows>> {
        Box::pin(async move { Ok(self.detail(id)) })
    }

    fn candidates<'a>(
        &'a self,
        user: &'a UserId,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<Candidate>> {
        Box::pin(async move { Ok(self.candidate_rows(user, ids)) })
    }
}

impl InMemoryCatalogue {
    fn update_clip(&self, id: &ClipId, f: impl FnOnce(&mut Clip)) {
        if let Some(c) = crate::lock(&self.state)
            .clips
            .iter_mut()
            .find(|c| &c.id == id)
        {
            f(c);
        }
    }
}
