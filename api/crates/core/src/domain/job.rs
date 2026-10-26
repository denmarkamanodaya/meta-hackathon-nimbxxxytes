//! Background jobs: kinds, the ingest step list and the retry rule.

use crate::domain::ids::JobId;
use crate::error::{AppError, ErrorCode};
use crate::ports::EpochMillis;

/// Attempts before a job is marked failed.
pub const MAX_ATTEMPTS: u32 = 3;
/// Delay before the first retry; doubles per attempt.
pub const BASE_BACKOFF_MS: i64 = 5_000;

/// Ingest steps in order. Each step writes its output then advances `jobs.step`, so a restarted
/// worker resumes at the recorded step.
pub const INGEST_STEPS: [&str; 10] = [
    "probe",
    "proxy",
    "derivatives",
    "segments",
    "transcribe",
    "describe",
    "faces",
    "embed",
    "index",
    "ready",
];

/// What a job does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobKind {
    /// Understand one uploaded clip.
    Ingest,
    /// Render a final short.
    Render,
    /// Run the editing agent for a short.
    Agent,
}

impl JobKind {
    /// Stored text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ingest => "ingest",
            Self::Render => "render",
            Self::Agent => "agent",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::Ingest, Self::Render, Self::Agent]
            .into_iter()
            .find(|k| k.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad job kind {raw}")))
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

/// Steps still to run after `done_step` (all of them when `None`).
pub fn remaining_steps(done_step: Option<&str>) -> &'static [&'static str] {
    match done_step.and_then(|s| INGEST_STEPS.iter().position(|x| *x == s)) {
        Some(i) => &INGEST_STEPS[i + 1..],
        None => &INGEST_STEPS,
    }
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
        assert_eq!(remaining_steps(None).len(), 10);
        assert_eq!(remaining_steps(Some("probe"))[0], "proxy");
        assert!(remaining_steps(Some("ready")).is_empty());
    }

    #[test]
    fn kind_text_round_trips() {
        for k in [JobKind::Ingest, JobKind::Render, JobKind::Agent] {
            assert_eq!(JobKind::parse(k.as_str()).unwrap(), k);
        }
    }
}
