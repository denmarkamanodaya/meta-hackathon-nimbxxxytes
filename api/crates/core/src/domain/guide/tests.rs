use super::*;
use crate::domain::faces::BoxPx;
use crate::domain::sam::{MaskEncoding, MaskRef};

fn record(conf: f64, side: f64, masked: bool) -> SamRecord {
    SamRecord {
        frame: 0,
        id: 1,
        bbox: BoxPx {
            x1: 0.0,
            y1: 0.0,
            x2: side,
            y2: side,
        },
        frame_w: 640,
        frame_h: 480,
        conf,
        mask: masked.then(|| MaskRef {
            encoding: MaskEncoding::OneBit,
            width: 1,
            height: 1,
            payload: "!".into(),
        }),
    }
}

#[test]
fn the_most_confident_masked_record_is_circled_and_a_weak_one_never_is() {
    let records = [
        record(0.6, 50.0, true),
        record(0.9, 10.0, true),
        record(0.95, 90.0, false),
        record(0.9, 20.0, true),
    ];
    let best = best_highlight(&records).unwrap();
    assert_eq!(
        (best.conf, best.bbox.x2),
        (0.9, 20.0),
        "ties go to the larger"
    );

    assert!(best_highlight(&[record(0.49, 99.0, true)]).is_none());
    assert!(best_highlight(&[]).is_none());
}

fn step(start_s: f64, end_s: f64, key_s: f64) -> DraftStep {
    DraftStep {
        title: "Open the door".into(),
        instruction: "Pull the round door open.".into(),
        start_s,
        end_s,
        key_s,
        control: "door handle".into(),
    }
}

fn draft(steps: Vec<DraftStep>) -> GuideDraft {
    GuideDraft {
        safety: Safety::Everyday,
        safety_reason: " A washing machine is an everyday task. ".into(),
        title: "Start a quick wash".into(),
        steps,
    }
}

fn steps_of(plan: GuidePlan) -> Vec<PlannedStep> {
    match plan {
        GuidePlan::Steps { steps, .. } => steps,
        GuidePlan::Refused { .. } => panic!("refused"),
    }
}

fn spans(steps: &[PlannedStep]) -> Vec<(u32, f64, f64, f64)> {
    steps
        .iter()
        .map(|s| (s.n, s.start_s, s.end_s, s.key_s))
        .collect()
}

#[test]
fn a_not_supported_task_is_refused_with_its_reason_and_no_steps() {
    let mut d = draft(vec![step(0.0, 5.0, 2.0); 4]);
    d.safety = Safety::NotSupported;

    let plan = plan_guide(&d, 60.0).unwrap();

    assert_eq!(
        plan,
        GuidePlan::Refused {
            reason: "A washing machine is an everyday task.".into()
        }
    );
}

#[test]
fn steps_are_ordered_by_start_and_numbered_from_one() {
    let d = draft(vec![
        step(20.0, 30.0, 25.0),
        step(0.0, 10.0, 5.0),
        step(10.0, 20.0, 12.0),
    ]);

    let steps = steps_of(plan_guide(&d, 60.0).unwrap());

    assert_eq!(
        spans(&steps),
        [
            (1, 0.0, 10.0, 5.0),
            (2, 10.0, 20.0, 12.0),
            (3, 20.0, 30.0, 25.0)
        ]
    );
}

#[test]
fn times_are_clamped_to_the_clip_and_overlaps_start_after_the_step_before() {
    let d = draft(vec![
        step(-3.0, 10.0, -1.0),
        step(8.0, 20.0, 9.0),
        step(18.0, 99.0, 50.0),
    ]);

    let steps = steps_of(plan_guide(&d, 40.0).unwrap());

    assert_eq!(
        spans(&steps),
        [
            (1, 0.0, 10.0, 0.0),
            (2, 10.0, 20.0, 10.0),
            (3, 20.0, 40.0, 40.0)
        ],
        "starts clamp to 0, ends to the clip, overlaps move, keys stay inside their step"
    );
}

#[test]
fn a_step_left_shorter_than_half_a_second_or_without_numbers_is_dropped() {
    let d = draft(vec![
        step(0.0, 10.0, 5.0),
        step(5.0, 10.2, 6.0),
        step(f64::NAN, 12.0, 11.0),
        step(10.0, 20.0, f64::NAN),
        step(20.0, 30.0, 25.0),
    ]);

    let steps = steps_of(plan_guide(&d, 60.0).unwrap());

    assert_eq!(
        spans(&steps),
        [
            (1, 0.0, 10.0, 5.0),
            (2, 10.0, 20.0, 15.0),
            (3, 20.0, 30.0, 25.0)
        ],
        "a NaN key falls back to the middle of its step"
    );
}

