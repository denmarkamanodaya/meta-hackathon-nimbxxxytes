//! Object storage and local scratch space.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::domain::ids::ClipId;
use crate::domain::upload::CompletedPart;
use crate::keys::{ObjectClass, ObjectKey};
use crate::ports::PortResult;

/// Upload of one local file.
#[derive(Debug, Clone, Copy)]
pub struct PutFile<'a> {
    /// Destination key.
    pub key: &'a ObjectKey,
    /// Local file to send.
    pub path: &'a Path,
    /// MIME type stored with the object.
    pub content_type: &'a str,
    /// Lifecycle class tag; `None` for derived files no lifecycle rule targets.
    pub class: Option<ObjectClass>,
}

/// Object storage with browser-direct multipart uploads.
pub trait BlobStore: Send + Sync {
    /// Starts a multipart upload tagged with `class`; returns the store's upload id.
    fn create_multipart<'a>(
        &'a self,
        key: &'a ObjectKey,
        content_type: &'a str,
        class: ObjectClass,
    ) -> PortResult<'a, String>;

    /// Presigns a PUT URL for part `part` (1-based); the expiry is set where the store is built.
    fn presign_upload_part<'a>(
        &'a self,
        key: &'a ObjectKey,
        store_upload_id: &'a str,
        part: u32,
    ) -> PortResult<'a, String>;

    /// Completes the multipart upload from the listed parts (ascending part numbers).
    /// `UPLOAD_INCOMPLETE` when the store rejects a part or the upload id.
    fn complete_multipart<'a>(
        &'a self,
        key: &'a ObjectKey,
        store_upload_id: &'a str,
        parts: &'a [CompletedPart],
    ) -> PortResult<'a, ()>;

    /// Size of a stored object in bytes; `NOT_FOUND` when it does not exist.
    fn object_size<'a>(&'a self, key: &'a ObjectKey) -> PortResult<'a, u64>;

    /// Uploads a local file, replacing any object at the key.
    fn put_file<'a>(&'a self, put: PutFile<'a>) -> PortResult<'a, ()>;

    /// A GET URL for the object, valid for `ttl` (supports byte ranges for video seeking).
    fn presign_get<'a>(&'a self, key: &'a ObjectKey, ttl: Duration) -> PortResult<'a, String>;

    /// Downloads an object to a local file (parent directory must exist).
    fn get_to_file<'a>(&'a self, key: &'a ObjectKey, path: &'a Path) -> PortResult<'a, ()>;
}

/// Local working directory for media steps; survives restarts so a resumed job can reuse files.
pub trait Scratch: Send + Sync {
    /// Directory for one clip's intermediate files, created if missing.
    fn clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, PathBuf>;

    /// Whether a non-empty file exists at `path`.
    fn exists<'a>(&'a self, path: &'a Path) -> PortResult<'a, bool>;

    /// Deletes a clip's directory and everything in it.
    fn remove_clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, ()>;
}
