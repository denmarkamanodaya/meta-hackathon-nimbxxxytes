//! Background jobs: kinds, the ingest step list and the retry rule.

use serde::{Deserialize, Serialize};

use crate::domain::ids::JobId;
use crate::error::{AppError, ErrorCode};
use crate::ports::EpochMillis;

/// Attempts before a job is marked failed.
pub const MAX_ATTEMPTS: u32 = 3;
/// Delay before the first retry; doubles per attempt.
pub const BASE_BACKOFF_MS: i64 = 5_000;

/// Agent steps: one resumable editing loop (plan, preview, critique, revise).
pub const AGENT_STEPS: [&str; 1] = ["edit"];

/// Face matching steps for one user: embed new face crops, then let Spark check new close pairs.
pub const FACE_VECTOR_STEPS: [&str; 2] = ["embed", "match"];

/// Hash backfill steps.
pub const HASH_STEPS: [&str; 1] = ["hash"];

/// Title backfill steps.
pub const TITLE_STEPS: [&str; 1] = ["title"];

/// Final-render steps.
pub const RENDER_STEPS: [&str; 1] = ["render"];

/// Ingest steps in order. Each step writes its output then advances `jobs.step`, so a restarted
/// worker resumes at the recorded step.
pub const INGEST_STEPS: [&str; 11] = [
    "probe",
    "proxy",
    "derivatives",
    "segments",
    "transcribe",
    "describe",
    "title",
    "faces",
    "embed",
    "index",
    "ready",
];

/// State of one pipeline step, as clip events report it. Serialised lower case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    /// Step started.
    Running,
    /// Step finished.
    Done,
    /// The job gave up on this step.
    Failed,
}

/// What a job does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobKind {
    /// Understand one uploaded clip.
    Ingest,
    /// Render a final short.
    Render,
    /// Run the editing agent for a short.
    Agent,
    /// Write the title of a ready clip that has none (backfill for clips ingested before titles).
    Title,
    /// Hash the original of a clip ingested before hashing, and mark it if it is a copy.
    Hash,
    /// Embed a user's new face crops and check close pairs (only while their switch is on); the
    /// subject is the user id.
    FaceVectors,
}

impl JobKind {
    /// Stored text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ingest => "ingest",
            Self::Render => "render",
            Self::Agent => "agent",
            Self::Title => "title",
            Self::Hash => "hash",
            Self::FaceVectors => "face_vectors",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [
            Self::Ingest,
            Self::Render,
            Self::Agent,
            Self::Title,
            Self::Hash,
            Self::FaceVectors,
        ]
        .into_iter()
        .find(|k| k.as_str() == raw)
        .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad job kind {raw}")))
    }
}

/// Queue state of a job row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobStatus {
    /// Waiting to be claimed (first time or after a retryable failure).
    Queued,
    /// Claimed by a worker.
    Running,
    /// Every step finished.
    Done,
    /// Gave up after the last attempt.
    Failed,
}

impl JobStatus {
    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        match raw {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "done" => Ok(Self::Done),
            "failed" => Ok(Self::Failed),
            _ => Err(AppError::new(
                ErrorCode::Internal,
                format!("bad job status {raw}"),
            )),
        }
    }
}

/// Where a subject's job is: last finished step and queue state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JobState {
    /// The job.
    pub id: JobId,
    /// Last finished step, or `None` before the first.
    pub step: Option<String>,
    /// Queue state.
    pub status: JobStatus,
}

/// The progress event a client that connects now should see first, so it does not wait for the
/// next change: the step in flight (or next) as `running`, `ready done` when finished, or the
/// step that failed. `None` when no ingest job exists yet.
pub fn progress_snapshot(job: Option<&JobState>) -> Option<(&'static str, StepStatus)> {
    let job = job?;
    let next = remaining_steps(job.step.as_deref()).first().copied();
    match job.status {
        JobStatus::Done => Some(("ready", StepStatus::Done)),
        JobStatus::Failed => Some((next.unwrap_or("ready"), StepStatus::Failed)),
        JobStatus::Queued | JobStatus::Running => {
            Some((next.unwrap_or("ready"), StepStatus::Running))
        }
    }
}

/// A claimed job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    /// Job id.
    pub id: JobId,
    /// What to do.
    pub kind: JobKind,
    /// The clip or short the job works on.
    pub subject_id: String,
    /// Last finished step, or `None` before the first step.
    pub step: Option<String>,
    /// Attempts so far, including the current one.
    pub attempts: u32,
}

