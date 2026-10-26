//! In-memory [`Catalogue`].

use std::sync::Mutex;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::segment::{Segment, TranscriptRows};
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
