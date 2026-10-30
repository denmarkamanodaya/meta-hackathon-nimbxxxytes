use super::*;

/// The spike's Mandarin/Japanese meeting call, five turns, two speakers.
fn mix() -> Vec<ListenTurn> {
    let t = |i: u32, (s, e): (u64, u64), sp: &str, text: &str| {
        ListenTurn::heard(i, (s, e), Some(sp.to_owned()), text)
    };
    vec![
        t(
            0,
            (0, 4_460),
            "A",
            "我们明天的会议几点开始？我想确认一下时间。",
        ),
        t(
            1,
            (5_340, 10_620),
            "B",
            "明日の会議は午前十時からです。場所は三階の会議室です。",
        ),
        t(
            2,
            (10_780, 15_980),
            "A",
            "好的,那我会准备产品的演示资料。需要带电脑吗？",
        ),
        t(
            3,
            (16_300, 21_420),
            "B",
            "はい、パソコンを持ってきてください。資料は英語でお願いします。",
        ),
        t(
            4,
            (21_660, 25_660),
            "A",
            "没问题, 我今天晚上晚上就把资料发给你。谢谢。",
        ),
    ]
}

fn draft(line_1: &str) -> Draft {
    let d = |i: u32, lang: &str, tr: &str| DraftTurn {
        index: i,
        lang: lang.into(),
        translation: tr.into(),
    };
    Draft {
        title: "Confirmation for Tomorrow's 10 AM Meeting".into(),
        turns: vec![
            d(
                0,
                "zh",
                "What time does our meeting start tomorrow? I want to confirm the time.",
            ),
            d(1, "ja", line_1),
            d(
                2,
                "zh",
                "Okay, then I will prepare the product demonstration materials.",
            ),
            d(
                3,
                "ja",
                "Yes, please bring your computer. Please prepare the materials in English.",
            ),
            d(
                4,
                "zh",
                "No problem, I will send the materials to you tonight. Thank you.",
            ),
        ],
        summary: "B confirms the meeting starts at 10 AM on the third floor.".into(),
        key_points: vec!["Meeting tomorrow at 10:00 AM".into()],
    }
}

const GOOD_1: &str =
    "Tomorrow's meeting is from 10 AM. The location is the conference room on the third floor.";
const BAD_1: &str =
    "Tomorrow's meeting is from 11 AM. The location is the conference room on the second floor.";

fn answer(scores: [u32; 5], summary_score: u32) -> CheckAnswer {
    CheckAnswer {
        turns: (0u32..)
            .zip(scores)
            .map(|(index, score)| TurnCheck {
                index,
                back_translation: String::new(),
                score,
                issue: if score < 90 {
                    "Time is wrong.".into()
                } else {
                    String::new()
                },
                heard_as: String::new(),
            })
            .collect(),
        summary_score,
        summary_issues: if summary_score < 90 {
            vec!["Key points say 11:00 AM.".into()]
        } else {
            Vec::new()
        },
    }
}

#[test]
fn output_languages_are_the_curated_twelve() {
    assert_eq!(OUTPUT_LANGUAGES.len(), 12);
    assert_eq!(output_language("zh").unwrap().name, "中文");
    assert_eq!(output_language(" en ").unwrap().code, "en");
    assert_eq!(output_language("hi").unwrap().name, "हिन्दी");
    let err = output_language("xx").unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
}

#[test]
fn sound_and_video_files_are_taken_and_everything_else_refused() {
    let file = |name: &str, ct: &str, size: u64| NewListenFile {
        filename: name.into(),
        content_type: ct.into(),
        size_bytes: size,
    };
    assert_eq!(
        checked_file(&file("a.MP3", "audio/mpeg", 10)).unwrap(),
        "mp3"
    );
    assert_eq!(
        checked_file(&file("v.mov", "video/quicktime", 10)).unwrap(),
        "mov"
    );
    assert_eq!(
        checked_file(&file("n.m4a", "audio/x-m4a; codecs=aac", 10)).unwrap(),
        "m4a"
    );
    for ct in AUDIO_TYPES {
        assert!(accepted_type(ct), "{ct}");
    }
    for bad in [
        file("a.png", "image/png", 10),
        file("a.mp3", "image/png", 10),
        file("a.mp3", "audio/mpeg", 0),
        file("a.mp3", "audio/mpeg", MAX_BYTES + 1),
        file("", "audio/mpeg", 10),
        file("a.exe", "audio/mpeg", 10),
        file("a.wav", "audio/midi", 10),
    ] {
        assert!(checked_file(&bad).is_err(), "{bad:?}");
    }
    assert!(checked_file(&file("a.wav", "audio/wav", MAX_BYTES)).is_ok());
}

