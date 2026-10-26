//! In-memory [`BlobStore`] that records every call.

use std::collections::HashMap;
use std::sync::Mutex;

use nimbytes_core::domain::upload::CompletedPart;
use nimbytes_core::keys::{ObjectClass, ObjectKey};
use nimbytes_core::ports::{BlobStore, PortResult};
use nimbytes_core::{AppError, ErrorCode};

/// A recorded `create_multipart` call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedMultipart {
    /// Object key.
    pub key: String,
    /// MIME type.
    pub content_type: String,
    /// Lifecycle class tag requested.
    pub class: ObjectClass,
}

#[derive(Debug, Default)]
struct State {
    created: Vec<CreatedMultipart>,
    completed: Vec<(String, Vec<CompletedPart>)>,
    sizes: HashMap<String, u64>,
}

/// Fake store: presigned URLs are `https://fake/{key}?uploadId={id}&partNumber={n}`; a completed
/// object's size is whatever [`FakeBlobStore::set_completed_size`] says (default: the sum of
/// nothing, so tests must set it).
#[derive(Debug, Default)]
pub struct FakeBlobStore {
    state: Mutex<State>,
    completed_size: Mutex<Option<u64>>,
}

impl FakeBlobStore {
    /// Size every object will report after `complete_multipart`.
    pub fn set_completed_size(&self, bytes: u64) {
        *crate::lock(&self.completed_size) = Some(bytes);
    }

    /// Every `create_multipart` call so far.
    pub fn created(&self) -> Vec<CreatedMultipart> {
        crate::lock(&self.state).created.clone()
    }

    /// Every `complete_multipart` call so far: key and parts.
    pub fn completed(&self) -> Vec<(String, Vec<CompletedPart>)> {
        crate::lock(&self.state).completed.clone()
    }
}

impl BlobStore for FakeBlobStore {
    fn create_multipart<'a>(
        &'a self,
        key: &'a ObjectKey,
        content_type: &'a str,
        class: ObjectClass,
    ) -> PortResult<'a, String> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state.created.push(CreatedMultipart {
                key: key.to_string(),
                content_type: content_type.to_owned(),
                class,
            });
            Ok(format!("s3-upload-{}", state.created.len()))
        })
    }

    fn presign_upload_part<'a>(
        &'a self,
        key: &'a ObjectKey,
        store_upload_id: &'a str,
        part: u32,
    ) -> PortResult<'a, String> {
        Box::pin(async move {
            Ok(format!(
                "https://fake/{key}?uploadId={store_upload_id}&partNumber={part}"
            ))
        })
    }

    fn complete_multipart<'a>(
        &'a self,
        key: &'a ObjectKey,
        _store_upload_id: &'a str,
        parts: &'a [CompletedPart],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let size = *crate::lock(&self.completed_size);
            let mut state = crate::lock(&self.state);
            state.completed.push((key.to_string(), parts.to_vec()));
            state.sizes.insert(key.to_string(), size.unwrap_or(0));
            Ok(())
        })
    }

    fn object_size<'a>(&'a self, key: &'a ObjectKey) -> PortResult<'a, u64> {
        Box::pin(async move {
            crate::lock(&self.state)
                .sizes
                .get(key.as_str())
                .copied()
                .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such object"))
        })
    }
}
