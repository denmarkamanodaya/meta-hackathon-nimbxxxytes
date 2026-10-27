use super::super::{Act, ProductionStatus, Shot};
use super::*;
use crate::domain::ids::ShotId;

const STORY_BRIEF: &str = include_str!("../../../../../prompts/story_brief.md");

fn template() -> &'static str {
    STORY_BRIEF.split_once("## user\n").unwrap().1.trim()
}

fn shot(ord: u32, act: Act, segment: Option<&str>) -> Shot {
    Shot {
        id: ShotId::parse(format!("s{ord}")).unwrap(),
        ord,
        act,
        title: format!("Shot {ord}"),
        direction: "d".into(),
        tips: vec![],
        query: "q".into(),
        duration_s: 4.0,
        board_key: None,
        matched_segment_id: segment.map(|s| SegmentId::parse(s).unwrap()),
        match_reason: None,
        take_count: 0,
    }
}

fn ids(shots: &[Shot]) -> Vec<String> {
    cut_segments(shots).into_iter().map(String::from).collect()
}

#[test]
fn the_cut_takes_covered_shots_by_act_then_shot_order_once_each() {
    let shots = [
        shot(1, Act::Story, Some("b")),
        shot(2, Act::Hook, Some("a")),
        shot(3, Act::Outro, Some("d")),
        shot(4, Act::Story, None),
        shot(5, Act::Payoff, Some("c")),
        shot(6, Act::Payoff, Some("b")),
    ];

    assert_eq!(ids(&shots), ["a", "b", "c", "d"]);
}

#[test]
fn the_cut_keeps_at_most_twenty_moments() {
    let names: Vec<String> = (0..25).map(|i| format!("m{i}")).collect();
    let shots: Vec<Shot> = names
        .iter()
        .enumerate()
        .map(|(i, n)| shot(u32::try_from(i).unwrap() + 1, Act::Story, Some(n)))
        .collect();

    let got = ids(&shots);

    assert_eq!(got.len(), 20);
    assert_eq!((got[0].as_str(), got[19].as_str()), ("m0", "m19"));
}

#[test]
fn the_story_brief_lists_the_shots_in_cut_order_under_the_brief() {
    let shots = [
        shot(2, Act::Outro, Some("b")),
        shot(1, Act::Hook, Some("a")),
    ];
    let cut = cut_shots(&shots);

    let text = render_story_brief(template(), "A day at the beach", &cut, 500);

    assert_eq!(
        text,
        "A day at the beach\n\
         Cut it as a story and keep the act order: hook → story → payoff → outro. \
         Shots in order, with their planned length:\n\
         1. hook: Shot 1 (4 s)\n2. outro: Shot 2 (4 s)"
    );
}

#[test]
fn a_long_story_brief_shortens_titles_then_the_brief_to_fit() {
    let mut shots: Vec<Shot> = (1..=12)
        .map(|i| shot(i, Act::Story, Some(&format!("m{i}"))))
        .collect();
    for s in &mut shots {
        s.title = "A very long title that goes on and on about the shot".into();
    }
    let cut = cut_shots(&shots);
    let brief = "b".repeat(1000);

    let text = render_story_brief(template(), &brief, &cut, 500);

    assert!(text.chars().count() <= 500, "{}", text.chars().count());
    let (brief_part, rest) = text.split_once('\n').unwrap();
    assert!(
        brief_part.starts_with("bbb") && brief_part.ends_with('…'),
        "{brief_part}"
    );
    assert!(brief_part.chars().count() >= 80, "the brief keeps its room");
    assert!(rest.contains("\n1. story: A very … (4 s)\n"), "{rest}");
    assert!(
        rest.ends_with("\n12. story: A very … (4 s)"),
        "every shot stays: {rest}"
    );
}

#[test]
fn titles_stay_whole_while_everything_fits() {
    let mut shots: Vec<Shot> = (1..=3)
        .map(|i| shot(i, Act::Story, Some(&format!("m{i}"))))
        .collect();
    shots[0].title = "A title of exactly forty characters long".into();
    let cut = cut_shots(&shots);

    let text = render_story_brief(template(), &"b".repeat(300), &cut, 500);

    assert!(text.contains("1. story: A title of exactly forty characters long (4 s)"));
    assert!(text.chars().count() <= 500);
}

#[test]
fn a_short_story_brief_is_left_whole() {
    let cut = cut_shots(&[]);
    let text = render_story_brief("{brief}|{shots}", "Brief", &cut, 500);
    assert_eq!(text, "Brief|");
}

#[test]
fn a_cut_is_ready_when_its_short_is_and_back_to_shooting_without_one() {
    use ProductionStatus::{Cutting, Ready, Shooting};
    assert_eq!(status_with_short(Cutting, Some(ShortStatus::Ready)), Ready);
    assert_eq!(
        status_with_short(Cutting, Some(ShortStatus::Revising)),
        Cutting
    );
    assert_eq!(
        status_with_short(Cutting, Some(ShortStatus::Failed)),
        Cutting
    );
    assert_eq!(status_with_short(Cutting, None), Shooting);
    assert_eq!(status_with_short(Ready, None), Shooting);
    assert_eq!(
        status_with_short(Ready, Some(ShortStatus::Rendering)),
        Ready
    );
    assert_eq!(status_with_short(Shooting, None), Shooting);
}
