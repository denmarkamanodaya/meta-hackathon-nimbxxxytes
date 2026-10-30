//! Worker loop: a small pool of tasks, each claiming and running one job at a time.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_core::AppError;
use nimbytes_core::domain::job::Job;
use nimbytes_core::ports::{
    BlobStore, Catalogue, Clock, IdGenerator, JobQueue, PortResult, ProgressSink, ShortStore,
    StepRunner, UsageStore,
};
use nimbytes_core::usecases::jobs::{
    JobDeps, backfill_faces, backfill_hashes, backfill_similar, backfill_titles, run_next_job,
};
use nimbytes_core::usecases::shorts::{PreviewCleanupDeps, clean_previews};

use crate::usage::UsageRefresh;

/// Logs every failed job step with the job's kind, subject (a clip, short, guide, document or
/// listen id), step and attempt, and every job that gave up, then passes the outcome on unchanged.
pub struct LoggedSteps(pub Arc<dyn StepRunner>);

impl StepRunner for LoggedSteps {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            let outcome = self.0.run(job, step).await;
            if let Err(err) = &outcome {
                tracing::warn!(
                    kind = job.kind.as_str(),
                    subject = %job.subject_id,
                    step,
                    attempt = job.attempts,
                    code = ?err.code,
                    message = %err.message,
                    "job step failed"
                );
            }
            outcome
        })
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        tracing::error!(
            kind = job.kind.as_str(),
            subject = %job.subject_id,
            done_through = job.step.as_deref().unwrap_or("-"),
            code = ?error.code,
            message = %error.message,
            "job gave up"
        );
        self.0.failed(job, error)
    }
}

/// Ports a worker task needs.
#[derive(Clone)]
pub struct Worker {
    /// Queue to claim from.
    pub queue: Arc<dyn JobQueue>,
    /// Runs pipeline steps.
    pub runner: Arc<dyn StepRunner>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Live step events.
    pub progress: Arc<dyn ProgressSink>,
    /// Sleep between polls of an empty queue.
    pub idle_poll: Duration,
    /// Clips, for the title backfill.
    pub catalogue: Arc<dyn Catalogue>,
    /// Job ids for the title backfill.
    pub ids: Arc<dyn IdGenerator>,
    /// The preview cleanup, where the store has no lifecycle rule for previews (R2).
    pub previews: Option<PreviewCleanup>,
    /// The storage measurement loop; every finished job asks it for a fresh measurement.
    pub usage: UsageMeasuring,
}

/// What the storage measurement loop runs over.
#[derive(Clone)]
pub struct UsageMeasuring {
    /// Its wake-up, shared with the handlers and runs.
    pub refresh: Arc<UsageRefresh>,
    /// Where measurements are kept.
    pub usage: Arc<dyn UsageStore>,
    /// The store measured.
    pub blobs: Arc<dyn BlobStore>,
    /// Time between measurements when nothing asks sooner.
    pub every: Duration,
    /// Wait after a poke before measuring.
    pub settle: Duration,
}

/// Removes expired agent previews at start and then every `every`.
#[derive(Clone)]
pub struct PreviewCleanup {
    /// Shorts and versions.
    pub shorts: Arc<dyn ShortStore>,
    /// The preview objects.
    pub blobs: Arc<dyn BlobStore>,
    /// Time between runs.
    pub every: Duration,
}

impl PreviewCleanup {
    async fn run(self, clock: Arc<dyn Clock>) {
        loop {
            let deps = PreviewCleanupDeps {
                shorts: self.shorts.as_ref(),
                blobs: self.blobs.as_ref(),
                clock: clock.as_ref(),
            };
            match clean_previews(&deps).await {
                Ok(n) => tracing::info!(removed = n, "preview cleanup"),
                Err(err) => {
                    tracing::error!(code = ?err.code, message = %err.message, "preview cleanup failed")
                }
            }
            tokio::time::sleep(self.every).await;
        }
    }
}