#[test]
fn a_recording_over_two_hours_or_without_length_is_refused() {
    assert_eq!(checked_duration(26.16).unwrap(), 26_160);
    assert_eq!(checked_duration(MAX_DURATION_S).unwrap(), 7_200_000);
    assert_eq!(
        checked_duration(MAX_DURATION_S + 1.0).unwrap_err().code,
        ErrorCode::ValidationFailed
    );
    assert_eq!(
        checked_duration(0.0).unwrap_err().code,
        ErrorCode::MediaFailed
    );
    assert_eq!(
        checked_duration(f64::NAN).unwrap_err().code,
        ErrorCode::MediaFailed
    );
}

#[test]
fn shares_come_from_speaking_time_and_add_up_to_100() {
    let mut turns = mix();
    let langs = ["zh", "ja", "zh", "ja", "zh"];
    for (t, l) in turns.iter_mut().zip(langs) {
        t.lang = l.into();
    }
    let shares = language_shares(&turns);
    assert_eq!(
        shares,
        [
            HeardShare {
                code: "zh".into(),
                share: 57
            },
            HeardShare {
                code: "ja".into(),
                share: 43
            }
        ],
        "13.66 s of Mandarin against 10.4 s of Japanese"
    );
    let three: Vec<ListenTurn> = ["ja", "zh", "en"]
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let mut t = ListenTurn::heard(u32::try_from(i).unwrap(), (0, 1_000), None, "x");
            t.lang = (*l).into();
            t
        })
        .collect();
    let s = language_shares(&three);
    assert_eq!(s.iter().map(|h| h.share).sum::<u32>(), 100);
    assert_eq!(
        s.iter()
            .map(|h| (h.code.as_str(), h.share))
            .collect::<Vec<_>>(),
        [("en", 34), ("ja", 33), ("zh", 33)],
        "the extra point goes to the first code on a tie; largest first, then by code"
    );
    assert!(language_shares(&mix()).is_empty(), "nothing understood yet");
}

#[test]
fn untimed_turns_count_once_each() {
    let turns: Vec<ListenTurn> = ["ko", "ko", "en"]
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let mut t = ListenTurn::heard(u32::try_from(i).unwrap(), (5, 5), None, "x");
            t.lang = (*l).into();
            t
        })
        .collect();
    let s = language_shares(&turns);
    assert_eq!((s[0].code.as_str(), s[0].share, s[1].share), ("ko", 67, 33));
}

#[test]
fn long_transcripts_go_in_parts_of_120_turns_or_24k_characters() {
    let many: Vec<ListenTurn> = (0..250)
        .map(|i| ListenTurn::heard(i, (0, 1), None, "hello"))
        .collect();
    assert_eq!(parts(&many), [0..120, 120..240, 240..250]);
    let long: Vec<ListenTurn> = (0..5)
        .map(|i| ListenTurn::heard(i, (0, 1), None, &"字".repeat(10_000)))
        .collect();
    assert_eq!(parts(&long), [0..2, 2..4, 4..5]);
    let huge = vec![ListenTurn::heard(0, (0, 1), None, &"a".repeat(30_000))];
    assert_eq!(parts(&huge).len(), 1, "one long turn is a part of its own");
    assert!(parts(&[]).is_empty());
    assert_eq!(part_label(0, 1), "the whole recording");
    assert_eq!(part_label(1, 3), "part 2 of 3 of the recording");
}

