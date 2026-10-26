//! Worker step: claim one job, run its remaining steps, record the outcome, publish progress.

use std::sync::Arc;

use crate::domain::job::{FailureOutcome, Job, JobKind, StepStatus, on_failure, steps_after};
use crate::error::AppError;
use crate::ports::{Clock, JobFailure, JobQueue, PortResult, ProgressSink, StepRunner};

/// Sends each job to the runner for its kind: ingest jobs to the ingest pipeline, agent and
/// render jobs to the shorts steps.
pub struct ByKind {
    /// Runs `ingest` jobs.
    pub ingest: Arc<dyn StepRunner>,
    /// Runs `agent` and `render` jobs.
    pub shorts: Arc<dyn StepRunner>,
}

impl ByKind {
    fn pick(&self, job: &Job) -> &dyn StepRunner {
        match job.kind {
            JobKind::Ingest => self.ingest.as_ref(),
            JobKind::Agent | JobKind::Render => self.shorts.as_ref(),
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
