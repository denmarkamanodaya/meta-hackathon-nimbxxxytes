use super::*;
use crate::domain::ids::ClipId;

fn draft(act: Act, duration_s: f64) -> ShotDraft {
    ShotDraft {
        act,
        title: format!("{} shot", act.as_str()),
        direction: "Wide, eye level".into(),
        tips: vec!["Hold still".into()],
        query: "coffee pour".into(),
        duration_s,
    }
}

fn list(acts: &[Act]) -> ShotList {
    ShotList {
        title: "Morning run".into(),
        shots: acts.iter().map(|a| draft(*a, 5.0)).collect(),
    }
}

fn candidate(id: &str) -> Candidate {
    Candidate {
        segment_id: SegmentId::parse(id).unwrap(),
        clip_id: ClipId::parse("c1").unwrap(),
        clip_filename: "a.mp4".into(),
        clip_title: "A".into(),
        start_s: 0.0,
        end_s: 5.0,
        recorded_at: None,
        description: "x".into(),
        place: String::new(),
        people: vec![],
        speakers: vec![],
        speech: String::new(),
        quality: None,
        faces: vec![],
    }
}

fn shot(id: &str, ord: u32) -> Shot {
    Shot {
        id: ShotId::parse(id).unwrap(),
        ord,
        act: Act::Story,
        title: "t".into(),
        direction: "d".into(),
        tips: vec![],
        query: "q".into(),
        duration_s: 5.0,
        board_key: None,
        matched_segment_id: None,
        match_reason: None,
        take_count: 0,
    }
}

fn answer(shot: u32, segment: Option<&str>, takes: u32) -> CoverageAnswer {
    CoverageAnswer {
        shot,
        segment_id: segment.map(str::to_owned),
        reason: "  matches   well ".into(),
        take_count: takes,
    }
}

#[test]
fn text_enums_round_trip_and_reject_unknown_text() {
    for a in Act::ALL {
        assert_eq!(Act::parse(a.as_str()).unwrap(), *a);
    }
    for s in ProductionStatus::ALL {
        assert_eq!(ProductionStatus::parse(s.as_str()).unwrap(), *s);
    }
    assert_eq!(Format::parse("story").unwrap(), Format::Story);
    assert_eq!(
        Format::parse("reel").unwrap_err().code,
        ErrorCode::ValidationFailed
    );
    assert_eq!(
        serde_json::to_string(&ProductionStatus::Shooting).unwrap(),
        "\"shooting\""
    );
    assert_eq!(Platform::Tiktok.as_str(), "tiktok");
    assert_eq!(ImageExt::Jpg.as_str(), "jpg");
}

#[test]
fn acts_order_hook_story_payoff_outro() {
    assert!(Act::Hook < Act::Story && Act::Story < Act::Payoff && Act::Payoff < Act::Outro);
}

#[test]
fn a_new_production_needs_a_brief_and_a_target_in_its_formats_range() {
    let new = |brief: &str, format, target_s| NewProduction {
        brief: brief.into(),
        format,
        aspect: Aspect::Portrait,
        target_s,
        blur_bystanders: true,
    };
    let ok = checked_new(new("  a day at the beach  ", Format::Story, 60.0)).unwrap();
    assert_eq!(ok.brief, "a day at the beach");
    assert!(checked_new(new("x", Format::Short, 10.0)).is_ok());
    assert!(checked_new(new("x", Format::Short, 30.0)).is_ok());
    for (brief, format, target) in [
        ("   ", Format::Story, 60.0),
        ("x", Format::Story, 30.0),
        ("x", Format::Story, 91.0),
        ("x", Format::Short, 45.0),
        ("x", Format::Short, f64::NAN),
    ] {
        let err = checked_new(new(brief, format, target)).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed, "{brief:?} {target}");
    }
    assert!(checked_new(new(&"x".repeat(MAX_BRIEF_CHARS + 1), Format::Story, 60.0)).is_err());
}

#[test]
fn the_draft_title_is_the_briefs_first_words_within_the_limit() {
    assert_eq!(
        draft_title("A day in my life at the  climbing gym"),
        "A day in my life at"
    );
    assert_eq!(
        draft_title(&"y".repeat(80)).chars().count(),
        MAX_TITLE_CHARS
    );
}

#[test]
fn a_shot_list_with_acts_in_order_passes_and_is_tidied() {
    let mut l = list(&[Act::Hook, Act::Story, Act::Story, Act::Payoff, Act::Outro]);
    l.shots[0].title = "  Doors   open ".into();
    l.shots[0].tips = vec![
        " a ".into(),
        String::new(),
        "b".into(),
        "c".into(),
        "d".into(),
        "e".into(),
    ];

    let checked = checked_shot_list(l, 50.0).unwrap();

    assert_eq!(checked.shots[0].title, "Doors open");
    assert_eq!(checked.shots[0].tips, ["a", "b", "c", "d"]);
    let total: f64 = checked.shots.iter().map(|s| s.duration_s).sum();
    assert!((total - 50.0).abs() < 1e-9, "{total}");
}

#[test]
fn a_shot_list_out_of_act_order_is_refused_naming_the_shot() {
    let err = checked_shot_list(list(&[Act::Hook, Act::Payoff, Act::Story]), 30.0).unwrap_err();
    assert!(
        err.contains("shot 3 (story) comes after shot 2 (payoff)"),
        "{err}"
    );
}

