//! Driven ports the core needs from outside. Each is `Send + Sync`, speaks domain types only and
//! returns [`BoxFuture`] so ports can be used as trait objects.

use std::future::Future;
use std::pin::Pin;

use crate::domain::clip::Clip;
use crate::domain::ids::{ClipId, JobId, UploadId, UserId};
use crate::domain::job::{Job, JobKind};
use crate::domain::upload::{CompletedPart, Upload};
use crate::error::AppError;
use crate::keys::{ObjectClass, ObjectKey};

/// Wall-clock instant as milliseconds since the Unix epoch (UTC).
pub type EpochMillis = i64;

/// Boxed, sendable future returned by async port methods.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Result of a port call.
pub type PortResult<'a, T> = BoxFuture<'a, Result<T, AppError>>;

/// Source of the current time; the only way core code learns "now".
pub trait Clock: Send + Sync {
    /// Returns the current instant in milliseconds since the Unix epoch (UTC).
    fn now_millis(&self) -> EpochMillis;
}

/// Source of new unique ids (UUIDv7 text in production, so ids sort by creation time).
pub trait IdGenerator: Send + Sync {
    /// Returns a new id that sorts after every id this generator returned before.
    fn new_id(&self) -> String;
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
}

/// Users, clips and uploads.
pub trait Catalogue: Send + Sync {
    /// Returns the demo account's id, creating the row with `new_id` the first time.
    fn demo_user<'a>(&'a self, new_id: &'a UserId, now: &'a str) -> PortResult<'a, UserId>;

    /// Inserts a new clip and its upload in one transaction.
    fn insert_upload<'a>(&'a self, clip: &'a Clip, upload: &'a Upload) -> PortResult<'a, ()>;

    /// Looks up an upload by our id.
    fn get_upload<'a>(&'a self, id: &'a UploadId) -> PortResult<'a, Option<Upload>>;

    /// Marks the upload completed and its clip `uploaded`, in one transaction.
    fn finish_upload<'a>(&'a self, upload: &'a UploadId, clip: &'a ClipId) -> PortResult<'a, ()>;

    /// Lists a user's clips, newest first.
    fn list_clips<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Clip>>;
}

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

    /// Returns jobs left `running` by a crashed process to the queue; returns how many.
    fn requeue_running(&self, now: EpochMillis) -> PortResult<'_, u64>;
}

/// Runs one pipeline step of a job.
pub trait StepRunner: Send + Sync {
    /// Runs `step` for `job`; the step writes its own outputs.
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()>;
}
