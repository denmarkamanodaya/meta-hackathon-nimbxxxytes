use super::*;
use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::facts::{FactsStatus, SegmentFacts};
use crate::domain::ids::{SegmentId, TrackId, TurnId};
use crate::domain::index::{LibraryRow, SegmentView, TurnView};
use crate::domain::media::MediaExt;
use crate::domain::probe::ProbeInfo;
use crate::domain::segment::Segment;

fn clip(id: &str, recorded: &str) -> Clip {
    Clip {
        id: ClipId::parse(id).unwrap(),
        user_id: UserId::parse("u1").unwrap(),
        filename: format!("{id}.mp4"),
        ext: MediaExt::Mp4,
        size_bytes: 1,
        status: ClipStatus::Ready,
        probe: Some(ProbeInfo {
            duration_s: 120.0,
            width: 720,
            height: 1280,
            fps: 30.0,
            rotation: 0,
            codec: "h264".into(),
            recorded_at: Some(recorded.into()),
            has_audio: true,
        }),
        created_at: recorded.into(),
        title: Some(format!("Party {id}")),
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    }
}

fn segment(clip: &str, idx: u32, (start_s, end_s): (f64, f64), description: &str) -> SegmentView {
    SegmentView {
        segment: Segment {
            id: SegmentId::parse(format!("{clip}-s{idx}")).unwrap(),
            clip_id: ClipId::parse(clip).unwrap(),
            idx,
            span: Span { start_s, end_s },
        },
        facts: (!description.is_empty()).then(|| SegmentFacts {
            description: description.into(),
            actions: Vec::new(),
            objects: Vec::new(),
            place: None,
            mood: None,
            quality: None,
            hook_score: None,
            status: FactsStatus::Ok,
        }),
    }
}

fn track(n: u32, (first_s, last_s): (f64, f64), name: Option<&str>, hidden: bool) -> TrackView {
    TrackView {
        id: TrackId::parse(format!("t{n}")).unwrap(),
        first_s,
        last_s,
        crop_key: Some(format!("crop-t{n}")),
        person_name: name.map(str::to_owned),
        hidden,
    }
}

fn turn(n: u32, (start_s, end_s): (f64, f64), text: &str) -> TurnView {
    TurnView {
        id: TurnId::parse(format!("u{n}")).unwrap(),
        span: Span { start_s, end_s },
        text: text.into(),
        speaker_id: None,
    }
}

fn detail(c: Clip, segments: Vec<SegmentView>, tracks: Vec<TrackView>) -> ClipDetailRows {
    ClipDetailRows {
        row: LibraryRow {
            clip: c,
            segment_count: 0,
            first_segment: None,
            people: Vec::new(),
            project_ids: Vec::new(),
            speech_count: 0,
            face_count: 0,
        },
        segments,
        turns: vec![
            turn(0, (1.0, 3.0), "Happy birthday!"),
            turn(1, (12.0, 14.0), "Blow the candles"),
        ],
        speakers: Vec::new(),
        tracks,
    }
}

/// c1: Ann in 0–9 s and 20–24 s, Eric in 5–12 s, a hidden named face and an unnamed one.
fn party() -> ClipDetailRows {
    detail(
        clip("c1", "2026-05-01T10:00:00.000Z"),
        vec![
            segment("c1", 0, (0.0, 10.0), "Ann opens a present."),
            segment("c1", 1, (10.0, 20.0), "Eric lights the candles."),
            segment("c1", 2, (20.0, 30.0), "Ann laughs at the table."),
            segment("c1", 3, (30.0, 40.0), ""),
        ],
        vec![
            track(0, (0.0, 8.0), Some("Ann"), false),
            track(1, (5.0, 11.0), Some("Eric"), false),
            track(2, (20.0, 23.0), Some("ann"), false),
            track(3, (0.0, 39.0), Some("Zed"), true),
            track(4, (30.0, 39.0), None, false),
        ],
    )
}

