//! Photos: the owner adds photos (several at once from the app), each is stored, then a `photo`
//! job fits it (viewing copy and thumbnail, date taken, camera), has Muse Spark describe it,
//! embeds it with Perception Encoder and indexes it, so search finds it next to video moments.

mod run;

use std::sync::Arc;
use std::time::Duration;

use crate::domain::ids::{JobId, PhotoId, UserId};
use crate::domain::job::JobKind;
use crate::domain::photo::{
    MAX_BYTES, NewPhoto, Photo, PhotoFormat, PhotoStatus, checked_upload, photo_title, search_key,
};
use crate::domain::storage_cap::StorageCap;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::{
    BlobStore, Clock, Embedder, IdGenerator, JobQueue, MediaTool, NewJob, PhotoDescriber,
    PhotoProgress, PhotoStore, Scratch, TextIndex, UsageStore, VectorIndex,
};
use crate::time::format_utc;
use crate::usecases::storage::{Quota, ensure_room};
use crate::usecases::streamed::{SourceBody, StreamedFile, store_streamed};

/// Every port Photos uses, bound once by the composition root; the request handlers and the
/// `photo` job share it.
#[derive(Clone)]
pub struct PhotoPorts {
    /// Photo rows.
    pub store: Arc<dyn PhotoStore>,
    /// Private objects.
    pub blobs: Arc<dyn BlobStore>,
    /// Working files.
    pub scratch: Arc<dyn Scratch>,
    /// ffprobe and the fitted copies.
    pub media: Arc<dyn MediaTool>,
    /// Spark describes.
    pub describer: Arc<dyn PhotoDescriber>,
    /// Perception Encoder.
    pub embedder: Arc<dyn Embedder>,
    /// The keyword index (shared with moments).
    pub text: Arc<dyn TextIndex>,
    /// Photo vectors.
    pub vectors: Arc<dyn VectorIndex>,
    /// The `photo` job.
    pub jobs: Arc<dyn JobQueue>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Ids.
    pub ids: Arc<dyn IdGenerator>,
    /// Storage measurements for the cap.
    pub usage: Arc<dyn UsageStore>,
    /// The per-account cap.
    pub cap: StorageCap,
    /// Lifetime of the GET URLs handed out.
    pub url_ttl: Duration,
}

/// One row of the list: the photo and its thumbnail, signed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhotoView {
    /// The row.
    pub photo: Photo,
    /// The thumbnail, signed; `None` before it is made.
    pub thumb_url: Option<String>,
}

/// A whole photo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhotoDetailView {
    /// The row and its thumbnail.
    pub view: PhotoView,
    /// The viewing copy, signed; `None` before it is made.
    pub image_url: Option<String>,
    /// The original, signed; `None` before it is uploaded.
    pub original_url: Option<String>,
}

fn now(p: &PhotoPorts) -> String {
    format_utc(p.clock.now_millis())
}

/// `user`'s photo.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub async fn owned_photo(
    store: &dyn PhotoStore,
    user: &UserId,
    id: &PhotoId,
) -> Result<Photo, AppError> {
    let photo = store
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such photo"))?;
    if &photo.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "photo belongs to another user",
        ));
    }
    Ok(photo)
}

/// Checks the file and the account's room for it, then creates the photo (`uploading`).
///
/// # Errors
/// `VALIDATION_FAILED` for a bad name, type (HEIC included) or size; `STORAGE_FULL` past the
/// cap; store errors.
pub async fn create_photo(p: &PhotoPorts, user: &UserId, req: NewPhoto) -> Result<Photo, AppError> {
    let format = checked_upload(&req)?;
    let quota = Quota {
        usage: p.usage.as_ref(),
        cap: p.cap,
    };
    ensure_room(
        quota,
        (p.blobs.as_ref(), p.clock.as_ref()),
        user,
        req.size_bytes,
    )
    .await?;
    let id = PhotoId::parse(p.ids.new_id())?;
    let photo = Photo::uploading((id, user.clone()), req, format, &now(p));
    p.store.create(&photo).await?;
    Ok(photo)
}

/// Marks the photo `analysing` and queues its job (a finished or failed one runs again from its
/// first step).
async fn queue_photo(p: &PhotoPorts, id: &PhotoId) -> Result<(), AppError> {
    let at = now(p);
    let progress = PhotoProgress {
        status: PhotoStatus::Analysing,
        error: None,
        at: &at,
    };
    p.store.set_progress(id, progress).await?;
    let ms = p.clock.now_millis();
    let job = JobId::parse(p.ids.new_id())?;
    let new = NewJob {
        id: &job,
        kind: JobKind::Photo,
        subject_id: id.as_str(),
    };
    p.jobs.enqueue(new, ms).await?;
    p.jobs.restart(JobKind::Photo, id.as_str(), ms).await
}