#[test]
fn a_tidied_draft_has_one_line_per_turn_and_a_title() {
    let mut raw = draft(GOOD_1);
    raw.title = "  ".into();
    raw.turns.remove(2);
    raw.turns[0].lang = " ZH ".into();
    raw.turns[1].lang = "Japanese".into();
    raw.turns.push(DraftTurn {
        index: 9,
        lang: "en".into(),
        translation: "invented".into(),
    });
    raw.key_points = vec![
        " a ".into(),
        "".into(),
        "b".into(),
        "c".into(),
        "d".into(),
        "e".into(),
        "f".into(),
    ];
    let t = tidied_draft(&raw, &mix());
    assert_eq!(t.title, FALLBACK_TITLE);
    assert_eq!(t.turns.len(), 5);
    assert_eq!(
        t.turns.iter().map(|d| d.index).collect::<Vec<_>>(),
        [0, 1, 2, 3, 4]
    );
    assert_eq!(
        (t.turns[0].lang.as_str(), t.turns[1].lang.as_str()),
        ("zh", "")
    );
    assert_eq!(
        t.turns[2].translation, "",
        "a skipped turn stays empty for the check to fail"
    );
    assert_eq!(t.key_points, ["a", "b", "c", "d", "e"]);
}

#[test]
fn a_clean_draft_passes_at_the_lowest_score() {
    let s = scored(&mix(), &draft(GOOD_1), &answer([100, 98, 100, 95, 100], 97));
    assert!(s.passed);
    assert_eq!(s.confidence, 95);
    assert!(flagged_turns(&s).is_empty());
    assert!(checker_notes(&s).is_empty());
}

#[test]
fn the_planted_errors_fail_and_the_notes_name_the_line_and_summary() {
    let s = scored(&mix(), &draft(BAD_1), &answer([100, 30, 100, 100, 100], 75));
    assert!(!s.passed);
    assert_eq!(s.confidence, 30);
    assert_eq!(flagged_turns(&s), [1]);
    assert_eq!(
        checker_notes(&s),
        ["line 2: Time is wrong.", "Key points say 11:00 AM."]
    );
    assert_eq!(
        fixer_notes(&s),
        ["turn 1: Time is wrong.", "Key points say 11:00 AM."],
        "the fixer sees the index its turn lines carry"
    );
}

#[test]
fn a_lost_number_caps_the_line_even_when_the_checker_missed_it() {
    let s = scored(
        &mix(),
        &draft(BAD_1),
        &answer([100, 100, 100, 100, 100], 100),
    );
    assert_eq!(s.lines[1].score, NUMBER_CAP);
    assert_eq!(s.lines[1].issue, "A number from the original is missing.");
    assert!(!s.passed);
    assert_eq!(flagged_turns(&s), [1]);
}

#[test]
fn a_line_the_checker_skipped_scores_zero_and_scores_are_clamped() {
    let mut a = answer([100, 100, 100, 100, 100], 250);
    a.turns.remove(3);
    let s = scored(&mix(), &draft(GOOD_1), &a);
    assert_eq!(
        (s.lines[3].score, s.lines[3].issue.as_str()),
        (0, "not checked")
    );
    assert_eq!(s.summary_score, 100);
    let n = checker_notes(&s);
    assert_eq!(n, ["line 4: not checked"]);
}

#[test]
fn a_low_summary_without_issues_still_gets_a_note() {
    let mut a = answer([100; 5], 50);
    a.summary_issues.clear();
    let s = scored(&mix(), &draft(GOOD_1), &a);
    assert_eq!(checker_notes(&s), ["summary: low score"]);
}