#[test]
fn a_person_is_found_only_in_described_segments_where_their_visible_track_is() {
    let found = gather(&party(), Subject::Person("ANN"));
    let starts: Vec<f64> = found.iter().map(|m| m.start_s).collect();
    assert_eq!(starts, [0.0, 20.0]);
    let first = &found[0];
    assert_eq!(first.names(), ["Ann", "Eric"]);
    assert_eq!(first.on_screen_s, 9.0);
    assert_eq!(
        first.frame_s, 4.5,
        "the middle of Ann's track inside the segment"
    );
    assert_eq!(first.said, "Happy birthday!");
    assert_eq!(first.clip_title, "Party c1");
    assert_eq!(
        first.recorded_at.as_deref(),
        Some("2026-05-01T10:00:00.000Z")
    );
    assert_eq!(first.people[0].crop_key.as_deref(), Some("crop-t0"));
    // Hidden Zed never counts, even with a name.
    assert!(found.iter().all(|m| !m.names().contains(&"Zed")));
}

#[test]
fn a_clip_session_counts_every_visible_track_but_needs_a_description() {
    let found = gather(&party(), Subject::Everyone);
    let starts: Vec<f64> = found.iter().map(|m| m.start_s).collect();
    assert_eq!(starts, [0.0, 10.0, 20.0], "segment 3 has no description");
    assert_eq!(found[1].names(), ["Eric"]);
    assert_eq!(
        found[1].frame_s, 11.0,
        "inside Eric's track (5..12) and the segment"
    );
}

fn moment(clip: &str, start_s: f64, people: &[&str], on: f64) -> MemoryMoment {
    let mut m = gather(&party(), Subject::Everyone).remove(0);
    m.clip_id = ClipId::parse(clip).unwrap();
    m.recorded_at = Some(format!("2026-0{}-01", clip.len()));
    m.start_s = start_s;
    m.on_screen_s = on;
    m.people = people
        .iter()
        .map(|n| MomentPerson {
            person_id: None,
            name: (*n).into(),
            crop_key: None,
        })
        .collect();
    m
}

#[test]
fn named_people_rank_first_and_the_viewer_counts_double() {
    let all = vec![
        moment("a", 0.0, &["Ann"], 50.0),
        moment("b", 0.0, &["Ann", "Bo"], 1.0),
        moment("c", 0.0, &["Ann", "Eric"], 1.0),
        moment("d", 0.0, &["Ann", "Bo", "Cy"], 2.0),
    ];
    let one = |viewer| pick(all.clone(), viewer, (3, 1))[0].clip_id.to_string();
    assert_eq!(one(None), "d", "most named people");
    assert_eq!(
        one(Some("eric")),
        "d",
        "3 people tie with 2 + viewer; more on screen wins"
    );
    let two = pick(all.clone(), Some("Eric"), (3, 2));
    let ids: Vec<&str> = two.iter().map(|m| m.clip_id.as_str()).collect();
    assert!(ids.contains(&"c"), "the viewer lifts c over b: {ids:?}");
}

#[test]
fn moments_spread_across_clips_and_time_then_play_in_order() {
    let mut all: Vec<MemoryMoment> = (0..6)
        .map(|i| moment("a", f64::from(i) * 10.0, &["Ann"], 10.0 - f64::from(i)))
        .collect();
    all.push(moment("bb", 0.0, &["Ann"], 1.0));
    let picked = pick(all, None, (3, 6));
    let got: Vec<(&str, f64, u32)> = picked
        .iter()
        .map(|m| (m.clip_id.as_str(), m.start_s, m.index))
        .collect();
    // Within clip a: 0 s, then 30 s (10 and 20 are within 25 s), then nothing else fits (40 and
    // 50 are within 25 s of 30); clip bb's only moment is kept.
    assert_eq!(got, [("a", 0.0, 0), ("a", 30.0, 1), ("bb", 0.0, 2)]);
}

#[test]
fn a_person_session_takes_at_most_three_per_clip_and_six_in_all() {
    let all: Vec<MemoryMoment> = ["a", "b", "c"]
        .iter()
        .flat_map(|c| (0..5).map(move |i| moment(c, f64::from(i) * 30.0, &["Ann"], 5.0)))
        .collect();
    let picked = pick(all.clone(), None, limits(SubjectKind::Person));
    assert_eq!(picked.len(), 6);
    for c in ["a", "b", "c"] {
        assert!(picked.iter().filter(|m| m.clip_id.as_str() == c).count() <= 3);
    }
    let day = pick(all, None, limits(SubjectKind::Clip));
    assert_eq!(day.len(), 8);
}

