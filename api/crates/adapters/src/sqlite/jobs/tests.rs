use std::collections::HashSet;
use std::time::Duration;

use nimbytes_core::ErrorCode;
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};
use nimbytes_testkit::{FixedClock, RecordedProgress, ScriptedSteps};

use super::*;
use crate::sqlite::{connect, test_pool};

async fn enqueue(queue: &SqliteJobQueue, n: u32, now: EpochMillis) {
    let id = JobId::parse(format!("j{n:03}")).unwrap();
    let subject = format!("clip-{n}");
    let job = NewJob {
        id: &id,
        kind: JobKind::Ingest,
        subject_id: &subject,
    };
    queue.enqueue(job, now).await.unwrap();
}

async fn status_of(pool: &SqlitePool, id: &str) -> (String, String, i64, Option<String>) {
    sqlx::query_as("SELECT status, run_after, attempts, last_error FROM jobs WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn concurrent_claims_never_return_the_same_job() {
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}", dir.path().join("jobs.db").display());
    let pool = connect(&url, Duration::from_secs(5)).await.unwrap();
    let queue = SqliteJobQueue::new(pool);
    for n in 0..40 {
        enqueue(&queue, n, 0).await;
    }

    let mut workers = Vec::new();
    for _ in 0..8 {
        let queue = queue.clone();
        workers.push(tokio::spawn(async move {
            let mut got = Vec::new();
            while let Some(job) = queue.claim(1).await.unwrap() {
                got.push(job.id.to_string());
            }
            got
        }));
    }
    let mut all = Vec::new();
    for w in workers {
        all.extend(w.await.unwrap());
    }

    let unique: HashSet<_> = all.iter().collect();
    assert_eq!(all.len(), 40);
    assert_eq!(unique.len(), 40);
}

#[tokio::test]
async fn enqueue_is_idempotent_per_subject() {
    let pool = test_pool().await;
    let queue = SqliteJobQueue::new(pool.clone());
    enqueue(&queue, 1, 0).await;
    let again = JobId::parse("other").unwrap();
    let dup = NewJob {
        id: &again,
        kind: JobKind::Ingest,
        subject_id: "clip-1",
    };
    queue.enqueue(dup, 0).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn failures_back_off_then_the_third_marks_the_job_failed() {
    let pool = test_pool().await;
    let queue = SqliteJobQueue::new(pool.clone());
    enqueue(&queue, 1, 0).await;
    let steps = ScriptedSteps::default();
    steps.fail_on("probe", AppError::new(ErrorCode::MediaFailed, "bad file"));
    let clock = FixedClock::at(0);
    let progress = RecordedProgress::default();
    let deps = JobDeps {
        queue: &queue,
        runner: &steps,
        clock: &clock,
        progress: &progress,
    };

    run_next_job(&deps).await.unwrap();
    let (status, run_after, attempts, error) = status_of(&pool, "j001").await;
    assert_eq!((status.as_str(), attempts), ("queued", 1));
    assert_eq!(run_after, "1970-01-01T00:00:05.000Z");
    assert_eq!(error.as_deref(), Some("MediaFailed: bad file"));
    assert!(
        !run_next_job(&deps).await.unwrap(),
        "backoff keeps it unclaimable"
    );

    clock.advance(5_000);
    run_next_job(&deps).await.unwrap();
    assert_eq!(status_of(&pool, "j001").await.1, "1970-01-01T00:00:15.000Z");
    clock.advance(10_000);
    run_next_job(&deps).await.unwrap();

    let (status, _, attempts, _) = status_of(&pool, "j001").await;
    assert_eq!((status.as_str(), attempts), ("failed", 3));
}

#[tokio::test]
async fn advance_records_the_step_and_crashed_jobs_are_requeued() {
    let pool = test_pool().await;
    let queue = SqliteJobQueue::new(pool.clone());
    enqueue(&queue, 1, 0).await;
    let job = queue.claim(0).await.unwrap().unwrap();
    queue.advance(&job.id, "proxy", 1).await.unwrap();

    assert_eq!(queue.requeue_running(2).await.unwrap(), 1);

    let again = queue.claim(3).await.unwrap().unwrap();
    assert_eq!(again.step.as_deref(), Some("proxy"));
    assert_eq!(again.attempts, 2);
}

#[tokio::test]
async fn find_reports_step_and_status_of_a_subjects_job() {
    use nimbytes_core::domain::job::{JobState, JobStatus};
    let queue = SqliteJobQueue::new(test_pool().await);
    assert_eq!(queue.find(JobKind::Ingest, "clip-1").await.unwrap(), None);
    enqueue(&queue, 1, 0).await;
    let job = queue.claim(0).await.unwrap().unwrap();
    queue.advance(&job.id, "proxy", 1).await.unwrap();

    let state = queue.find(JobKind::Ingest, "clip-1").await.unwrap();

    assert_eq!(
        state,
        Some(JobState {
            step: Some("proxy".into()),
            status: JobStatus::Running
        })
    );
}
