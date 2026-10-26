//! Worker step: claim one job, run its remaining steps, record the outcome.

use crate::domain::job::{FailureOutcome, Job, JobKind, on_failure, remaining_steps};
use crate::error::AppError;
use crate::ports::{Clock, JobFailure, JobQueue, StepRunner};

/// Ports one worker iteration needs.
pub struct JobDeps<'a> {
    /// The queue to claim from.
    pub queue: &'a dyn JobQueue,
    /// Runs one step.
    pub runner: &'a dyn StepRunner,
    /// Time for claims, backoff and row timestamps.
    pub clock: &'a dyn Clock,
}

/// Claims and runs one job. Returns `false` when nothing was runnable.
///
/// A failed step re-queues the job with backoff, or marks it failed after the last attempt;
/// steps already finished are recorded and never rerun.
///
/// # Errors
/// Queue errors only; step errors are recorded on the job instead.
pub async fn run_next_job(deps: &JobDeps<'_>) -> Result<bool, AppError> {
    let Some(job) = deps.queue.claim(deps.clock.now_millis()).await? else {
        return Ok(false);
    };
    match run_steps(deps, &job).await {
        Ok(()) => deps.queue.done(&job.id, deps.clock.now_millis()).await?,
        Err(err) => {
            let failure = JobFailure {
                error: &err,
                now: deps.clock.now_millis(),
            };
            match on_failure(job.attempts, failure.now) {
                FailureOutcome::RetryAt(at) => deps.queue.retry_at(&job.id, failure, at).await?,
                FailureOutcome::Failed => deps.queue.fail(&job.id, failure).await?,
            }
        }
    }
    Ok(true)
}

async fn run_steps(deps: &JobDeps<'_>, job: &Job) -> Result<(), AppError> {
    let steps = match job.kind {
        JobKind::Ingest => remaining_steps(job.step.as_deref()),
        JobKind::Render | JobKind::Agent => &[],
    };
    for step in steps {
        deps.runner.run(job, step).await?;
        deps.queue
            .advance(&job.id, step, deps.clock.now_millis())
            .await?;
    }
    Ok(())
}