#[test]
fn a_fix_changes_only_flagged_lines_and_the_summary_only_when_flagged() {
    let prev = draft(BAD_1);
    let fix = FixAnswer {
        turns: vec![
            FixTurn {
                index: 0,
                translation: "CHANGED UNASKED".into(),
            },
            FixTurn {
                index: 1,
                translation: format!(" {GOOD_1} "),
            },
        ],
        summary: "New summary.".into(),
        key_points: vec!["Meeting at 10:00 AM".into()],
    };
    let next = fixed_draft(&prev, &fix, &[1], false);
    assert_eq!(next.turns[0].translation, prev.turns[0].translation);
    assert_eq!(next.turns[1].translation, GOOD_1);
    assert_eq!(next.turns[1].lang, "ja");
    assert_eq!(
        (next.summary.as_str(), next.title.as_str()),
        (prev.summary.as_str(), prev.title.as_str())
    );
    let with_summary = fixed_draft(&prev, &fix, &[1], true);
    assert_eq!(with_summary.summary, "New summary.");
    assert_eq!(with_summary.key_points, ["Meeting at 10:00 AM"]);
    let dropped = FixAnswer {
        turns: Vec::new(),
        summary: " ".into(),
        key_points: Vec::new(),
    };
    let kept = fixed_draft(&prev, &dropped, &[1], true);
    assert_eq!(kept, prev, "a fixer that answers nothing changes nothing");
}

fn version(n: u32, line_1: &str, confidence: Option<u32>) -> ListenVersion {
    ListenVersion {
        version: n,
        draft: draft(line_1),
        check: confidence.map(|c| Scored {
            lines: Vec::new(),
            summary_score: c,
            summary_issues: Vec::new(),
            confidence: c,
            passed: c >= PASS_SCORE,
        }),
    }
}

#[test]
fn the_best_version_is_the_highest_confidence_and_the_later_on_a_tie() {
    let v = [
        version(1, BAD_1, Some(60)),
        version(2, GOOD_1, Some(85)),
        version(3, "x", Some(85)),
    ];
    assert_eq!(best_version(&v).unwrap().version, 3);
    let w = [version(1, BAD_1, Some(88)), version(2, GOOD_1, Some(70))];
    assert_eq!(best_version(&w).unwrap().version, 1);
    assert!(best_version(&[version(1, BAD_1, None)]).is_none());
}

#[test]
fn fixed_in_names_the_version_that_last_changed_a_line() {
    let v = [
        version(1, BAD_1, Some(30)),
        version(2, GOOD_1, Some(100)),
        version(3, GOOD_1, Some(100)),
    ];
    assert_eq!(fixed_in(&v, 3, 1), 2);
    assert_eq!(fixed_in(&v, 1, 1), 1);
    assert_eq!(fixed_in(&v, 3, 0), 1, "never fixed");
}

#[test]
fn speakers_are_counted_once_and_titles_are_checked() {
    assert_eq!(speaker_count(&mix()), 2);
    assert_eq!(listen_title("  Team   call ").unwrap(), "Team call");
    assert!(listen_title(" ").is_err());
    assert!(listen_title(&"a".repeat(81)).is_err());
}

#[test]
fn a_transcription_slip_alone_never_fails_a_line_or_reaches_the_fixer() {
    let mut a = answer([100, 60, 100, 100, 100], 95);
    a.turns[1].issue = String::new();
    a.turns[1].heard_as = "'三階' heard as '散会'".into();
    let s = scored(&mix(), &draft(GOOD_1), &a);
    assert_eq!((s.lines[1].score, s.passed), (PASS_SCORE, true));
    assert!(flagged_turns(&s).is_empty());
    assert_eq!(
        checker_notes(&s),
        ["line 2 heard as: '三階' heard as '散会'"]
    );
    assert!(fixer_notes(&s).is_empty(), "the fixer never sees slips");
}

#[test]
fn a_slip_beside_a_real_issue_still_fails_and_a_lost_number_still_caps() {
    let mut a = answer([100, 30, 100, 100, 100], 95);
    a.turns[1].heard_as = "'十時' heard as '自治'".into();
    let s = scored(&mix(), &draft(BAD_1), &a);
    assert_eq!(s.lines[1].score, 30);
    assert_eq!(
        checker_notes(&s),
        [
            "line 2: Time is wrong.",
            "line 2 heard as: '十時' heard as '自治'"
        ]
    );
    assert_eq!(fixer_notes(&s), ["turn 1: Time is wrong."]);
    let mut slip_only = answer([100; 5], 95);
    slip_only.turns[1].heard_as = "x".into();
    let capped = scored(&mix(), &draft(BAD_1), &slip_only);
    assert_eq!(
        capped.lines[1].score, NUMBER_CAP,
        "the lift never hides a lost number"
    );
}
