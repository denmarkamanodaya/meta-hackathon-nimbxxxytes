//! Shorts over fakes: creating, planning with clamps in the log, previews, manual edits.

#![cfg(test)]

use std::sync::Arc;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::short::{ShortStatus, StepKind};
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::ports::ShortStore;
use nimbytes_core::usecases::jobs::{ByKind, JobDeps, run_next_job};
use nimbytes_core::usecases::shorts::{NewShort, create_short, save_timeline, short_detail};
use nimbytes_testkit::shorts_world::{ShortsWorld, seg, timeline, user};
use nimbytes_testkit::{RecordedProgress, ScriptedSteps};

#[tokio::test]
async fn creating_a_short_stores_it_planning_and_queues_its_agent_job() {
    let w = ShortsWorld::new();

    let id = w.create().await.unwrap();

    let short = w.shorts.short(&id).unwrap();
    assert_eq!(short.status, ShortStatus::Planning);
    assert_eq!(
        (short.prompt.as_str(), short.target_s),
        ("calm morning", 6.0)
    );
    assert_eq!(short.created_at, "2026-10-27T03:00:00.000Z");
    let job = w.job(JobKind::Agent).unwrap();
    assert_eq!(job.subject_id, id.as_str());
}

#[tokio::test]
async fn bad_requests_and_other_users_moments_are_refused_before_anything_is_stored() {
    let w = ShortsWorld::new();
    let ask = |ids: Vec<&str>, target_s: f64, prompt: &str| NewShort {
        prompt: prompt.into(),
        segment_ids: ids.into_iter().map(seg).collect(),
        aspect: Aspect::Square,
        target_s,
    };
    let long = "x".repeat(501);
    let cases = [
        (ask(vec![], 10.0, ""), ErrorCode::ValidationFailed),
        (ask(vec!["s0", "s0"], 10.0, ""), ErrorCode::ValidationFailed),
        (ask(vec!["s0"], 2.0, ""), ErrorCode::ValidationFailed),
        (ask(vec!["s0"], 10.0, &long), ErrorCode::ValidationFailed),
        (ask(vec!["s0", "ghost"], 10.0, ""), ErrorCode::NotFound),
        (ask(vec!["s0", "x0"], 10.0, ""), ErrorCode::Forbidden),
    ];
    for (new, code) in cases {
        let err = create_short(&w.deps(), &user("u1"), new).await.unwrap_err();
        assert_eq!(err.code, code, "{}", err.message);
    }
    assert!(w.jobs.all().is_empty());
}

#[tokio::test]
async fn the_plan_step_fits_the_model_timeline_and_logs_every_clamp() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    let mut planned = timeline(&[("s1", 9.0, 13.0), ("s0", 2.0, 4.0)]);
    (planned.aspect, planned.target_seconds) = (Aspect::Square, 40.0);
    w.reasoner.plans(planned);

    w.run(JobKind::Agent, "edit").await.unwrap();

    let asked = &w.reasoner.plan_requests()[0];
    assert_eq!(asked.prompt, "calm morning");
    assert_eq!(asked.segments, [seg("s1"), seg("s0")], "pick order");
    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    let v1 = &detail.versions[0].version.timeline;
    assert_eq!(
        (v1.aspect, v1.target_seconds),
        (Aspect::Portrait, 6.0),
        "the short's own"
    );
    assert_eq!((v1.clips[0].in_s, v1.clips[0].out_s), (10.0, 13.0));
    assert_eq!(detail.short.best_version, Some(1));
    assert_eq!(
        w.shorts.summaries(&id)[..2],
        [
            "Open on the pour.",
            "Shot 1: in 9.00 → 10.00 s (segment 10.00–18.00 s)"
        ]
    );
    assert_eq!(detail.steps[1].step.tool.as_deref(), Some("fit_timeline"));
}

#[tokio::test]
async fn a_failed_plan_is_retried_by_the_queue_and_a_rerun_never_adds_a_second_version() {
    let w = ShortsWorld::new();
    w.create().await.unwrap();
    let err = w.run(JobKind::Agent, "edit").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelUnavailable);

    w.reasoner.plans(timeline(&[("s0", 1.0, 6.0)]));
    w.run(JobKind::Agent, "edit").await.unwrap();
    w.run(JobKind::Agent, "edit").await.unwrap();

    assert_eq!(
        w.reasoner.plan_requests().len(),
        2,
        "the rerun did not ask again"
    );
}

