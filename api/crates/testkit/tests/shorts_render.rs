//! Final renders over fakes: one job per version, originals in, the render key out, downloads.

#![cfg(test)]

use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::render::Quality;
use nimbytes_core::domain::short::ShortStatus;
use nimbytes_core::keys;
use nimbytes_core::ports::{JobQueue, ShortStore, StepRunner};
use nimbytes_core::usecases::shorts::{download_url, request_render, save_timeline};
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::shorts_world::{ShortsWorld, timeline, user};

/// A short with version 1 planned.
async fn planned() -> (ShortsWorld, ShortId) {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    w.reasoner
        .plans(timeline(&[("s0", 1.0, 4.0), ("s1", 11.0, 14.0)]));
    w.run(JobKind::Agent, "edit").await.unwrap();
    (w, id)
}

#[tokio::test]
async fn a_render_request_queues_one_job_per_version_and_repeats_return_it() {
    let (w, id) = planned().await;

    let job = request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();
    let again = request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();

    assert_eq!(job, again);
    assert_eq!(render_jobs(&w), [(format!("{id}:v1"), "queued")]);
    let missing = request_render(&w.deps(), &user("u1"), &id, 2).await;
    assert_eq!(missing.unwrap_err().code, ErrorCode::NotFound);
    let other = request_render(&w.deps(), &user("u2"), &id, 1).await;
    assert_eq!(other.unwrap_err().code, ErrorCode::Forbidden);
}

#[tokio::test]
async fn the_final_render_reads_originals_writes_the_render_key_and_records_the_version() {
    let (w, id) = planned().await;
    request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();

    w.run(JobKind::Render, "render").await.unwrap();

    let calls = w.renderer.calls();
    let call = calls.last().unwrap();
    assert_eq!(call.quality, Quality::Final);
    let src = call.props.clips[0].src_url.as_deref().unwrap();
    assert_eq!(src, "https://signed/users/u1/originals/c1.mov?ttl=7200");
    let key = format!("users/u1/renders/{id}.mp4");
    assert_eq!(call.out_url, format!("https://put/{key}?ttl=7200"));
    let short = w.shorts.short(&id).unwrap();
    assert_eq!(short.status, ShortStatus::Ready);
    let (stored, n) = short.render.unwrap();
    assert_eq!((stored.as_str(), n), (key.as_str(), 1));
    let log = w.shorts.summaries(&id);
    assert_eq!(log.last().unwrap(), "Final video ready: 12.5 s, 2.0 MB");
    let url = download_url(&w.deps(), &user("u1"), &id).await.unwrap();
    assert_eq!(
        url,
        format!("https://signed/{key}?ttl=3600&download=nimbytes-short-v1.mp4")
    );
}

#[tokio::test]
async fn rendering_another_version_requeues_the_finished_job_and_hides_the_old_render() {
    let (w, id) = planned().await;
    request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();
    w.run(JobKind::Render, "render").await.unwrap();
    w.jobs
        .done(&w.job_for(&format!("{id}:v1")), 0)
        .await
        .unwrap();
    let edit = timeline(&[("s1", 10.0, 15.0)]);
    let n = save_timeline(&w.deps(), &user("u1"), &id, edit)
        .await
        .unwrap();

    request_render(&w.deps(), &user("u1"), &id, n)
        .await
        .unwrap();

    let download = download_url(&w.deps(), &user("u1"), &id).await;
    assert_eq!(
        download.unwrap_err().code,
        ErrorCode::NotFound,
        "no stale render"
    );
    let (v1, v2) = (format!("{id}:v1"), format!("{id}:v2"));
    assert_eq!(
        render_jobs(&w),
        [(v1.clone(), "done"), (v2.clone(), "queued")]
    );

    w.jobs.done(&w.job_for(&v2), 0).await.unwrap();
    w.shorts
        .set_render(&id, Some((&keys::render(&user("u1"), &id), n)))
        .await
        .unwrap();
    request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();

    assert_eq!(
        render_jobs(&w),
        [(v1, "queued"), (v2, "done")],
        "v1 must render again"
    );
}

/// `(subject, status)` of every render job.
fn render_jobs(w: &ShortsWorld) -> Vec<(String, &'static str)> {
    w.jobs
        .all()
        .into_iter()
        .filter(|j| j.job.kind == JobKind::Render)
        .map(|j| (j.job.subject_id, j.status))
        .collect()
}

#[tokio::test]
async fn a_render_that_gives_up_leaves_the_short_ready_and_says_why() {
    let (w, id) = planned().await;
    request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();
    let job = w.job(JobKind::Render).unwrap();
    let error = AppError::new(ErrorCode::RenderFailed, "renderer is down");

    w.steps().failed(&job, &error).await.unwrap();

    assert_eq!(w.shorts.short(&id).unwrap().status, ShortStatus::Ready);
    let log = w.shorts.summaries(&id);
    assert_eq!(log.last().unwrap(), "Final render failed: renderer is down");
}

#[tokio::test]
async fn an_agent_run_that_gives_up_marks_the_short_failed() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    let job = w.job(JobKind::Agent).unwrap();
    let error = AppError::new(ErrorCode::ModelUnavailable, "planner timed out");

    w.steps().failed(&job, &error).await.unwrap();

    assert_eq!(w.shorts.short(&id).unwrap().status, ShortStatus::Failed);
    let log = w.shorts.summaries(&id);
    assert_eq!(log, ["Could not make the short: planner timed out"]);
}
