//! Worker loop: a small pool of tasks, each claiming and running one job at a time.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_core::ports::{
    BlobStore, Catalogue, Clock, IdGenerator, JobQueue, ProgressSink, ShortStore, StepRunner,
    UsageStore,
};
use nimbytes_core::usecases::jobs::{
    JobDeps, backfill_faces, backfill_hashes, backfill_similar, backfill_titles, run_next_job,
};
use nimbytes_core::usecases::shorts::{PreviewCleanupDeps, clean_previews};

use crate::usage::UsageRefresh;

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
