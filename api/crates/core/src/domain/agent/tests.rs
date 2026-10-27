use super::*;
use crate::domain::critique::{Critique, Scores};
use crate::domain::timeline::{Aspect, CaptionPlan, CaptionSource, CaptionStyle, Post, Timeline};
use crate::keys::ObjectKey;

const BUDGET: AgentBudget = AgentBudget::PRODUCTION;

fn timeline() -> Timeline {
    Timeline {
        aspect: Aspect::Portrait,
        target_seconds: 6.0,
        clips: vec![],
        captions: CaptionPlan {
            style: CaptionStyle::None,
            source: CaptionSource::Transcript,
        },
        post: Post {
            caption: String::new(),
            hashtags: vec![],
        },
        rationale: String::new(),
        revision: None,
    }
}

/// Version `n`, rendered or not, critiqued with `total` and `verdict` or not.
fn v(n: u32, rendered: bool, critique: Option<(u8, Verdict)>) -> Version {
    Version {
        n,
        timeline: timeline(),
        preview_key: rendered.then(|| ObjectKey::from_stored(format!("p{n}"))),
        critique: critique.map(|(hook, verdict)| {
            let scores = Scores {
                hook,
                pacing: 5,
                continuity: 5,
                captions: 5,
                length: 5,
            };
            Critique {
                version: n,
                scores,
                total: scores.total(),
                notes: vec![],
                verdict,
            }
        }),
    }
}

#[test]
fn the_run_plans_renders_critiques_and_revises_in_that_order() {
    assert_eq!(BUDGET.next(&[]), Next::Plan);
    assert_eq!(BUDGET.next(&[v(1, false, None)]), Next::Render(1));
    assert_eq!(BUDGET.next(&[v(1, true, None)]), Next::Critique(1));
    let revise = Some((5, Verdict::Revise));
    assert_eq!(BUDGET.next(&[v(1, true, revise)]), Next::Revise(1));
    assert_eq!(
        BUDGET.next(&[v(1, true, revise), v(2, true, revise)]),
        Next::Revise(2)
    );
}

#[test]
fn it_stops_on_accept_or_after_two_revisions() {
    let revise = Some((5, Verdict::Revise));
    let accept = Some((9, Verdict::Accept));
    assert_eq!(
        BUDGET.next(&[v(1, true, revise), v(2, true, accept)]),
        Next::Finish(Stop::Accepted)
    );
    let three = [v(1, true, revise), v(2, true, revise), v(3, true, revise)];
    assert_eq!(BUDGET.next(&three), Next::Finish(Stop::RevisionLimit));
}

#[test]
fn each_budget_stops_the_run_when_used_up() {
    let fresh = Spent {
        tool_calls: 3,
        wall_ms: 40_000,
        cost_usd: 0.05,
    };
    assert_eq!(BUDGET.exceeded(fresh), None);
    let slow_box = Spent {
        wall_ms: 239_999,
        ..fresh
    };
    assert_eq!(BUDGET.exceeded(slow_box), None, "4 minutes are allowed");
    let calls = Spent {
        tool_calls: 12,
        ..fresh
    };
    let time = Spent {
        wall_ms: 240_000,
        ..fresh
    };
    let cost = Spent {
        cost_usd: 0.25,
        ..fresh
    };
    assert_eq!(BUDGET.exceeded(calls), Some(Stop::ToolCalls));
    assert_eq!(BUDGET.exceeded(time), Some(Stop::Time));
    assert_eq!(BUDGET.exceeded(cost), Some(Stop::Cost));
}

#[test]
fn the_best_version_has_the_highest_total_later_on_a_tie() {
    let revise = |hook| Some((hook, Verdict::Revise));
    let trail = [
        v(1, true, revise(6)),
        v(2, true, revise(9)),
        v(3, true, revise(7)),
    ];
    assert_eq!(best_version(&trail), Some(2));
    let tie = [v(1, true, revise(8)), v(2, true, revise(8))];
    assert_eq!(best_version(&tie), Some(2));
}

#[test]
fn without_critiques_the_newest_rendered_version_is_best() {
    assert_eq!(best_version(&[]), None);
    assert_eq!(
        best_version(&[v(1, true, None), v(2, false, None)]),
        Some(1)
    );
    assert_eq!(best_version(&[v(1, false, None)]), Some(1));
}

#[test]
fn the_production_budget_makes_at_most_three_drafts() {
    assert_eq!(
        AgentBudget::PRODUCTION.max_drafts(),
        3,
        "a first cut plus two revisions"
    );
}