/// The client sends the photo through the API, read piece by piece (never whole in memory),
/// stored as the original, then the analysis is queued. A photo being analysed or ready answers
/// its status and keeps its file; a failed one is analysed again.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a type other than the one declared, an
/// empty file or one over 40 MB; scratch, storage, store and queue errors.
pub async fn upload_photo_source(
    p: &PhotoPorts,
    user: &UserId,
    id: &PhotoId,
    body: SourceBody<'_>,
) -> Result<PhotoStatus, AppError> {
    let photo = owned_photo(p.store.as_ref(), user, id).await?;
    if matches!(photo.status, PhotoStatus::Analysing | PhotoStatus::Ready) {
        return Ok(photo.status);
    }
    let sent = body.content_type.map(|c| {
        c.split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
    });
    if sent.as_deref().and_then(|s| PhotoFormat::parse(s).ok()) != Some(photo.format) {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            format!(
                "the file must be {}, the type it was added as",
                photo.format.as_str()
            ),
        ));
    }
    let path = p
        .scratch
        .photo_dir(id)
        .await?
        .join(format!("original.{}", photo.format.ext()));
    let key = keys::photo_original(user, id, photo.format);
    let file = StreamedFile {
        path: &path,
        key: &key,
        content_type: photo.format.as_str(),
        max_bytes: MAX_BYTES,
        too_large: "the file is larger than 40 MB",
    };
    store_streamed((p.blobs.as_ref(), p.scratch.as_ref()), file, body.chunks).await?;
    queue_photo(p, id).await?;
    Ok(PhotoStatus::Analysing)
}

async fn signed(p: &PhotoPorts, key: Option<ObjectKey>) -> Result<Option<String>, AppError> {
    match key {
        Some(k) => Ok(Some(p.blobs.presign_get(&k, p.url_ttl).await?)),
        None => Ok(None),
    }
}

async fn view(p: &PhotoPorts, photo: Photo) -> Result<PhotoView, AppError> {
    let thumb = photo
        .width
        .map(|_| keys::photo_thumb(&photo.user_id, &photo.id));
    Ok(PhotoView {
        thumb_url: signed(p, thumb).await?,
        photo,
    })
}

/// `user`'s photos, newest taken first.
///
/// # Errors
/// Store and storage errors.
pub async fn list_photos(p: &PhotoPorts, user: &UserId) -> Result<Vec<PhotoView>, AppError> {
    let mut out = Vec::new();
    for photo in p.store.list(user).await? {
        out.push(view(p, photo).await?);
    }
    Ok(out)
}

/// `user`'s photo with its viewing copy and original.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store and storage errors.
pub async fn get_photo(
    p: &PhotoPorts,
    user: &UserId,
    id: &PhotoId,
) -> Result<PhotoDetailView, AppError> {
    let photo = owned_photo(p.store.as_ref(), user, id).await?;
    let image = photo.width.map(|_| keys::photo_view(user, id));
    let original = (photo.status != PhotoStatus::Uploading)
        .then(|| keys::photo_original(user, id, photo.format));
    Ok(PhotoDetailView {
        image_url: signed(p, image).await?,
        original_url: signed(p, original).await?,
        view: view(p, photo).await?,
    })
}

/// Renames `user`'s photo and answers it in full.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for an empty or too-long title; store errors.
pub async fn rename_photo(
    p: &PhotoPorts,
    user: &UserId,
    id: &PhotoId,
    title: &str,
) -> Result<PhotoDetailView, AppError> {
    owned_photo(p.store.as_ref(), user, id).await?;
    let title = photo_title(title)?;
    p.store.set_title(id, &title, &now(p)).await?;
    get_photo(p, user, id).await
}

/// Deletes `user`'s photo: its job first, then every object, its search document and vector,
/// its row and its working files.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; storage, index, store and queue errors.
pub async fn delete_photo(p: &PhotoPorts, user: &UserId, id: &PhotoId) -> Result<(), AppError> {
    let photo = owned_photo(p.store.as_ref(), user, id).await?;
    p.jobs.cancel(JobKind::Photo, id.as_str()).await?;
    let objects = keys::photo_objects(user, id, photo.format);
    p.blobs.delete(&objects).await?;
    let key = [search_key(id)?];
    p.text.remove(&key).await?;
    p.vectors.remove(&key).await?;
    p.store.delete(id).await?;
    p.scratch.remove_photo_dir(id).await
}
