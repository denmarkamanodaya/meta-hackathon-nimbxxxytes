//! The `photo` job, one step per stage. `fit` reads the size after orientation, the date taken
//! and the camera, and stores an upright viewing copy (2048 px) and thumbnail (480 px); `describe`
//! has Spark look at a 1280 px copy; `embed` stores the Perception Encoder vector of the viewing
//! copy; `index` writes the search document; `ready` marks it done. A deleted photo does nothing.
//! Each step may run again after a crash and rewrites the same outputs.

use std::path::PathBuf;

use super::{PhotoPorts, now};
use crate::domain::ids::PhotoId;
use crate::domain::index::PhotoDoc;
use crate::domain::job::Job;
use crate::domain::photo::{
    Photo, PhotoFit, PhotoStatus, SPARK_EDGE_PX, THUMB_EDGE_PX, VIEW_EDGE_PX, search_key, taken_at,
    tidied_facts,
};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{PhotoProgress, PortResult, PutFile, StepRunner};

impl PhotoPorts {
    /// A file in the photo's working directory (the directory is created).
    async fn work_file(&self, id: &PhotoId, name: &str) -> Result<PathBuf, AppError> {
        Ok(self.scratch.photo_dir(id).await?.join(name))
    }

    /// The object at `key` in the working directory as `name` (downloaded once).
    async fn local(&self, id: &PhotoId, key: &ObjectKey, name: &str) -> Result<PathBuf, AppError> {
        let path = self.work_file(id, name).await?;
        if !self.scratch.exists(&path).await? {
            self.blobs.get_to_file(key, &path).await?;
        }
        Ok(path)
    }

    /// The viewing copy, local.
    async fn local_view(&self, photo: &Photo) -> Result<PathBuf, AppError> {
        let key = keys::photo_view(&photo.user_id, &photo.id);
        self.local(&photo.id, &key, "view.jpg").await
    }

    async fn put_jpeg(&self, key: &ObjectKey, path: &std::path::Path) -> Result<(), AppError> {
        let put = PutFile {
            key,
            path,
            content_type: "image/jpeg",
            class: None,
            cache_control: Some(DERIVED_CACHE_CONTROL),
        };
        self.blobs.put_file(put).await
    }
}

/// `fit`: size, date taken and camera read; viewing copy and thumbnail stored.
async fn fit(p: &PhotoPorts, photo: &Photo) -> Result<(), AppError> {
    let (user, id) = (&photo.user_id, &photo.id);
    let original = keys::photo_original(user, id, photo.format);
    let src = p
        .local(id, &original, &format!("original.{}", photo.format.ext()))
        .await?;
    let probe = p.media.probe_image(&src).await?;
    let view = p.work_file(id, "view.jpg").await?;
    p.media.fit_jpeg(&src, VIEW_EDGE_PX, &view).await?;
    p.put_jpeg(&keys::photo_view(user, id), &view).await?;
    let thumb = p.work_file(id, "thumb.jpg").await?;
    p.media.fit_jpeg(&view, THUMB_EDGE_PX, &thumb).await?;
    p.put_jpeg(&keys::photo_thumb(user, id), &thumb).await?;
    let fit = PhotoFit {
        width: probe.width,
        height: probe.height,
        taken_at: taken_at(
            probe.taken_at.as_deref(),
            photo.last_modified.as_deref(),
            &photo.created_at,
        ),
        camera: probe.camera,
    };
    p.store.set_fit(id, &fit).await
}

/// `describe`: Spark's facts from a 1280 px copy.
async fn describe(p: &PhotoPorts, photo: &Photo) -> Result<(), AppError> {
    let view = p.local_view(photo).await?;
    let small = p.work_file(&photo.id, "spark.jpg").await?;
    p.media.fit_jpeg(&view, SPARK_EDGE_PX, &small).await?;
    let facts = tidied_facts(&p.describer.describe(&small).await?);
    p.store.set_facts(&photo.id, &facts).await
}

/// `embed`: the viewing copy's PE vector.
async fn embed(p: &PhotoPorts, photo: &Photo) -> Result<(), AppError> {
    let view = p.local_view(photo).await?;
    let vector = p.embedder.embed_image(&view).await?;
    let key = search_key(&photo.id)?;
    p.vectors.upsert(&key, &photo.user_id, &vector).await
}

/// `index`: the photo's search document.
async fn index(p: &PhotoPorts, photo: &Photo) -> Result<(), AppError> {
    let f = &photo.facts;
    let doc = PhotoDoc {
        key: search_key(&photo.id)?,
        user_id: photo.user_id.clone(),
        description: format!("{}. {}", photo.shown_title(), f.description),
        things: f.things.join(", "),
        place: f.place.clone(),
        mood: f.mood.clone(),
        taken_at: photo.taken_at.clone(),
    };
    p.text.upsert_photo(&doc).await
}

async fn set_status(
    p: &PhotoPorts,
    id: &PhotoId,
    status: PhotoStatus,
    error: Option<&str>,
) -> Result<(), AppError> {
    let at = now(p);
    let progress = PhotoProgress {
        status,
        error,
        at: &at,
    };
    p.store.set_progress(id, progress).await
}

async fn run_photo(p: &PhotoPorts, job: &Job, step: &str) -> Result<(), AppError> {
    let id = PhotoId::parse(job.subject_id.as_str())?;
    let Some(photo) = p.store.get(&id).await? else {
        return Ok(());
    };
    match step {
        "fit" => fit(p, &photo).await,
        "describe" => describe(p, &photo).await,
        "embed" => embed(p, &photo).await,
        "index" => index(p, &photo).await,
        "ready" => {
            set_status(p, &id, PhotoStatus::Ready, None).await?;
            p.scratch.remove_photo_dir(&id).await
        }
        other => Err(AppError::new(
            ErrorCode::Internal,
            format!("bad photo step {other}"),
        )),
    }
}

async fn photo_failed(p: &PhotoPorts, job: &Job, error: &AppError) -> Result<(), AppError> {
    let id = PhotoId::parse(job.subject_id.as_str())?;
    if p.store.get(&id).await?.is_none() {
        return Ok(());
    }
    set_status(p, &id, PhotoStatus::Failed, Some(&error.message)).await
}

impl StepRunner for PhotoPorts {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(run_photo(self, job, step))
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(photo_failed(self, job, error))
    }
}
