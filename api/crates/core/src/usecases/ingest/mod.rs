//! Ingest pipeline: the [`StepRunner`] for `ingest` jobs. Each step reads what earlier steps left
//! (local scratch files, re-downloaded from storage when a restart lost them, or catalogue rows),
//! writes its outputs, and can be rerun after a crash without duplicating anything: ids and keys
//! are deterministic, and model calls are cached by their adapter.

mod steps;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::ids::ClipId;
use crate::domain::job::Job;
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;
use crate::ports::{BlobStore, Catalogue, MediaTool, PortResult, Scratch, StepRunner, Transcriber};

/// Ports the ingest steps use.
#[derive(Clone)]
pub struct IngestSteps {
    /// Originals in, derived files out.
    pub blobs: Arc<dyn BlobStore>,
    /// Clip, segment and transcript rows.
    pub catalogue: Arc<dyn Catalogue>,
    /// ffmpeg / ffprobe.
    pub media: Arc<dyn MediaTool>,
    /// Local working files.
    pub scratch: Arc<dyn Scratch>,
    /// Speech to text.
    pub transcriber: Arc<dyn Transcriber>,
}

/// One clip being processed: its row and its scratch directory.
pub(crate) struct Work {
    pub clip: Clip,
    pub dir: PathBuf,
}

impl Work {
    /// Path of a named intermediate file in the clip's scratch directory.
    pub fn file(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }
}

impl IngestSteps {
    async fn work(&self, job: &Job) -> Result<Work, AppError> {
        let id = ClipId::parse(job.subject_id.as_str())?;
        let clip = self
            .catalogue
            .get_clip(&id)
            .await?
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "clip of ingest job is gone"))?;
        let dir = self.scratch.clip_dir(&id).await?;
        Ok(Work { clip, dir })
    }

    /// Makes sure `path` holds the object at `key`, downloading it when a restart lost it.
    async fn ensure_local(&self, key: &ObjectKey, path: &Path) -> Result<(), AppError> {
        if !self.scratch.exists(path).await? {
            self.blobs.get_to_file(key, path).await?;
        }
        Ok(())
    }

    async fn dispatch(&self, job: &Job, step: &str) -> Result<(), AppError> {
        let work = self.work(job).await?;
        match step {
            "probe" => self.probe(&work).await,
            "proxy" => self.proxy(&work).await,
            "derivatives" => self.derivatives(&work).await,
            "segments" => self.segments(&work).await,
            "transcribe" => self.transcribe(&work).await,
            "ready" => self.ready(&work).await,
            // describe, faces, embed, index: model and search steps arrive in later phases.
            _ => Ok(()),
        }
    }
}

impl StepRunner for IngestSteps {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.dispatch(job, step))
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(async move {
            let id = ClipId::parse(job.subject_id.as_str())?;
            self.catalogue
                .set_clip_status(&id, ClipStatus::Failed, Some(error.code))
                .await
        })
    }
}
