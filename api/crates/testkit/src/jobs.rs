//! In-memory [`JobQueue`] and a scripted [`StepRunner`].

use std::sync::Mutex;

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::JobId;
use nimbytes_core::domain::job::Job;
use nimbytes_core::domain::job::{JobKind, JobState, JobStatus, StepStatus};
use nimbytes_core::ports::{
    EpochMillis, JobFailure, JobQueue, NewJob, PortResult, ProgressSink, StepRunner,
};

/// A stored job with its queue bookkeeping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredJob {
    /// The job as a worker sees it.
    pub job: Job,
    /// `queued`, `running`, `done` or `failed`.
    pub status: &'static str,
    /// Earliest claim time.
    pub run_after: EpochMillis,
    /// Last recorded error code and message.
    pub last_error: Option<String>,
}

/// Vec-backed queue with the same semantics as the SQLite one.
#[derive(Debug, Default)]
pub struct InMemoryJobQueue {
    jobs: Mutex<Vec<StoredJob>>,
}

impl InMemoryJobQueue {
    /// Snapshot of every job.
    pub fn all(&self) -> Vec<StoredJob> {
        crate::lock(&self.jobs).clone()
    }

    fn update(&self, id: &JobId, f: impl FnOnce(&mut StoredJob)) {
        if let Some(j) = crate::lock(&self.jobs).iter_mut().find(|j| &j.job.id == id) {
            f(j);
        }
    }
}

/// Last-error text: the code's variant name and the message.
fn error_text(failure: JobFailure<'_>) -> Option<String> {
    Some(format!(
        "{:?}: {}",
        failure.error.code, failure.error.message
    ))
}

impl JobQueue for InMemoryJobQueue {
    fn enqueue<'a>(&'a self, job: NewJob<'a>, now: EpochMillis) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut jobs = crate::lock(&self.jobs);
            let exists = jobs
                .iter()
                .any(|j| j.job.kind == job.kind && j.job.subject_id == job.subject_id);
            if !exists {
                jobs.push(StoredJob {
                    job: Job {
                        id: job.id.clone(),
                        kind: job.kind,
                        subject_id: job.subject_id.to_owned(),
                        step: None,
                        attempts: 0,
                    },
                    status: "queued",
                    run_after: now,
                    last_error: None,
                });
            }
            Ok(())
        })
    }

    fn claim(&self, now: EpochMillis) -> PortResult<'_, Option<Job>> {
        Box::pin(async move {
            let mut jobs = crate::lock(&self.jobs);
            let next = jobs
                .iter_mut()
                .filter(|j| j.status == "queued" && j.run_after <= now)
                .min_by(|a, b| a.run_after.cmp(&b.run_after).then(a.job.id.cmp(&b.job.id)));
            Ok(next.map(|j| {
                j.status = "running";
                j.job.attempts += 1;
                j.job.clone()
            }))
        })
    }

    fn advance<'a>(
        &'a self,
        id: &'a JobId,
        step: &'a str,
        _now: EpochMillis,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update(id, |j| j.job.step = Some(step.to_owned()));
            Ok(())
        })
    }

    fn retry_at<'a>(
        &'a self,
        id: &'a JobId,
        failure: JobFailure<'a>,
        run_after: EpochMillis,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update(id, |j| {
                j.status = "queued";
                j.run_after = run_after;
                j.last_error = error_text(failure);
            });
            Ok(())
        })
    }

    fn fail<'a>(&'a self, id: &'a JobId, failure: JobFailure<'a>) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update(id, |j| {
                j.status = "failed";
                j.last_error = error_text(failure);
            });
            Ok(())
        })
    }

    fn done<'a>(&'a self, id: &'a JobId, _now: EpochMillis) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.update(id, |j| j.status = "done");
            Ok(())
        })
    }

    fn find<'a>(&'a self, kind: JobKind, subject_id: &'a str) -> PortResult<'a, Option<JobState>> {
        Box::pin(async move {
            let jobs = crate::lock(&self.jobs);
            let found = jobs
                .iter()
                .find(|j| j.job.kind == kind && j.job.subject_id == subject_id);
            found
                .map(|j| {
                    Ok(JobState {
                        id: j.job.id.clone(),
                        step: j.job.step.clone(),
                        status: JobStatus::parse(j.status)?,
                    })
                })
                .transpose()
        })
    }

    fn restart<'a>(
        &'a self,
        kind: JobKind,
        subject_id: &'a str,
        now: EpochMillis,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            for j in crate::lock(&self.jobs).iter_mut() {
                let finished = j.status == "done" || j.status == "failed";
                if j.job.kind == kind && j.job.subject_id == subject_id && finished {
                    (j.status, j.job.step, j.job.attempts) = ("queued", None, 0);
                    (j.run_after, j.last_error) = (now, None);
                }
            }
            Ok(())
        })
    }

    fn requeue_running(&self, _now: EpochMillis) -> PortResult<'_, u64> {
        Box::pin(async move {
            let mut n = 0;
            for j in crate::lock(&self.jobs)
                .iter_mut()
                .filter(|j| j.status == "running")
            {
                j.status = "queued";
                n += 1;
            }
            Ok(n)
        })
    }

    fn cancel<'a>(&'a self, kind: JobKind, subject_id: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.jobs)
                .retain(|j| !(j.job.kind == kind && j.job.subject_id == subject_id));
            Ok(())
        })
    }
}

/// [`StepRunner`] that records each step it runs and fails on one chosen step.
#[derive(Debug, Default)]
pub struct ScriptedSteps {
    ran: Mutex<Vec<String>>,
    fail_on: Mutex<Option<(String, AppError)>>,
    gave_up: Mutex<Vec<String>>,
}

impl ScriptedSteps {
    /// Makes every run of `step` fail with `error`.
    pub fn fail_on(&self, step: &str, error: AppError) {
        *crate::lock(&self.fail_on) = Some((step.to_owned(), error));
    }

    /// Steps run so far, in order.
    pub fn ran(&self) -> Vec<String> {
        crate::lock(&self.ran).clone()
    }

    /// Error codes of jobs the worker gave up on, via `failed`.
    pub fn gave_up(&self) -> Vec<String> {
        crate::lock(&self.gave_up).clone()
    }
}

impl StepRunner for ScriptedSteps {
    fn run<'a>(&'a self, _job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            if let Some((bad, err)) = crate::lock(&self.fail_on).clone()
                && bad == step
            {
                return Err(err);
            }
            crate::lock(&self.ran).push(step.to_owned());
            Ok(())
        })
    }

    fn failed<'a>(&'a self, _job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.gave_up).push(format!("{:?}", error.code));
            Ok(())
        })
    }
}

/// [`ProgressSink`] that records every event as `subject step status`.
#[derive(Debug, Default)]
pub struct RecordedProgress {
    events: Mutex<Vec<String>>,
}

impl RecordedProgress {
    /// Events so far, e.g. `clip-1 probe Running`.
    pub fn events(&self) -> Vec<String> {
        crate::lock(&self.events).clone()
    }
}

impl ProgressSink for RecordedProgress {
    fn emit(&self, subject_id: &str, step: &str, status: StepStatus) {
        crate::lock(&self.events).push(format!("{subject_id} {step} {status:?}"));
    }
}
