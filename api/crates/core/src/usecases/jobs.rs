//! Worker step: claim one job, run its remaining steps, record the outcome, publish progress.

use std::sync::Arc;

use crate::domain::ids::{ClipId, JobId};
use crate::domain::job::{FailureOutcome, Job, JobKind, StepStatus, on_failure, steps_after};
use crate::error::AppError;
use crate::ports::{
    Catalogue, Clock, EpochMillis, IdGenerator, JobFailure, JobQueue, NewJob, PortResult,
    ProgressSink, StepRunner,
};

/// Sends each job to the runner for its kind: ingest, title, hash, faces and similar jobs to the
/// ingest pipeline,
/// agent and render jobs to the shorts steps, face vector jobs to the face matching steps, guide
/// jobs to MyWay, read jobs to iRead.
pub struct ByKind {
    /// Runs `ingest`, `title` and `hash` jobs.
    pub ingest: Arc<dyn StepRunner>,
    /// Runs `agent` and `render` jobs.
    pub shorts: Arc<dyn StepRunner>,
    /// Runs `face_vectors` jobs.
    pub faces: Arc<dyn StepRunner>,
    /// Runs `guide` jobs.
    pub guides: Arc<dyn StepRunner>,
    /// Runs `read` jobs.
    pub documents: Arc<dyn StepRunner>,
}

impl ByKind {
    fn pick(&self, job: &Job) -> &dyn StepRunner {
        match job.kind {
            JobKind::Ingest
            | JobKind::Title
            | JobKind::Hash
            | JobKind::Faces
            | JobKind::Similar => self.ingest.as_ref(),
            JobKind::Agent | JobKind::Render => self.shorts.as_ref(),
            JobKind::FaceVectors => self.faces.as_ref(),
            JobKind::Guide => self.guides.as_ref(),
            JobKind::Read => self.documents.as_ref(),
        }
    }
}

impl StepRunner for ByKind {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        self.pick(job).run(job, step)
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        self.pick(job).failed(job, error)
    }
}

/// Queues a `kind` job for each clip (a finished one runs again). Returns how many.
async fn queue_for_clips(
    queue: &dyn JobQueue,
    (ids, clock): (&dyn IdGenerator, &dyn Clock),
    kind: JobKind,
    clips: &[ClipId],
) -> Result<usize, AppError> {
    let now = clock.now_millis();
    for clip in clips {
        let id = JobId::parse(ids.new_id())?;
        let job = NewJob {
            id: &id,
            kind,
            subject_id: clip.as_str(),
        };
        queue.enqueue(job, now).await?;
        queue.restart(kind, clip.as_str(), now).await?;
    }
    Ok(clips.len())
}

/// Queues a title job for every ready clip without a title (clips ingested before titles, or
/// whose title call failed); a finished title job of such a clip is run again. Returns how many
/// clips were queued.
///
/// # Errors
/// Catalogue and queue errors.
pub async fn backfill_titles(
    catalogue: &dyn Catalogue,
    queue: &dyn JobQueue,
    stamps: (&dyn IdGenerator, &dyn Clock),
) -> Result<usize, AppError> {
    let clips = catalogue.untitled_ready().await?;
    queue_for_clips(queue, stamps, JobKind::Title, &clips).await
}

/// Queues one `faces` job per ready clip that never had one, so every clip gets the current face
/// rules once (SAM's answer is cached, so no new model call). Returns how many clips were queued.
///
/// # Errors
/// Catalogue and queue errors.
pub async fn backfill_faces(
    catalogue: &dyn Catalogue,
    queue: &dyn JobQueue,
    (ids, clock): (&dyn IdGenerator, &dyn Clock),
) -> Result<usize, AppError> {
    let clips = catalogue.ready_clips().await?;
    let now = clock.now_millis();
    for clip in &clips {
        let id = JobId::parse(ids.new_id())?;
        let job = NewJob {
            id: &id,
            kind: JobKind::Faces,
            subject_id: clip.as_str(),
        };
        // A clip that already had a faces job keeps it: the insert is ignored.
        queue.enqueue(job, now).await?;
    }
    Ok(clips.len())
}

