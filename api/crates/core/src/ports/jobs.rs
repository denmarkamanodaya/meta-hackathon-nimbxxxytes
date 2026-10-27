//! Job queue, step runner and progress events.

use crate::domain::ids::JobId;
use crate::domain::job::{Job, JobKind, JobState, StepStatus};
use crate::error::AppError;
use crate::ports::{EpochMillis, PortResult};

/// A job to queue.
#[derive(Debug, Clone, Copy)]
pub struct NewJob<'a> {
    /// New job id.
    pub id: &'a JobId,
    /// What to do.
    pub kind: JobKind,
    /// The clip or short it works on.
    pub subject_id: &'a str,
}

/// A failed attempt: the error to record and when it happened.
#[derive(Debug, Clone, Copy)]
pub struct JobFailure<'a> {
    /// Recorded as the job's last error.
    pub error: &'a AppError,
    /// Time of the failure.
    pub now: EpochMillis,
}

/// Durable job queue.
pub trait JobQueue: Send + Sync {
    /// Queues a job runnable now. Idempotent per `(kind, subject_id)`: a second call is a no-op.
    fn enqueue<'a>(&'a self, job: NewJob<'a>, now: EpochMillis) -> PortResult<'a, ()>;

    /// Claims the oldest runnable queued job, marking it running and counting the attempt.
    /// Two concurrent claims never return the same job.
    fn claim(&self, now: EpochMillis) -> PortResult<'_, Option<Job>>;

    /// Records that `step` finished.
    fn advance<'a>(&'a self, id: &'a JobId, step: &'a str, now: EpochMillis) -> PortResult<'a, ()>;

    /// Puts a failed attempt back in the queue, runnable from `run_after`.
    fn retry_at<'a>(
        &'a self,
        id: &'a JobId,
        failure: JobFailure<'a>,
        run_after: EpochMillis,
    ) -> PortResult<'a, ()>;

    /// Marks the job failed for good.
    fn fail<'a>(&'a self, id: &'a JobId, failure: JobFailure<'a>) -> PortResult<'a, ()>;

    /// Marks the job done.
    fn done<'a>(&'a self, id: &'a JobId, now: EpochMillis) -> PortResult<'a, ()>;

    /// The job of `kind` for `subject_id`, if one was queued.
    fn find<'a>(&'a self, kind: JobKind, subject_id: &'a str) -> PortResult<'a, Option<JobState>>;

    /// Queues a `done` or `failed` job of `kind` for `subject_id` again from its first step with
    /// fresh attempts; a queued or running job is left alone.
    fn restart<'a>(
        &'a self,
        kind: JobKind,
        subject_id: &'a str,
        now: EpochMillis,
    ) -> PortResult<'a, ()>;

    /// Returns jobs left `running` by a crashed process to the queue; returns how many.
    fn requeue_running(&self, now: EpochMillis) -> PortResult<'_, u64>;

    /// Removes the `kind` job for `subject_id` in any state; none is not an error. A worker still
    /// running it records nothing more: its updates match no row, so it is never retried.
    fn cancel<'a>(&'a self, kind: JobKind, subject_id: &'a str) -> PortResult<'a, ()>;
}

/// Runs the steps of a job.
pub trait StepRunner: Send + Sync {
    /// Runs `step` for `job`; the step writes its own outputs and may be rerun after a crash.
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()>;

    /// Called once when the job gives up, after its last attempt failed with `error`.
    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()>;
}

/// Live progress for clients watching a subject (clip events over SSE). Fire and forget: a
/// listener that is gone or slow never fails the job.
pub trait ProgressSink: Send + Sync {
    /// Publishes that `step` of the job on `subject_id` changed to `status`.
    fn emit(&self, subject_id: &str, step: &str, status: StepStatus);
}
