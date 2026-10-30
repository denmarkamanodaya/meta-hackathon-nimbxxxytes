//! Object storage and local scratch space.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::domain::ids::{ClipId, DocumentId, ListenId, PhotoId, ShortId, UserId};
use crate::domain::upload::CompletedPart;
use crate::keys::{ObjectClass, ObjectKey};
use crate::ports::{BoxFuture, PortResult};

/// A request body read piece by piece, so a large upload never sits in memory.
pub trait ChunkSource: Send {
    /// The next piece, or `None` at the end. `VALIDATION_FAILED` when the body cannot be read.
    fn next_chunk(&mut self) -> BoxFuture<'_, Result<Option<Vec<u8>>, crate::AppError>>;
}

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
    /// `Cache-Control` stored with the object; `None` for the store's default.
    pub cache_control: Option<&'a str>,
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

    /// Total bytes of every stored object whose key starts with `prefix` (unfinished multipart
    /// uploads are not objects yet and do not count).
    fn used_bytes<'a>(&'a self, prefix: &'a ObjectKey) -> PortResult<'a, u64>;

    /// Uploads a local file, replacing any object at the key.
    fn put_file<'a>(&'a self, put: PutFile<'a>) -> PortResult<'a, ()>;

    /// A GET URL for the object, valid for at least `ttl` (supports byte ranges for video
    /// seeking). Within one hour the same key gives the same URL, so browsers can cache it.
    fn presign_get<'a>(&'a self, key: &'a ObjectKey, ttl: Duration) -> PortResult<'a, String>;

    /// Downloads an object to a local file (parent directory must exist).
    fn get_to_file<'a>(&'a self, key: &'a ObjectKey, path: &'a Path) -> PortResult<'a, ()>;

    /// Deletes these objects; keys that do not exist are ignored.
    fn delete<'a>(&'a self, keys: &'a [ObjectKey]) -> PortResult<'a, ()>;

    /// A PUT URL another service uploads the object with, valid for `ttl`. Only the host is
    /// signed, so the uploader may send any `Content-Type`.
    fn presign_put<'a>(&'a self, key: &'a ObjectKey, ttl: Duration) -> PortResult<'a, String>;

    /// Sets the lifecycle class tag of an existing object.
    fn tag<'a>(&'a self, key: &'a ObjectKey, class: ObjectClass) -> PortResult<'a, ()>;

    /// A GET URL that makes browsers save the object as `filename`, valid for `ttl`.
    fn presign_download<'a>(
        &'a self,
        key: &'a ObjectKey,
        ttl: Duration,
        filename: &'a str,
    ) -> PortResult<'a, String>;
}

/// Local working directory for media steps; survives restarts so a resumed job can reuse files.
pub trait Scratch: Send + Sync {
    /// Directory for one clip's intermediate files, created if missing.
    fn clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, PathBuf>;

    /// Writes `bytes` to `path` (its directory must exist), replacing any file there.
    fn write_file<'a>(&'a self, path: &'a Path, bytes: &'a [u8]) -> PortResult<'a, ()>;

    /// Whether a non-empty file exists at `path`.
    fn exists<'a>(&'a self, path: &'a Path) -> PortResult<'a, bool>;

    /// SHA-256 of a local file, lower-case hex, read in chunks (originals can be gigabytes).
    fn sha256<'a>(&'a self, path: &'a Path) -> PortResult<'a, String>;

    /// The user's working directory (face crops while matching), created if missing.
    fn user_dir<'a>(&'a self, user: &'a UserId) -> PortResult<'a, PathBuf>;

    /// Deletes the user's working directory and everything in it.
    fn remove_user_dir<'a>(&'a self, user: &'a UserId) -> PortResult<'a, ()>;

    /// Deletes a clip's directory and everything in it.
    fn remove_clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, ()>;

    /// Directory for one short's working files (downloaded previews), created if missing.
    fn short_dir<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, PathBuf>;

    /// Deletes a short's directory and everything in it; a missing one is not an error.
    fn remove_short_dir<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, ()>;

    /// Directory for spoken requests while they are transcribed, created if missing.
    fn voice_dir(&self) -> PortResult<'_, PathBuf>;

    /// Directory for one document's working files (the source and its pages), created if missing.
    fn document_dir<'a>(&'a self, doc: &'a DocumentId) -> PortResult<'a, PathBuf>;

    /// Deletes a document's directory and everything in it; a missing one is not an error.
    fn remove_document_dir<'a>(&'a self, doc: &'a DocumentId) -> PortResult<'a, ()>;

    /// Deletes one file; a missing one is not an error.
    fn remove_file<'a>(&'a self, path: &'a Path) -> PortResult<'a, ()>;

    /// Directory for one listen's working files (source, audio, chunks), created if missing.
    fn listen_dir<'a>(&'a self, listen: &'a ListenId) -> PortResult<'a, PathBuf>;

    /// Deletes a listen's directory and everything in it; a missing one is not an error.
    fn remove_listen_dir<'a>(&'a self, listen: &'a ListenId) -> PortResult<'a, ()>;

    /// Directory for one photo's working files, created if missing.
    fn photo_dir<'a>(&'a self, photo: &'a PhotoId) -> PortResult<'a, PathBuf>;

    /// Deletes a photo's directory and everything in it; a missing one is not an error.
    fn remove_photo_dir<'a>(&'a self, photo: &'a PhotoId) -> PortResult<'a, ()>;

    /// Writes `source` to `path` (its directory must exist), replacing any file there, and
    /// returns how many bytes were written. Stops once more than `max_bytes` were written, so
    /// a body past the limit returns `max_bytes + 1` or a little more and is never read whole.
    fn write_stream<'a>(
        &'a self,
        path: &'a Path,
        source: &'a mut dyn ChunkSource,
        max_bytes: u64,
    ) -> PortResult<'a, u64>;
}