impl Worker {
    /// Queues the one-off backfills: hashes, faces, titles and near-copy links.
    async fn queue_backfills(&self) {
        let backfill = (self.ids.as_ref(), self.clock.as_ref());
        match backfill_hashes(self.catalogue.as_ref(), self.queue.as_ref(), backfill).await {
            Ok(n) => tracing::info!(queued = n, "hash backfill"),
            Err(err) => {
                tracing::error!(code = ?err.code, message = %err.message, "hash backfill failed")
            }
        }
        match backfill_faces(self.catalogue.as_ref(), self.queue.as_ref(), backfill).await {
            Ok(n) => tracing::info!(clips = n, "faces backfill"),
            Err(err) => {
                tracing::error!(code = ?err.code, message = %err.message, "faces backfill failed")
            }
        }
        match backfill_titles(self.catalogue.as_ref(), self.queue.as_ref(), backfill).await {
            Ok(n) => tracing::info!(queued = n, "title backfill"),
            Err(err) => {
                tracing::error!(code = ?err.code, message = %err.message, "title backfill failed")
            }
        }
        match backfill_similar(self.catalogue.as_ref(), self.queue.as_ref(), backfill).await {
            Ok(n) => tracing::info!(queued = n, "near-copy backfill"),
            Err(err) => {
                tracing::error!(code = ?err.code, message = %err.message, "near-copy backfill failed")
            }
        }
    }

    /// Returns crashed `running` jobs to the queue, queues hashes for clips without one and titles
    /// for ready clips without one, starts the preview cleanup when there is one and the storage
    /// measurement loop, then starts `count` worker tasks.
    pub async fn start(self, count: usize) {
        match self.queue.requeue_running(self.clock.now_millis()).await {
            Ok(n) => tracing::info!(requeued = n, "worker start"),
            Err(err) => tracing::error!(code = ?err.code, message = %err.message, "requeue failed"),
        }
        self.queue_backfills().await;
        if let Some(cleanup) = self.previews.clone() {
            tokio::spawn(cleanup.run(self.clock.clone()));
        }
        let m = self.usage.clone();
        let ports = (m.usage, m.blobs, self.clock.clone());
        tokio::spawn(m.refresh.run(ports, (m.every, m.settle)));
        for n in 0..count {
            let worker = self.clone();
            tokio::spawn(async move { worker.run(n).await });
        }
    }

    async fn run(self, n: usize) {
        loop {
            let deps = JobDeps {
                queue: self.queue.as_ref(),
                runner: self.runner.as_ref(),
                clock: self.clock.as_ref(),
                progress: self.progress.as_ref(),
            };
            match run_next_job(&deps).await {
                // A job may have written (ingest files, renders) or removed objects.
                Ok(true) => self.usage.refresh.poke(),
                Ok(false) => tokio::time::sleep(self.idle_poll).await,
                Err(err) => {
                    tracing::error!(worker = n, code = ?err.code, message = %err.message, "queue error");
                    tokio::time::sleep(self.idle_poll).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod logged_tests {
    use nimbytes_core::ErrorCode;
    use nimbytes_core::domain::ids::JobId;
    use nimbytes_core::domain::job::JobKind;
    use nimbytes_testkit::ScriptedSteps;

    use super::*;

    #[tokio::test]
    async fn logging_passes_every_outcome_on_unchanged() {
        let inner = Arc::new(ScriptedSteps::default());
        inner.fail_on("cover", AppError::new(ErrorCode::Internal, "s3: IO error"));
        let logged = LoggedSteps(inner.clone());
        let job = Job {
            id: JobId::parse("j1").unwrap(),
            kind: JobKind::Listen,
            subject_id: "l1".into(),
            step: Some("check".into()),
            attempts: 3,
        };

        assert!(logged.run(&job, "voice").await.is_ok());
        let err = logged.run(&job, "cover").await.unwrap_err();
        assert_eq!(err.message, "s3: IO error");
        logged.failed(&job, &err).await.unwrap();

        assert_eq!(
            inner.ran(),
            ["voice"],
            "the failed step is not recorded as run"
        );
        assert_eq!(inner.gave_up(), ["Internal"]);
    }
}
