//! The editing agent over fakes: plan → preview → critique → revise, budgets, guardrails and the
//! step log.

#![cfg(test)]

use nimbytes_core::domain::agent::AgentBudget;
use nimbytes_core::domain::cost::ModelCall;
use nimbytes_core::domain::critique::Verdict;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::render::Quality;
use nimbytes_core::domain::short::{ShortStatus, StepKind};
use nimbytes_core::domain::timeline::Timeline;
use nimbytes_core::keys::ObjectClass;
use nimbytes_core::ports::{ModelLedger, StepRunner};
use nimbytes_core::usecases::shorts::short_detail;
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::shorts_world::{BUDGET, ShortsWorld, critique, revised, timeline, user};

/// Runs the agent job of a fresh short with `budget`; returns its id and step summaries.
async fn run(w: &ShortsWorld, budget: AgentBudget) -> (ShortId, Vec<String>) {
    let id = w.create().await.unwrap();
    let job = w.job(JobKind::Agent).unwrap();
    w.steps_with(budget).run(&job, "edit").await.unwrap();
    let log = w.shorts.summaries(&id);
    (id, log)
}

fn v1() -> Timeline {
    timeline(&[("s0", 1.0, 4.0), ("s1", 11.0, 14.0)])
}

fn v2() -> Timeline {
    revised(&[("s0", 1.0, 3.5), ("s1", 11.0, 14.0)], 1)
}

/// The log of a run that is revised once and then accepted.
const HAPPY_LOG: [&str; 11] = [
    "Open on the pour.",
    "Rendering a preview of version 1",
    "Preview ready: 12.5 s, 2.0 MB",
    "Watching the preview of version 1",
    "Version 1: 24/50, revise. First note at 1.0 s: issue 0",
    "Revision of version 1.",
    "Rendering a preview of version 2",
    "Preview ready: 12.5 s, 2.0 MB",
    "Watching the preview of version 2",
    "Version 2: 29/50, accept.",
    "Showing version 2 (29/50): the critic accepted it",
];

#[tokio::test]
async fn plan_preview_critique_revise_critique_accept_shows_the_best_version() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.reasoner.plans(v2());
    w.reasoner.critiques(critique(4, 2, Verdict::Revise));
    w.reasoner.critiques(critique(9, 0, Verdict::Accept));

    let (id, log) = run(&w, BUDGET).await;

    assert_eq!(log, HAPPY_LOG);
    assert_eq!(w.reasoner.critiqued(), [1, 2]);
    let asked = w.reasoner.plan_requests();
    let previous: Vec<Option<&str>> = asked.iter().map(|p| p.previous.as_deref()).collect();
    assert_eq!(previous, [None, Some("v1")]);
    let qualities: Vec<Quality> = w.renderer.calls().iter().map(|c| c.quality).collect();
    assert_eq!(qualities, [Quality::Preview, Quality::Preview]);
    assert!(
        w.blobs
            .tags()
            .iter()
            .all(|(_, c)| *c == ObjectClass::Preview)
    );
    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    assert_eq!(
        (detail.short.status, detail.short.best_version),
        (ShortStatus::Ready, Some(2))
    );
    assert_eq!(
        detail.versions[0].version.critique.as_ref().unwrap().total,
        24
    );
    assert!(detail.versions[1].version.timeline.revision.is_some());
}

#[tokio::test]
async fn every_step_is_logged_in_order_with_its_kind_and_tool() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.reasoner.critiques(critique(9, 0, Verdict::Accept));

    let (id, _) = run(&w, BUDGET).await;

    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    let seqs: Vec<u32> = detail.steps.iter().map(|s| s.seq).collect();
    assert_eq!(seqs, [0, 1, 2, 3, 4, 5]);
    let kinds: Vec<(StepKind, Option<&str>)> = detail
        .steps
        .iter()
        .map(|s| (s.step.kind, s.step.tool.as_deref()))
        .collect();
    assert_eq!(
        kinds,
        [
            (StepKind::Plan, None),
            (StepKind::ToolCall, Some("render_preview")),
            (StepKind::ToolResult, Some("render_preview")),
            (StepKind::ToolCall, Some("critique_preview")),
            (StepKind::Critique, None),
            (StepKind::Final, None),
        ]
    );
}

#[tokio::test]
async fn after_two_revisions_the_run_stops_and_shows_the_highest_score() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.reasoner.plans(v2());
    w.reasoner
        .plans(revised(&[("s0", 2.0, 4.0), ("s1", 11.0, 14.0)], 2));
    w.reasoner.critiques(critique(5, 1, Verdict::Revise));
    w.reasoner.critiques(critique(8, 1, Verdict::Revise));
    w.reasoner.critiques(critique(6, 1, Verdict::Revise));

    let (_, log) = run(&w, BUDGET).await;

    assert_eq!(w.reasoner.critiqued(), [1, 2, 3]);
    assert_eq!(
        log.last().unwrap(),
        "Showing version 2 (28/50): two revisions were made"
    );
}