#[test]
fn a_shot_list_needs_3_to_12_shots_with_text() {
    assert!(checked_shot_list(list(&[Act::Hook, Act::Outro]), 20.0).is_err());
    assert!(checked_shot_list(list(&[Act::Story; 13]), 60.0).is_err());
    assert!(checked_shot_list(list(&[Act::Story; 12]), 60.0).is_ok());
    let mut empty = list(&[Act::Hook, Act::Story, Act::Outro]);
    empty.shots[1].query = "   ".into();
    assert_eq!(
        checked_shot_list(empty, 20.0).unwrap_err(),
        "shot 2 needs a title, a direction and a query"
    );
    let mut untitled = list(&[Act::Hook, Act::Story, Act::Outro]);
    untitled.title = " ".into();
    assert!(checked_shot_list(untitled, 20.0).is_err());
}

#[test]
fn durations_scale_to_the_target_and_stay_within_shot_bounds() {
    assert_eq!(fit_durations(&[2.0, 2.0, 4.0], 16.0), [4.0, 4.0, 8.0]);
    assert_eq!(fit_durations(&[0.0, -3.0, f64::NAN], 3.0), [1.0, 1.0, 1.0]);
    assert_eq!(fit_durations(&[1.0, 100.0], 60.0), [1.0, 20.0]);
    assert_eq!(fit_durations(&[3.33, 3.33], 10.0), [5.0, 5.0]);
}

#[test]
fn candidates_keep_search_order_without_repeats_and_at_most_eight() {
    let pool: Vec<Candidate> = ["a", "b", "a", "c", "d", "e", "f", "g", "h", "i"]
        .into_iter()
        .map(candidate)
        .collect();

    let picked: Vec<String> = select_candidates(pool)
        .into_iter()
        .map(|c| c.segment_id.to_string())
        .collect();

    assert_eq!(picked, ["a", "b", "c", "d", "e", "f", "g", "h"]);
}

#[test]
fn coverage_keeps_only_a_shots_own_candidates_once_each() {
    let shots = [shot("s1", 1), shot("s2", 2), shot("s3", 3), shot("s4", 4)];
    let candidates = vec![
        vec![candidate("a"), candidate("b")],
        vec![candidate("a"), candidate("c")],
        vec![candidate("d")],
        vec![],
    ];
    let answers = [
        answer(1, Some("a"), 5),
        // "a" already covers shot 1, so shot 2 is not covered by it.
        answer(2, Some("a"), 1),
        // "z" was never a candidate of shot 3.
        answer(3, Some("z"), 1),
        answer(9, Some("d"), 1),
    ];

    let got = accept_coverage(&shots, &candidates, &answers);

    let ids: Vec<Option<&str>> = got
        .iter()
        .map(|m| m.segment_id.as_ref().map(SegmentId::as_str))
        .collect();
    assert_eq!(ids, [Some("a"), None, None, None]);
    assert_eq!(got[0].take_count, 2, "clamped to the candidate count");
    assert_eq!(got[1].take_count, 0);
    assert_eq!(got[0].reason.as_deref(), Some("matches well"));
    assert_eq!(got[3].reason, None, "the judge skipped shot 4");
    assert_eq!(got[3].shot_id.as_str(), "s4");
}

#[test]
fn coverage_gives_a_contested_moment_to_the_earliest_shot_whatever_the_slice_order() {
    let shots = [shot("late", 2), shot("early", 1)];
    let candidates = vec![vec![candidate("a")], vec![candidate("a")]];
    let answers = [answer(2, Some("a"), 1), answer(1, Some("a"), 0)];

    let got = accept_coverage(&shots, &candidates, &answers);

    assert_eq!(got[0].shot_id.as_str(), "late");
    assert_eq!(got[0].segment_id, None);
    assert_eq!(got[1].segment_id.as_ref().map(SegmentId::as_str), Some("a"));
    assert_eq!(got[1].take_count, 1, "a covered shot has at least one take");
}

#[test]
fn a_cut_needs_three_covered_shots_or_sixty_percent() {
    assert!(!can_cut(0, 0));
    assert!(can_cut(3, 12));
    assert!(!can_cut(2, 12));
    assert!(can_cut(2, 3));
    assert!(can_cut(3, 5));
    assert!(!can_cut(1, 2));
    assert!(can_cut(2, 2));
}

#[test]
fn coverage_runs_at_most_once_a_minute() {
    let at = |s: &str| parse_utc(s).unwrap();
    let checked = Some("2026-10-27T10:00:00.000Z");
    assert!(coverage_allowed(None, at("2026-10-27T10:00:00.000Z")));
    assert!(!coverage_allowed(checked, at("2026-10-27T10:00:59.999Z")));
    assert!(coverage_allowed(checked, at("2026-10-27T10:01:00.000Z")));
    assert!(coverage_allowed(Some("garbage"), 0));
}

#[test]
fn coverage_is_stale_when_a_clip_became_ready_after_the_check() {
    let checked = Some("2026-10-27T10:00:00.000Z");
    assert!(coverage_stale(checked, Some("2026-10-27T10:00:00.001Z")));
    assert!(!coverage_stale(checked, Some("2026-10-27T10:00:00.000Z")));
    assert!(!coverage_stale(checked, None));
    assert!(coverage_stale(None, Some("2026-10-27T09:00:00.000Z")));
    assert!(!coverage_stale(None, None));
}

#[test]
fn a_finished_plan_moves_planning_and_failed_to_shooting_only() {
    assert_eq!(
        planned_status(ProductionStatus::Planning),
        ProductionStatus::Shooting
    );
    assert_eq!(
        planned_status(ProductionStatus::Failed),
        ProductionStatus::Shooting
    );
    assert_eq!(
        planned_status(ProductionStatus::Cutting),
        ProductionStatus::Cutting
    );
}

#[test]
fn boards_ask_for_the_productions_aspect_and_report_progress() {
    assert_eq!(board_size(Aspect::Portrait), "1080x1350");
    assert_eq!(board_size(Aspect::Square), "1080x1080");
    assert_eq!(boards_step(3, 9), "boards 3/9");
}