/// Reruns the finished `faces` job of every ready clip from its first step, so the current faces
/// step (which stores face boxes) runs once more for clips made before it. SAM's answer is
/// cached, so there is no new model call. A queued or running job is left alone. Returns how
/// many clips were asked.
///
/// # Errors
/// Catalogue and queue errors.
pub async fn restart_faces(
    catalogue: &dyn Catalogue,
    queue: &dyn JobQueue,
    now: EpochMillis,
) -> Result<usize, AppError> {
    let clips = catalogue.ready_clips().await?;
    for clip in &clips {
        queue.restart(JobKind::Faces, clip.as_str(), now).await?;
    }
    Ok(clips.len())
}

/// Queues a hash job for every ready clip whose original has no hash yet (clips from before
/// duplicate detection). Returns how many clips were queued.
///
/// # Errors
/// Catalogue and queue errors.
pub async fn backfill_hashes(
    catalogue: &dyn Catalogue,
    queue: &dyn JobQueue,
    stamps: (&dyn IdGenerator, &dyn Clock),
) -> Result<usize, AppError> {
    let clips = catalogue.unhashed().await?;
    queue_for_clips(queue, stamps, JobKind::Hash, &clips).await
}

/// Queues a `similar` job for every ready clip ingested before near-copy detection (a segment
/// never checked for blankness), so the existing library is linked once: the job embeds the
/// thumbnails again, which marks them checked. Returns how many clips were queued.
///
/// # Errors
/// Catalogue and queue errors.
pub async fn backfill_similar(
    catalogue: &dyn Catalogue,
    queue: &dyn JobQueue,
    stamps: (&dyn IdGenerator, &dyn Clock),
) -> Result<usize, AppError> {
    let clips = catalogue.unchecked_ready().await?;
    queue_for_clips(queue, stamps, JobKind::Similar, &clips).await
}

/// Ports one worker iteration needs.
pub struct JobDeps<'a> {
    /// The queue to claim from.
    pub queue: &'a dyn JobQueue,
    /// Runs one step.
    pub runner: &'a dyn StepRunner,
    /// Time for claims, backoff and row timestamps.
    pub clock: &'a dyn Clock,
    /// Live step events.
    pub progress: &'a dyn ProgressSink,
}

/// Claims and runs one job. Returns `false` when nothing was runnable.
///
/// Each step publishes `running` then `done`. A failed step re-queues the job with backoff, or,
/// after the last attempt, marks it failed, tells the runner and publishes `failed`. Steps already
/// finished are recorded and never rerun.
///
/// # Errors
/// Queue errors only; step errors are recorded on the job instead.
pub async fn run_next_job(deps: &JobDeps<'_>) -> Result<bool, AppError> {
    let Some(job) = deps.queue.claim(deps.clock.now_millis()).await? else {
        return Ok(false);
    };
    match run_steps(deps, &job).await {
        Ok(()) => deps.queue.done(&job.id, deps.clock.now_millis()).await?,
        Err((step, err)) => {
            let failure = JobFailure {
                error: &err,
                now: deps.clock.now_millis(),
            };
            match on_failure(job.attempts, failure.now) {
                FailureOutcome::RetryAt(at) => deps.queue.retry_at(&job.id, failure, at).await?,
                FailureOutcome::Failed => {
                    deps.queue.fail(&job.id, failure).await?;
                    deps.runner.failed(&job, &err).await?;
                    deps.progress
                        .emit(&job.subject_id, step, StepStatus::Failed);
                }
            }
        }
    }
    Ok(true)
}

async fn run_steps(deps: &JobDeps<'_>, job: &Job) -> Result<(), (&'static str, AppError)> {
    let steps = steps_after(job.kind, job.step.as_deref());
    for &step in steps {
        deps.progress
            .emit(&job.subject_id, step, StepStatus::Running);
        deps.runner.run(job, step).await.map_err(|e| (step, e))?;
        let now = deps.clock.now_millis();
        deps.queue
            .advance(&job.id, step, now)
            .await
            .map_err(|e| (step, e))?;
        deps.progress.emit(&job.subject_id, step, StepStatus::Done);
    }
    Ok(())
}
