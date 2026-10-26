//! In-memory [`Catalogue`].

use std::sync::Mutex;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::upload::{Upload, UploadStatus};
use nimbytes_core::ports::{Catalogue, PortResult};
use nimbytes_core::{AppError, ErrorCode};

#[derive(Debug, Default)]
struct State {
    demo_user: Option<UserId>,
    clips: Vec<Clip>,
    uploads: Vec<Upload>,
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
}
