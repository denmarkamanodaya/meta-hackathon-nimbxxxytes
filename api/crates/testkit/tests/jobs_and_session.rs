//! Worker and sign-in use cases against in-memory fakes.

#![cfg(test)]

use nimbytes_core::domain::ids::JobId;
use nimbytes_core::domain::job::{INGEST_STEPS, JobKind};
use nimbytes_core::ports::{JobQueue, NewJob};
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};
use nimbytes_core::usecases::session::{SessionDeps, log_in};
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::{
    FixedClock, InMemoryCatalogue, InMemoryJobQueue, ScriptedSteps, SequentialIds,
};

async fn queue_one(queue: &InMemoryJobQueue, now: i64) {
    let id = JobId::parse("j1").unwrap();
    let job = NewJob {
        id: &id,
        kind: JobKind::Ingest,
        subject_id: "clip-1",
    };
    queue.enqueue(job, now).await.unwrap();
}

#[tokio::test]
async fn a_job_runs_every_ingest_step_then_is_done() {
    let (queue, steps, clock) = (
        InMemoryJobQueue::default(),
        ScriptedSteps::default(),
        FixedClock::at(0),
    );
    queue_one(&queue, 0).await;
    let deps = JobDeps {
        queue: &queue,
        runner: &steps,
        clock: &clock,
    };

    assert!(run_next_job(&deps).await.unwrap());

    assert_eq!(steps.ran(), INGEST_STEPS);
    let job = &queue.all()[0];
    assert_eq!(job.status, "done");
    assert_eq!(job.job.step.as_deref(), Some("ready"));
    assert!(!run_next_job(&deps).await.unwrap(), "nothing left to claim");
}

#[tokio::test]
async fn a_failed_step_backs_off_resumes_after_the_last_good_step_and_fails_on_attempt_3() {
    let (queue, steps, clock) = (
        InMemoryJobQueue::default(),
        ScriptedSteps::default(),
        FixedClock::at(0),
    );
    queue_one(&queue, 0).await;
    steps.fail_on(
        "transcribe",
        AppError::new(ErrorCode::ModelUnavailable, "503"),
    );
    let deps = JobDeps {
        queue: &queue,
        runner: &steps,
        clock: &clock,
    };

    run_next_job(&deps).await.unwrap();
    let after_first = queue.all()[0].clone();
    assert_eq!(after_first.status, "queued");
    assert_eq!(after_first.run_after, 5_000);
    assert_eq!(after_first.job.step.as_deref(), Some("segments"));
    assert!(
        !run_next_job(&deps).await.unwrap(),
        "not runnable before run_after"
    );

    clock.advance(5_000);
    run_next_job(&deps).await.unwrap();
    assert_eq!(queue.all()[0].run_after, 15_000);
    clock.advance(10_000);
    run_next_job(&deps).await.unwrap();

    let last = &queue.all()[0];
    assert_eq!(last.status, "failed");
    assert_eq!(last.job.attempts, 3);
    assert_eq!(last.last_error.as_deref(), Some("ModelUnavailable: 503"));
    assert_eq!(
        steps.ran().iter().filter(|s| *s == "probe").count(),
        1,
        "probe never reran"
    );
}

#[tokio::test]
async fn right_passcode_returns_the_same_demo_user_every_time() {
    let (catalogue, ids, clock) = (
        InMemoryCatalogue::default(),
        SequentialIds::new("u"),
        FixedClock::at(0),
    );
    let deps = SessionDeps {
        catalogue: &catalogue,
        ids: &ids,
        clock: &clock,
        passcode: "pw",
    };

    let first = log_in(&deps, "pw").await.unwrap();
    let second = log_in(&deps, "pw").await.unwrap();

    assert_eq!(first.as_str(), "u-1");
    assert_eq!(second, first);
}

#[tokio::test]
async fn wrong_passcode_is_unauthorized() {
    let (catalogue, ids, clock) = (
        InMemoryCatalogue::default(),
        SequentialIds::new("u"),
        FixedClock::at(0),
    );
    let deps = SessionDeps {
        catalogue: &catalogue,
        ids: &ids,
        clock: &clock,
        passcode: "pw",
    };

    assert_eq!(
        log_in(&deps, "nope").await.unwrap_err().code,
        ErrorCode::Unauthorized
    );
    assert_eq!(
        log_in(&deps, "").await.unwrap_err().code,
        ErrorCode::Unauthorized
    );
}