#[tokio::test]
async fn each_budget_stops_the_run_with_the_best_version_so_far() {
    let calls = AgentBudget {
        max_tool_calls: 3,
        ..BUDGET
    };
    let time = AgentBudget {
        max_wall_ms: 0,
        ..BUDGET
    };
    for (budget, why) in [
        (calls, "the tool-call budget ran out"),
        (time, "the time budget ran out"),
    ] {
        let w = ShortsWorld::new();
        w.reasoner.plans(v1());
        w.reasoner.critiques(critique(5, 1, Verdict::Revise));

        let (_, log) = run(&w, budget).await;

        assert!(log.last().unwrap().ends_with(why), "{log:?}");
        assert!(
            log.last().unwrap().starts_with("Showing version 1"),
            "{log:?}"
        );
    }
}

#[tokio::test]
async fn the_cost_budget_counts_model_spend_since_the_run_started() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.reasoner.critiques(critique(5, 1, Verdict::Revise));
    let pricey = ModelCall {
        id: "c1".into(),
        at: "2026-10-27T03:00:00.000Z".into(),
        model: "muse-spark-1.3".into(),
        purpose: "plan_edit".into(),
        input_hash: "h".into(),
        usage: None,
        cost_usd: 0.26,
        latency_ms: 1,
        cache_hit: false,
        error: None,
    };
    w.ledger.record(&pricey).await.unwrap();

    let (_, log) = run(&w, BUDGET).await;

    assert_eq!(
        log,
        [
            "Open on the pour.",
            "Showing version 1: the cost budget ran out"
        ]
    );
}

#[tokio::test]
async fn a_plan_with_a_moment_outside_the_short_is_refused_and_asked_again_once() {
    let w = ShortsWorld::new();
    w.reasoner.plans(timeline(&[("x0", 0.0, 3.0)]));
    w.reasoner.plans(v1());
    w.reasoner.critiques(critique(9, 0, Verdict::Accept));

    let (_, log) = run(&w, BUDGET).await;

    assert_eq!(
        log[0],
        "Refused version 1: segment x0 is not part of this short"
    );
    assert_eq!(log[1], "Open on the pour.");
    let retry = &w.reasoner.plan_requests()[1];
    assert_eq!(
        retry.rejection.as_deref(),
        Some("segment x0 is not part of this short")
    );
}

#[tokio::test]
async fn a_revision_that_cites_no_note_is_refused_twice_and_version_1_is_shown() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.reasoner.plans(timeline(&[("s0", 1.0, 3.0)]));
    w.reasoner.critiques(critique(5, 1, Verdict::Revise));

    let (id, log) = run(&w, BUDGET).await;

    let refusals = log
        .iter()
        .filter(|l| l.starts_with("Refused version 2: "))
        .count();
    assert_eq!(refusals, 2, "{log:?}");
    assert_eq!(
        log.last().unwrap(),
        "Showing version 1 (25/50): the revision did not answer the critique"
    );
    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    assert_eq!(detail.versions.len(), 1);
}

#[tokio::test]
async fn with_revisions_failing_the_owner_still_gets_version_1() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.reasoner
        .plan_fails(AppError::new(ErrorCode::ModelUnavailable, "planner down"));
    w.reasoner.critiques(critique(5, 1, Verdict::Revise));

    let (id, log) = run(&w, BUDGET).await;

    assert!(
        log.contains(&"Revision failed: planner down".to_owned()),
        "{log:?}"
    );
    let short = w.shorts.short(&id).unwrap();
    assert_eq!(
        (short.status, short.best_version),
        (ShortStatus::Ready, Some(1))
    );
}

#[tokio::test]
async fn a_failed_preview_ends_the_run_with_version_1() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.renderer.fail();

    let (id, log) = run(&w, BUDGET).await;

    assert_eq!(log[2], "Preview failed: renderer is down");
    assert_eq!(log[3], "Showing version 1: a preview could not be rendered");
    assert!(w.reasoner.critiqued().is_empty());
    assert_eq!(w.shorts.short(&id).unwrap().status, ShortStatus::Ready);
}

#[tokio::test]
async fn a_rerun_after_a_crash_continues_from_the_stored_versions() {
    let w = ShortsWorld::new();
    w.reasoner.plans(v1());
    w.reasoner.critiques(critique(9, 0, Verdict::Accept));
    let (id, _) = run(&w, BUDGET).await;
    let job = w.job(JobKind::Agent).unwrap();

    w.steps().run(&job, "edit").await.unwrap();

    assert_eq!(w.reasoner.plan_requests().len(), 1, "no second plan");
    assert_eq!(w.renderer.calls().len(), 1, "no second render");
    let log = w.shorts.summaries(&id);
    assert_eq!(
        log.last().unwrap(),
        "Showing version 1 (29/50): the critic accepted it"
    );
}
