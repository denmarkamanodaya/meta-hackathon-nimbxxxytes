//! Ingest pipeline: the [`StepRunner`] for `ingest` jobs. Each step reads what earlier steps left
//! (local scratch files, re-downloaded from storage when a restart lost them, or catalogue rows),
//! writes its outputs, and can be rerun after a crash without duplicating anything: ids and keys
//! are deterministic, and model calls are cached by their adapter.

mod duplicates;
mod similar;
mod steps;
mod title;
mod understand;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::ids::ClipId;
use crate::domain::job::{Job, JobKind};
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;
use crate::ports::{
    BlobStore, Catalogue, ClipLinkStore, Clock, Embedder, FaceMatchStore, FaceTracker, IdGenerator,
    JobQueue, MediaTool, PortResult, PrivacyStore, Scratch, SegmentDescriber, StepRunner,
    TextIndex, Titler, Transcriber, VectorIndex,
};
use similar::Pass;

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
    /// Segment facts.
    pub describer: Arc<dyn SegmentDescriber>,
    /// Face tracks.
    pub tracker: Arc<dyn FaceTracker>,
    /// Image embeddings.
    pub embedder: Arc<dyn Embedder>,
    /// Segment vectors.
    pub vectors: Arc<dyn VectorIndex>,
    /// Segment documents.
    pub text_index: Arc<dyn TextIndex>,
    /// Clip titles.
    pub titler: Arc<dyn Titler>,
    /// Face matching follow-up for owners who turned it on.
    pub face_matching: FaceFollowUp,
    /// Each face track's boxes, for the privacy blur.
    pub privacy: Arc<dyn PrivacyStore>,
    /// Near-copy and same-moment links.
    pub links: Arc<dyn ClipLinkStore>,
    /// Link times.
    pub clock: Arc<dyn Clock>,
}

/// What the ready step needs to queue a face matching job.
#[derive(Clone)]
pub struct FaceFollowUp {
    /// The owner's switch.
    pub faces: Arc<dyn FaceMatchStore>,
    /// The job queue.
    pub jobs: Arc<dyn JobQueue>,
    /// Job ids.
    pub ids: Arc<dyn IdGenerator>,
    /// Job times.
    pub clock: Arc<dyn Clock>,
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
        // The title reads catalogue rows only, so it needs no scratch directory (a backfill job
        // runs it on a clip whose scratch files are long gone).
        if step == "title" {
            return self.title(&ClipId::parse(job.subject_id.as_str())?).await;
        }
        let work = self.work(job).await?;
        // A copy (exact or near) is not ingested: every later step only frees the scratch space
        // at the end. Keep both on a near-copy makes it `processing` and resumes the job.
        if work.clip.is_copy() {
            return match step {
                "ready" => self.scratch.remove_clip_dir(&work.clip.id).await,
                _ => Ok(()),
            };
        }
        if job.kind == JobKind::Similar && step == "similar" {
            self.similar(&work, Pass::Backfill).await?;
            return self.scratch.remove_clip_dir(&work.clip.id).await;
        }
        match step {
            "hash" => self.hash(&work).await,
            "probe" => self.probe(&work).await,
            "proxy" => self.proxy(&work).await,
            "derivatives" => self.derivatives(&work).await,
            "segments" => self.segments(&work).await,
            "embed" => self.embed(&work).await,
            "similar" => self.similar(&work, Pass::Ingest).await,
            "transcribe" => self.transcribe(&work).await,
            "describe" => self.describe(&work).await,
            "faces" => self.faces(&work).await,
            "index" => self.index(&work).await,
            "ready" => self.ready(&work).await,
            "tidy" => self.tidy(&work).await,
            other => Err(AppError::new(
                ErrorCode::Internal,
                format!("unknown ingest step {other}"),
            )),
        }
    }
}

impl StepRunner for IngestSteps {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.dispatch(job, step))
    }

    /// Only a failed ingest fails the clip: a title or hash backfill job that gives up leaves an
    /// already ready clip as it is.
    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(async move {
            if job.kind != JobKind::Ingest {
                return Ok(());
            }
            let id = ClipId::parse(job.subject_id.as_str())?;
            self.catalogue
                .set_clip_status(&id, ClipStatus::Failed, Some(error.code))
                .await
        })
    }
}