/// What to do with a job whose attempt just failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureOutcome {
    /// Queue it again, runnable at this instant.
    RetryAt(EpochMillis),
    /// Give up: attempts are used up.
    Failed,
}

/// Retry rule: after attempt `attempts` fails at `now`, retry after 5 s, 10 s, … until
/// [`MAX_ATTEMPTS`] attempts were made.
pub fn on_failure(attempts: u32, now: EpochMillis) -> FailureOutcome {
    if attempts >= MAX_ATTEMPTS {
        return FailureOutcome::Failed;
    }
    let factor = 1_i64 << attempts.saturating_sub(1).min(20);
    FailureOutcome::RetryAt(now + BASE_BACKOFF_MS * factor)
}

/// The steps of a job of `kind` still to run after `done_step` (all of them when `None`).
pub fn steps_after(kind: JobKind, done_step: Option<&str>) -> &'static [&'static str] {
    let all: &'static [&'static str] = match kind {
        JobKind::Ingest => &INGEST_STEPS,
        JobKind::Agent => &AGENT_STEPS,
        JobKind::Title => &TITLE_STEPS,
        JobKind::Hash => &HASH_STEPS,
        JobKind::FaceVectors => &FACE_VECTOR_STEPS,
        JobKind::Render => &RENDER_STEPS,
    };
    match done_step.and_then(|s| all.iter().position(|x| *x == s)) {
        Some(i) => &all[i + 1..],
        None => all,
    }
}

/// Ingest steps still to run after `done_step`.
pub fn remaining_steps(done_step: Option<&str>) -> &'static [&'static str] {
    steps_after(JobKind::Ingest, done_step)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_then_gives_up_on_the_third_failure() {
        assert_eq!(on_failure(1, 1_000), FailureOutcome::RetryAt(6_000));
        assert_eq!(on_failure(2, 1_000), FailureOutcome::RetryAt(11_000));
        assert_eq!(on_failure(3, 1_000), FailureOutcome::Failed);
    }

    #[test]
    fn remaining_steps_resume_after_the_recorded_step() {
        assert_eq!(remaining_steps(None).len(), 11, "title runs after describe");
        assert_eq!(remaining_steps(Some("probe"))[0], "proxy");
        assert!(remaining_steps(Some("ready")).is_empty());
        assert_eq!(steps_after(JobKind::Agent, None), ["edit"]);
        assert!(steps_after(JobKind::Agent, Some("edit")).is_empty());
        assert_eq!(steps_after(JobKind::Render, None), ["render"]);
        assert!(steps_after(JobKind::Render, Some("render")).is_empty());
        assert_eq!(steps_after(JobKind::Title, None), ["title"]);
        assert_eq!(JobKind::parse("title").unwrap(), JobKind::Title);
        assert_eq!(steps_after(JobKind::Hash, None), ["hash"]);
        assert_eq!(JobKind::parse("hash").unwrap(), JobKind::Hash);
        assert_eq!(steps_after(JobKind::FaceVectors, Some("embed")), ["match"]);
        assert_eq!(
            JobKind::parse("face_vectors").unwrap(),
            JobKind::FaceVectors
        );
    }

    #[test]
    fn snapshot_reports_the_step_in_flight_done_or_failed() {
        let state = |step: Option<&str>, status| JobState {
            id: JobId::parse("j1").unwrap(),
            step: step.map(str::to_owned),
            status,
        };
        assert_eq!(progress_snapshot(None), None);
        assert_eq!(
            progress_snapshot(Some(&state(None, JobStatus::Queued))),
            Some(("probe", StepStatus::Running))
        );
        assert_eq!(
            progress_snapshot(Some(&state(Some("segments"), JobStatus::Running))),
            Some(("transcribe", StepStatus::Running))
        );
        assert_eq!(
            progress_snapshot(Some(&state(Some("segments"), JobStatus::Failed))),
            Some(("transcribe", StepStatus::Failed))
        );
        assert_eq!(
            progress_snapshot(Some(&state(Some("ready"), JobStatus::Done))),
            Some(("ready", StepStatus::Done))
        );
    }

    #[test]
    fn kind_text_round_trips() {
        for k in [JobKind::Ingest, JobKind::Render, JobKind::Agent] {
            assert_eq!(JobKind::parse(k.as_str()).unwrap(), k);
        }
    }
}