fn written(index: u32, line: &str) -> WrittenLine {
    WrittenLine {
        index,
        line: line.into(),
        prompt: format!("Question {index}?"),
    }
}

#[test]
fn written_lines_land_on_their_moments_and_unwritten_moments_drop() {
    let mut ms = pick(
        vec![
            moment("a", 0.0, &["Ann"], 1.0),
            moment("b", 0.0, &["Ann"], 1.0),
            moment("c", 0.0, &["Ann"], 1.0),
        ],
        None,
        (3, 6),
    );
    let answer = WriteAnswer {
        title: "  Ann's   spring ".into(),
        moments: vec![
            written(2, "Ann  at the   lake."),
            written(0, "Ann opens a present."),
            written(1, "  "),
        ],
    };
    let title = apply_written(&mut ms, &answer, "Ann");
    assert_eq!(title, "Ann's spring");
    let lines: Vec<(u32, &str, &str)> = ms
        .iter()
        .map(|m| (m.index, m.clip_id.as_str(), m.line.as_str()))
        .collect();
    assert_eq!(
        lines,
        [
            (0, "a", "Ann opens a present."),
            (1, "c", "Ann at the lake.")
        ]
    );
    assert_eq!(ms[1].prompt, "Question 2?");
    let none = WriteAnswer::default();
    assert_eq!(apply_written(&mut ms.clone(), &none, "Ann"), "Ann");
}

fn verdict(index: u32, supported: bool, claims: &[&str], line: &str) -> LineCheck {
    LineCheck {
        index,
        supported,
        unsupported_claims: claims.iter().map(|c| (*c).into()).collect(),
        line: line.into(),
    }
}

#[test]
fn the_check_rewrites_unsupported_lines_drops_empty_ones_and_counts_both() {
    let mut ms = pick(
        vec![
            moment("a", 0.0, &["Ann"], 1.0),
            moment("b", 0.0, &["Ann"], 1.0),
            moment("c", 0.0, &["Ann"], 1.0),
        ],
        None,
        (3, 6),
    );
    for m in &mut ms {
        m.line = format!("line {}", m.index);
    }
    let checks = [
        verdict(0, true, &[], "ignored"),
        verdict(1, false, &["it was her birthday"], "Ann opens a present."),
        verdict(2, false, &["you are Ann"], " "),
    ];
    assert_eq!(apply_checked(&mut ms, &checks), 2);
    assert_eq!(ms.len(), 2);
    assert!(ms.iter().all(|m| m.checked));
    assert_eq!(
        (ms[0].line.as_str(), ms[0].fixed_note.as_deref()),
        ("line 0", None)
    );
    assert_eq!(ms[1].index, 1);
    assert_eq!(ms[1].line, "Ann opens a present.");
    assert_eq!(
        ms[1].fixed_note.as_deref(),
        Some("Removed: it was her birthday")
    );
}

#[test]
fn text_is_cut_on_a_word() {
    assert_eq!(cut("one two three", 9), "one two");
    assert_eq!(cut("  a   b ", 10), "a b");
    assert_eq!(cut("abcdef", 3), "abc");
}

#[test]
fn a_moment_plays_only_while_the_people_in_it_are_on_screen() {
    let found = gather(&party(), Subject::Person("Ann"));
    // Segment 2 runs 20–30 s, but Ann (the only named face) is seen 20–23 s (to 24 s).
    let last = &found[1];
    assert_eq!((last.start_s, last.end_s), (20.0, 24.0));
    assert!(last.frame_s >= 20.0 && last.frame_s <= 24.0);
}

#[test]
fn a_short_appearance_still_plays_at_least_three_seconds_inside_its_segment() {
    let found = gather(&party(), Subject::Everyone);
    // Segment 1 runs 10–20 s; Eric is seen to 12 s, so it plays 10–13 s.
    assert_eq!((found[1].start_s, found[1].end_s), (10.0, 13.0));
}
