//! A file the client sends through the API as a raw body (a recording, a photo): read piece by
//! piece into the working directory, never whole in memory, refused when empty or too large, then
//! stored.

use std::path::Path;

use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;
use crate::ports::{BlobStore, ChunkSource, PutFile, Scratch};

/// A body the client sent through the API.
pub struct SourceBody<'a> {
    /// The request's `Content-Type`, if any.
    pub content_type: Option<&'a str>,
    /// The body, read piece by piece.
    pub chunks: &'a mut dyn ChunkSource,
}

/// Where a streamed body goes and how big it may be.
#[derive(Debug, Clone, Copy)]
pub struct StreamedFile<'a> {
    /// The working file it is written to first.
    pub path: &'a Path,
    /// Its key in storage.
    pub key: &'a ObjectKey,
    /// Its stored type.
    pub content_type: &'a str,
    /// Largest body accepted, bytes.
    pub max_bytes: u64,
    /// The message for a body over `max_bytes` ("the file is larger than 40 MB").
    pub too_large: &'a str,
}

/// Writes `chunks` to `file.path` and stores it at `file.key`.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty body or one over `file.max_bytes` (the working file is
/// removed and nothing is stored); scratch and storage errors.
pub async fn store_streamed(
    (blobs, scratch): (&dyn BlobStore, &dyn Scratch),
    file: StreamedFile<'_>,
    chunks: &mut dyn ChunkSource,
) -> Result<(), AppError> {
    let written = scratch
        .write_stream(file.path, chunks, file.max_bytes)
        .await?;
    if written == 0 || written > file.max_bytes {
        scratch.remove_file(file.path).await?;
        let msg = if written == 0 {
            "the file is empty"
        } else {
            file.too_large
        };
        return Err(AppError::new(ErrorCode::ValidationFailed, msg));
    }
    let put = PutFile {
        key: file.key,
        path: file.path,
        content_type: file.content_type,
        class: None,
        cache_control: None,
    };
    blobs.put_file(put).await
}