#[tokio::test]
async fn detail_gives_each_version_player_props_with_proxy_urls_and_phrase_captions() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    w.reasoner
        .plans(timeline(&[("s0", 1.0, 4.0), ("s1", 11.0, 14.0)]));
    w.run(JobKind::Agent, "edit").await.unwrap();

    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();

    let props = &detail.versions[0].props;
    assert_eq!(props.clips.len(), 2);
    let src = props.clips[1].src_url.as_deref().unwrap();
    assert_eq!(src, "https://signed/users/u1/proxies/c2_720p.mp4?ttl=3600");
    let words: Vec<f64> = props.clips[0].captions[0]
        .words
        .iter()
        .map(|w| w.at_s)
        .collect();
    assert_eq!(words.first(), Some(&1.0), "source seconds of the turn");
    assert!(props.clips[1].captions.is_empty());
    let thumbs: Vec<&str> = detail
        .segments
        .iter()
        .map(|c| c.thumb_url.as_str())
        .collect();
    assert_eq!(
        thumbs[0],
        "https://signed/users/u1/thumbs/c2/s1.jpg?ttl=3600"
    );
    assert_eq!(detail.render_url, None);
}

#[tokio::test]
async fn a_manual_edit_becomes_the_next_version_with_its_fixes_logged() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    w.reasoner.plans(timeline(&[("s0", 1.0, 6.0)]));
    w.run(JobKind::Agent, "edit").await.unwrap();

    let n = save_timeline(&w.deps(), &user("u1"), &id, timeline(&[("s1", 10.0, 19.0)]))
        .await
        .unwrap();

    assert_eq!(n, 2);
    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    let v2 = &detail.versions[1].version.timeline;
    assert_eq!(
        (v2.clips[0].in_s, v2.clips[0].out_s),
        (10.0, 17.2),
        "end clamp, then fit to 6 s + 20 %"
    );
    let edits: Vec<(StepKind, Option<u32>)> = detail.steps[detail.steps.len() - 3..]
        .iter()
        .map(|s| (s.step.kind, s.step.version))
        .collect();
    assert_eq!(
        edits,
        [
            (StepKind::Revise, Some(2)),
            (StepKind::ToolResult, Some(2)),
            (StepKind::ToolResult, Some(2))
        ]
    );
    let other = save_timeline(&w.deps(), &user("u2"), &id, timeline(&[("s1", 10.0, 12.0)])).await;
    assert_eq!(other.unwrap_err().code, ErrorCode::Forbidden);
    let foreign = save_timeline(&w.deps(), &user("u1"), &id, timeline(&[("x0", 0.0, 3.0)])).await;
    assert_eq!(foreign.unwrap_err().code, ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn the_worker_routes_an_agent_job_through_plan_then_preview() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    w.reasoner.plans(timeline(&[("s0", 1.0, 6.0)]));
    let ingest = Arc::new(ScriptedSteps::default());
    let runner = ByKind {
        ingest: ingest.clone(),
        shorts: Arc::new(w.steps()),
        faces: ingest.clone(),
    };
    let progress = RecordedProgress::default();
    let deps = JobDeps {
        queue: &w.jobs,
        runner: &runner,
        clock: w.clock.as_ref(),
        progress: &progress,
    };

    assert!(run_next_job(&deps).await.unwrap());

    assert!(ingest.ran().is_empty());
    assert_eq!(w.jobs.all()[0].status, "done");
    assert_eq!(w.renderer.calls().len(), 1);
    assert_eq!(w.shorts.short(&id).unwrap().status, ShortStatus::Ready);
}

#[tokio::test]
async fn a_shot_whose_moment_is_gone_shows_as_a_placeholder_instead_of_failing() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    let gone = timeline(&[("s0", 1.0, 4.0), ("s2", 21.0, 24.0)]);
    w.shorts.add_version(&id, 1, &gone).await.unwrap();

    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();

    let clips = &detail.versions[0].props.clips;
    assert!(clips[0].src_url.is_some());
    assert_eq!(
        (clips[1].src_url.as_deref(), clips[1].captions.len()),
        (None, 0)
    );
}
