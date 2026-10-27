//! In-memory [`BlobStore`] that records every call.

use std::collections::HashMap;
use std::sync::Mutex;

use nimbytes_core::domain::upload::CompletedPart;
use nimbytes_core::keys::{ObjectClass, ObjectKey};
use nimbytes_core::ports::{BlobStore, PortResult, PutFile};
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
    puts: Vec<(String, String)>,
    gets: Vec<String>,
    tags: Vec<(String, ObjectClass)>,
    deleted: Vec<String>,
    cache_controls: Vec<Option<String>>,
}

/// Fake store: presigned URLs are `https://fake/{key}?uploadId={id}&partNumber={n}`; a completed
/// object's size is whatever [`FakeBlobStore::set_completed_size`] says (default: the sum of
/// nothing, so tests must set it).
#[derive(Debug, Default)]
pub struct FakeBlobStore {
    state: Mutex<State>,
    completed_size: Mutex<Option<u64>>,
    disk: Option<std::sync::Arc<crate::FakeScratch>>,
}

impl FakeBlobStore {
    /// A store whose downloads "appear" in `disk`.
    pub fn writing_to(disk: std::sync::Arc<crate::FakeScratch>) -> Self {
        Self {
            disk: Some(disk),
            ..Self::default()
        }
    }

    /// Size every object will report after `complete_multipart`.
    pub fn set_completed_size(&self, bytes: u64) {
        *crate::lock(&self.completed_size) = Some(bytes);
    }

    /// Stores an object of `bytes` at `key`, as a client upload would.
    pub fn store(&self, key: &str, bytes: u64) {
        crate::lock(&self.state).sizes.insert(key.to_owned(), bytes);
    }

    /// Every `create_multipart` call so far.
    pub fn created(&self) -> Vec<CreatedMultipart> {
        crate::lock(&self.state).created.clone()
    }

    /// Every `put_file` so far: key and content type, in order.
    pub fn puts(&self) -> Vec<(String, String)> {
        crate::lock(&self.state).puts.clone()
    }

    /// Every `get_to_file` key so far, in order.
    pub fn gets(&self) -> Vec<String> {
        crate::lock(&self.state).gets.clone()
    }

    /// The `Cache-Control` of every `put_file` so far, in order.
    pub fn cache_controls(&self) -> Vec<Option<String>> {
        crate::lock(&self.state).cache_controls.clone()
    }

    /// Every key `delete` removed, in order.
    pub fn deleted(&self) -> Vec<String> {
        crate::lock(&self.state).deleted.clone()
    }

    /// Every `tag` call so far: key and class, in order.
    pub fn tags(&self) -> Vec<(String, ObjectClass)> {
        crate::lock(&self.state).tags.clone()
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

    fn put_file<'a>(&'a self, put: PutFile<'a>) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state
                .puts
                .push((put.key.to_string(), put.content_type.to_owned()));
            state
                .cache_controls
                .push(put.cache_control.map(str::to_owned));
            state.sizes.insert(put.key.to_string(), 1);
            Ok(())
        })
    }

    fn get_to_file<'a>(
        &'a self,
        key: &'a ObjectKey,
        path: &'a std::path::Path,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.state).gets.push(key.to_string());
            if let Some(disk) = &self.disk {
                disk.add(path);
            }
            Ok(())
        })
    }

    fn presign_get<'a>(
        &'a self,
        key: &'a ObjectKey,
        ttl: std::time::Duration,
    ) -> PortResult<'a, String> {
        Box::pin(async move { Ok(format!("https://signed/{key}?ttl={}", ttl.as_secs())) })
    }

    fn presign_put<'a>(
        &'a self,
        key: &'a ObjectKey,
        ttl: std::time::Duration,
    ) -> PortResult<'a, String> {
        Box::pin(async move { Ok(format!("https://put/{key}?ttl={}", ttl.as_secs())) })
    }

    fn delete<'a>(&'a self, keys: &'a [ObjectKey]) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state
                .deleted
                .extend(keys.iter().map(|k| k.as_str().to_owned()));
            Ok(())
        })
    }

    fn tag<'a>(&'a self, key: &'a ObjectKey, class: ObjectClass) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.state)
                .tags
                .push((key.as_str().to_owned(), class));
            Ok(())
        })
    }

    fn presign_download<'a>(
        &'a self,
        key: &'a ObjectKey,
        ttl: std::time::Duration,
        filename: &'a str,
    ) -> PortResult<'a, String> {
        Box::pin(async move {
            Ok(format!(
                "https://signed/{key}?ttl={}&download={filename}",
                ttl.as_secs()
            ))
        })
    }
}
