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

/// Steps of a `faces` job: the ingest face step again, then the scratch files go.
pub const FACES_STEPS: [&str; 2] = ["faces", "tidy"];

/// Steps of a `guide` job: one per [`crate::domain::guide::GuideStage`], in order.
pub const GUIDE_STEPS: [&str; 5] = ["steps", "frames", "highlight", "voice", "ready"];

/// Steps of a `read` job: page images, Spark reads them, the summary is spoken, done.
pub const READ_STEPS: [&str; 4] = ["pages", "read", "voice", "ready"];

/// Steps of a `listen` job: the audio as a WAV, its transcript, Spark's translation and summary,
/// the check loop, the cover drawn, the summary spoken, done.
pub const LISTEN_STEPS: [&str; 7] = [
    "audio",
    "transcribe",
    "understand",
    "check",
    "cover",
    "voice",
    "ready",
];

/// Steps of a `memory` job: the moments found (and their frames stored), Spark writes the
/// lines, Spark checks them, the cover drawn, done.
pub const MEMORY_STEPS: [&str; 5] = ["find", "write", "check", "cover", "ready"];

/// Steps of a `photo` job: the viewing copy and thumbnail, Spark's facts, the PE embedding,
/// the search document, done.
pub const PHOTO_STEPS: [&str; 5] = ["fit", "describe", "embed", "index", "ready"];

/// Steps of a `similar` backfill job on a ready clip: embed its thumbnails again (which also
/// marks blank ones), then link it to its near-copies and same-moment clips.
pub const SIMILAR_STEPS: [&str; 2] = ["embed", "similar"];

/// Final-render steps.
pub const RENDER_STEPS: [&str; 1] = ["render"];

/// Ingest steps in order. Each step writes its output then advances `jobs.step`, so a restarted
/// worker resumes at the recorded step. `embed` needs only the segment thumbnails, so it runs
/// right after `segments`, and `similar` stops a near-copy there, before the paid steps.
pub const INGEST_STEPS: [&str; 12] = [
    "probe",
    "proxy",
    "derivatives",
    "segments",
    "embed",
    "similar",
    "transcribe",
    "describe",
    "title",
    "faces",
    "index",
    "ready",
];

