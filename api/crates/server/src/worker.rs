//! Worker loop: a small pool of tasks, each claiming and running one job at a time.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_core::domain::job::Job;
use nimbytes_core::ports::{Clock, JobQueue, PortResult, StepRunner};
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};

/// Ports a worker task needs.
#[derive(Clone)]
pub struct Worker {
    /// Queue to claim from.
    pub queue: Arc<dyn JobQueue>,
    /// Runs pipeline steps.
    pub runner: Arc<dyn StepRunner>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Sleep between polls of an empty queue.
    pub idle_poll: Duration,
}

impl Worker {
    /// Returns crashed `running` jobs to the queue, then starts `count` worker tasks.
    pub async fn start(self, count: usize) {
        match self.queue.requeue_running(self.clock.now_millis()).await {
            Ok(n) => tracing::info!(requeued = n, "worker start"),
            Err(err) => tracing::error!(code = ?err.code, message = %err.message, "requeue failed"),
        }
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
            };
            match run_next_job(&deps).await {
                Ok(true) => {}
                Ok(false) => tokio::time::sleep(self.idle_poll).await,
                Err(err) => {
                    tracing::error!(worker = n, code = ?err.code, message = %err.message, "queue error");
                    tokio::time::sleep(self.idle_poll).await;
                }
            }
        }
    }
}

/// Phase 1 step runner: every step is a logged no-op until the media and model steps land.
#[derive(Debug, Default)]
pub struct NoopSteps;

impl StepRunner for NoopSteps {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            tracing::info!(job = %job.id, subject = %job.subject_id, step, "step (no-op)");
            Ok(())
        })
    }
}