#[test]
fn texts_are_cut_to_their_word_limits_and_an_empty_control_is_none() {
    let mut long = step(0.0, 5.0, 1.0);
    long.title = "one two three four five six seven eight".into();
    long.instruction = (1..=25)
        .map(|i| format!("w{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    long.control = "the big red round start button".into();
    let mut bare = step(5.0, 10.0, 6.0);
    bare.control = "   ".into();
    let d = draft(vec![long, bare, step(10.0, 15.0, 11.0)]);

    let steps = steps_of(plan_guide(&d, 60.0).unwrap());

    assert_eq!(steps[0].title, "one two three four five six");
    assert_eq!(steps[0].instruction.split(' ').count(), INSTRUCTION_WORDS);
    assert_eq!(steps[0].control.as_deref(), Some("the big red round"));
    assert_eq!(steps[1].control, None);
}

#[test]
fn fewer_than_three_usable_steps_is_an_error_and_more_than_twelve_are_cut() {
    let two = draft(vec![step(0.0, 5.0, 1.0), step(5.0, 10.0, 6.0)]);
    let err = plan_guide(&two, 60.0).unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelUnavailable);

    let many: Vec<DraftStep> = (0..15)
        .map(|i| {
            step(
                f64::from(i) * 2.0,
                f64::from(i) * 2.0 + 2.0,
                f64::from(i) * 2.0,
            )
        })
        .collect();
    let steps = steps_of(plan_guide(&draft(many), 60.0).unwrap());
    assert_eq!(steps.len(), MAX_STEPS);
    assert_eq!(steps.last().unwrap().n, 12);
}

#[test]
fn the_guide_title_is_cut_to_six_words_or_falls_back() {
    let mut d = draft(vec![step(0.0, 5.0, 1.0); 1]);
    d.steps = vec![
        step(0.0, 5.0, 1.0),
        step(5.0, 10.0, 6.0),
        step(10.0, 15.0, 11.0),
    ];
    d.title = "  ".into();
    let GuidePlan::Steps { title, reason, .. } = plan_guide(&d, 60.0).unwrap() else {
        panic!("refused");
    };
    assert_eq!(title, FALLBACK_TITLE);
    assert_eq!(reason, "A washing machine is an everyday task.");
}

#[test]
fn an_edit_keeps_the_unsent_field_and_checks_the_sent_one() {
    let current = ("Open the door", "Pull the door open.");

    assert_eq!(
        edited_step(current, (None, Some("  Push   the dial. "))).unwrap(),
        ("Open the door".into(), "Push the dial.".into())
    );
    assert_eq!(
        edited_step(current, (Some("Start"), None)).unwrap(),
        ("Start".into(), "Pull the door open.".into())
    );
    let fail = |patch| edited_step(current, patch).unwrap_err().code;
    assert_eq!(fail((None, None)), ErrorCode::ValidationFailed);
    assert_eq!(fail((Some(" "), None)), ErrorCode::ValidationFailed);
    assert_eq!(
        fail((Some("one two three four five six seven"), None)),
        ErrorCode::ValidationFailed
    );
    assert_eq!(
        fail((None, Some(&"x".repeat(MAX_TEXT_CHARS + 1)))),
        ErrorCode::ValidationFailed
    );
}

#[test]
fn each_step_speaks_its_number_and_instruction_as_one_sentence() {
    assert_eq!(narration(3, "Turn the dial"), "Step 3. Turn the dial.");
    assert_eq!(narration(1, "Press start!"), "Step 1. Press start!");
}

#[test]
fn the_narration_hash_changes_with_the_text_and_the_voice() {
    let a = narration_hash(VOICE, "Step 1. Go.");
    assert_eq!(a.len(), 16);
    assert_eq!(a, narration_hash(VOICE, "Step 1. Go."));
    assert_ne!(a, narration_hash(VOICE, "Step 1. Stop."));
    assert_ne!(a, narration_hash("other", "Step 1. Go."));
}

#[test]
fn only_a_caution_or_refusal_shows_its_reason() {
    let why = Some(" Hot water. ");
    assert_eq!(
        shown_reason(Some(Safety::Caution), why).as_deref(),
        Some("Hot water.")
    );
    assert_eq!(
        shown_reason(Some(Safety::NotSupported), why).as_deref(),
        Some("Hot water.")
    );
    assert_eq!(shown_reason(Some(Safety::Everyday), why), None);
    assert_eq!(shown_reason(Some(Safety::Caution), Some("  ")), None);
    assert_eq!(shown_reason(None, why), None);
}

#[test]
fn texts_round_trip() {
    for s in GuideStage::ALL {
        assert_eq!(GuideStage::parse(s.as_str()).unwrap(), s);
    }
    for s in [Safety::Everyday, Safety::Caution, Safety::NotSupported] {
        assert_eq!(Safety::parse(s.as_str()).unwrap(), s);
    }
    for s in [
        GuideStatus::Queued,
        GuideStatus::Running,
        GuideStatus::Ready,
        GuideStatus::Failed,
        GuideStatus::Refused,
    ] {
        assert_eq!(GuideStatus::parse(s.as_str()).unwrap(), s);
    }
    assert!(Safety::parse("risky").is_err());
}