/// The step a kept near-copy's ingest resumes after (the next one is `transcribe`).
pub const KEEP_RESUMES_AFTER: &str = "similar";

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
    /// Run the face step again on a ready clip (backfill after the face rules changed).
    Faces,
    /// Make a MyWay guide; the subject is the guide id.
    Guide,
    /// Read an iRead document; the subject is the document id.
    Read,
    /// Link a ready clip ingested before near-copy detection to its near-copies and same-moment
    /// clips (backfill).
    Similar,
    /// Listen to an iListen recording; the subject is the listen id.
    Listen,
    /// Analyse a photo; the subject is the photo id.
    Photo,
    /// Make a Memory Lane session; the subject is the memory id.
    Memory,
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
            Self::Faces => "faces",
            Self::Guide => "guide",
            Self::Read => "read",
            Self::Similar => "similar",
            Self::Listen => "listen",
            Self::Photo => "photo",
            Self::Memory => "memory",
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
            Self::Faces,
            Self::Guide,
            Self::Read,
            Self::Similar,
            Self::Listen,
            Self::Photo,
            Self::Memory,
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
        JobKind::Faces => &FACES_STEPS,
        JobKind::Render => &RENDER_STEPS,
        JobKind::Guide => &GUIDE_STEPS,
        JobKind::Read => &READ_STEPS,
        JobKind::Similar => &SIMILAR_STEPS,
        JobKind::Listen => &LISTEN_STEPS,
        JobKind::Photo => &PHOTO_STEPS,
        JobKind::Memory => &MEMORY_STEPS,
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
        assert_eq!(remaining_steps(None).len(), 12, "title runs after describe");
        assert_eq!(
            remaining_steps(Some("segments"))[..3],
            ["embed", "similar", "transcribe"],
            "embed and similar run before the paid steps"
        );
        assert_eq!(remaining_steps(Some(KEEP_RESUMES_AFTER))[0], "transcribe");
        assert_eq!(remaining_steps(Some("faces")), ["index", "ready"]);
        assert_eq!(steps_after(JobKind::Similar, None), ["embed", "similar"]);
        assert_eq!(JobKind::parse("similar").unwrap(), JobKind::Similar);
        assert_eq!(remaining_steps(Some("probe"))[0], "proxy");
        assert!(remaining_steps(Some("ready")).is_empty());
        assert_eq!(steps_after(JobKind::Agent, None), ["edit"]);
        assert!(steps_after(JobKind::Agent, Some("edit")).is_empty());
        assert_eq!(steps_after(JobKind::Render, None), ["render"]);
        assert!(steps_after(JobKind::Render, Some("render")).is_empty());
        assert_eq!(steps_after(JobKind::Title, None), ["title"]);
        assert_eq!(JobKind::parse("title").unwrap(), JobKind::Title);
        assert_eq!(steps_after(JobKind::Faces, None), ["faces", "tidy"]);
        assert_eq!(JobKind::parse("faces").unwrap(), JobKind::Faces);
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
            progress_snapshot(Some(&state(Some("similar"), JobStatus::Running))),
            Some(("transcribe", StepStatus::Running))
        );
        assert_eq!(
            progress_snapshot(Some(&state(Some("similar"), JobStatus::Failed))),
            Some(("transcribe", StepStatus::Failed))
        );
        assert_eq!(
            progress_snapshot(Some(&state(Some("ready"), JobStatus::Done))),
            Some(("ready", StepStatus::Done))
        );
    }

    #[test]
    fn guide_jobs_run_one_step_per_stage_and_resume_after_the_last_done() {
        let stages: Vec<&str> = crate::domain::guide::GuideStage::ALL
            .iter()
            .map(|s| s.as_str())
            .collect();
        assert_eq!(steps_after(JobKind::Guide, None), stages.as_slice());
        assert_eq!(
            steps_after(JobKind::Guide, Some("frames")),
            ["highlight", "voice", "ready"]
        );
        assert_eq!(JobKind::parse("guide").unwrap(), JobKind::Guide);
        assert!(JobKind::parse("guide_pdf").is_err());
    }

    #[test]
    fn read_jobs_make_pages_read_speak_then_finish() {
        assert_eq!(
            steps_after(JobKind::Read, None),
            ["pages", "read", "voice", "ready"]
        );
        assert_eq!(steps_after(JobKind::Read, Some("read")), ["voice", "ready"]);
        assert_eq!(JobKind::parse("read").unwrap(), JobKind::Read);
        assert_eq!(JobKind::Read.as_str(), "read");
    }

    #[test]
    fn listen_jobs_hear_understand_check_speak_then_finish() {
        assert_eq!(
            steps_after(JobKind::Listen, None),
            [
                "audio",
                "transcribe",
                "understand",
                "check",
                "cover",
                "voice",
                "ready"
            ]
        );
        assert_eq!(
            steps_after(JobKind::Listen, Some("transcribe")),
            ["understand", "check", "cover", "voice", "ready"],
            "a language change resumes after the transcript"
        );
        assert_eq!(JobKind::parse("listen").unwrap(), JobKind::Listen);
        assert_eq!(JobKind::Listen.as_str(), "listen");
        assert_eq!(JobKind::parse("memory").unwrap(), JobKind::Memory);
        assert_eq!(
            steps_after(JobKind::Memory, Some("write")),
            &["check", "cover", "ready"]
        );
    }

    #[test]
    fn photo_jobs_fit_describe_embed_index_then_finish() {
        assert_eq!(
            steps_after(JobKind::Photo, None),
            ["fit", "describe", "embed", "index", "ready"]
        );
        assert_eq!(
            steps_after(JobKind::Photo, Some("describe")),
            ["embed", "index", "ready"]
        );
        assert_eq!(JobKind::parse("photo").unwrap(), JobKind::Photo);
    }

    #[test]
    fn kind_text_round_trips() {
        for k in [JobKind::Ingest, JobKind::Render, JobKind::Agent] {
            assert_eq!(JobKind::parse(k.as_str()).unwrap(), k);
        }
    }
}
