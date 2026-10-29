//! Synthetic vectors: each moment is a unit vector, every pair of moments of two clips is scored
//! by cosine similarity (what the vector index answers), and the verdict is checked.

use super::*;
use crate::domain::clip::ClipStatus;
use crate::domain::media::MediaExt;
use crate::domain::probe::ProbeInfo;

const DIM: usize = 16;
const T0: &str = "2026-10-20T10:00:00.000Z";

/// Unit vector along axis `i`, nudged by `noise` on the next axis (so `noise` 0.02 gives a
/// similarity of about 0.9998 to the clean one).
fn axis(i: usize, noise: f32) -> Vec<f32> {
    let mut v = vec![0.0; DIM];
    v[i % DIM] = 1.0;
    v[(i + 1) % DIM] += noise;
    v
}

/// `share` of axis `i` plus the rest on axis `i + 8`: similarity to `axis(i, 0.0)` is about
/// `share / |v|`.
fn blend(i: usize, share: f32) -> Vec<f32> {
    let mut v = vec![0.0; DIM];
    v[i % DIM] = share;
    v[(i + 8) % DIM] = (1.0 - share * share).max(0.0).sqrt();
    v
}

fn cos(a: &[f32], b: &[f32]) -> f64 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let n = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt();
    f64::from(dot / (n(a) * n(b)))
}

struct Fixture {
    clip: Clip,
    moments: Vec<Moment>,
    vectors: Vec<Vec<f32>>,
}

/// A clip `name` of `duration_s` recorded at `recorded_at`, one 6 s moment per vector.
fn clip(name: &str, duration_s: f64, recorded_at: Option<&str>, vectors: Vec<Vec<f32>>) -> Fixture {
    let id = ClipId::parse(name).unwrap();
    let moments = (0..vectors.len())
        .map(|i| Moment {
            segment: SegmentId::parse(format!("{name}-s{i}")).unwrap(),
            clip: id.clone(),
            span: Span {
                start_s: i as f64 * 6.0,
                end_s: (i + 1) as f64 * 6.0,
            },
            blank: false,
        })
        .collect();
    let clip = Clip {
        id,
        user_id: crate::domain::ids::UserId::parse("u1").unwrap(),
        filename: format!("{name}.mov"),
        ext: MediaExt::Mov,
        size_bytes: 1,
        status: ClipStatus::Ready,
        probe: Some(ProbeInfo {
            duration_s,
            width: 1280,
            height: 720,
            fps: 30.0,
            rotation: 0,
            codec: "h264".into(),
            recorded_at: recorded_at.map(str::to_owned),
            has_audio: false,
        }),
        created_at: format!("2026-10-27T00:00:0{}.000Z", name.len() % 10),
        title: None,
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    };
    Fixture {
        clip,
        moments,
        vectors,
    }
}

fn scores(a: &Fixture, b: &Fixture) -> Vec<Score> {
    let mut out = Vec::new();
    for (ma, va) in a.moments.iter().zip(&a.vectors) {
        for (mb, vb) in b.moments.iter().zip(&b.vectors) {
            out.push(Score {
                a: ma.segment.clone(),
                b: mb.segment.clone(),
                similarity: cos(va, vb),
            });
        }
    }
    out
}

fn verdict(copy: &Fixture, original: &Fixture) -> Verdict {
    judge(
        &Footage::of(&copy.clip, &copy.moments),
        &Footage::of(&original.clip, &original.moments),
        &scores(copy, original),
    )
}

fn base() -> Fixture {
    clip(
        "base",
        30.0,
        Some(T0),
        (0..5).map(|i| axis(i, 0.0)).collect(),
    )
}

fn is_copy(v: Verdict) -> bool {
    matches!(v, Verdict::NearCopy(_))
}

#[test]
fn an_identical_clip_is_a_near_copy_with_a_full_score() {
    let copy = clip(
        "same",
        30.0,
        Some(T0),
        (0..5).map(|i| axis(i, 0.0)).collect(),
    );
    match verdict(&copy, &base()) {
        Verdict::NearCopy(score) => assert!((score - 1.0).abs() < 1e-6, "{score}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_reencode_with_small_noise_is_still_a_near_copy() {
    let copy = clip(
        "reencode",
        30.0,
        Some(T0),
        (0..5).map(|i| axis(i, 0.02)).collect(),
    );
    assert!(is_copy(verdict(&copy, &base())));
}

#[test]
fn a_trim_inside_the_original_is_a_near_copy() {
    let trimmed = clip(
        "trimmed",
        18.0,
        Some(T0),
        (1..4).map(|i| axis(i, 0.02)).collect(),
    );
    assert!(is_copy(verdict(&trimmed, &base())));
}

#[test]
fn a_copy_much_longer_than_the_original_is_not_a_near_copy() {
    // The base plus five new moments: twice as long, so it holds more than a copy would.
    let longer = clip(
        "longer",
        60.0,
        None,
        (0..10).map(|i| axis(i, 0.0)).collect(),
    );
    assert_eq!(verdict(&longer, &base()), Verdict::Unrelated);
}

#[test]
fn shuffled_moments_with_full_coverage_and_mean_are_not_a_copy() {
    // Every moment matches at 1.0 (coverage 100%, mean 1.0), only the order differs: this case
    // isolates the order rule.
    let shuffled = clip(
        "shuffled",
        30.0,
        Some("2026-10-21T09:00:00.000Z"),
        [3, 4, 0, 1, 2].into_iter().map(|i| axis(i, 0.0)).collect(),
    );
    assert_eq!(verdict(&shuffled, &base()), Verdict::Unrelated);
}

#[test]
fn the_order_rule_takes_the_longest_increasing_run_not_all_in_order() {
    // One moment out of place out of five: 80% still in order.
    let swapped = clip(
        "swapped",
        30.0,
        None,
        [0, 1, 2, 4, 3].into_iter().map(|i| axis(i, 0.0)).collect(),
    );
    assert!(is_copy(verdict(&swapped, &base())));
    assert_eq!(longest_increasing(&[3.0, 4.0, 0.0, 1.0, 2.0]), 3);
}

#[test]
fn every_moment_over_the_bar_but_a_low_mean_is_the_same_place_not_a_copy() {
    // 0.88 per moment: over T_COPY, under MEAN_COPY (like two parts of one event).
    let event = clip(
        "event",
        30.0,
        None,
        (0..5).map(|i| blend(i, 0.88)).collect(),
    );
    assert_eq!(verdict(&event, &base()), Verdict::Unrelated);
}

#[test]
fn an_unrelated_clip_never_links() {
    let other = clip(
        "other",
        30.0,
        Some("2026-09-14T08:00:00.000Z"),
        (8..13).map(|i| axis(i, 0.0)).collect(),
    );
    assert_eq!(verdict(&other, &base()), Verdict::Unrelated);
}

#[test]
fn the_same_time_alone_never_links() {
    let other = clip(
        "same_time_other",
        19.0,
        Some("2026-10-20T10:02:00.000Z"),
        (8..11).map(|i| axis(i, 0.0)).collect(),
    );
    assert_eq!(verdict(&other, &base()), Verdict::Unrelated);
}

/// Another angle of the base scene: three of five moments at 0.9, the rest unrelated.
fn angle(recorded_at: Option<&str>) -> Fixture {
    let vectors = (0..5)
        .map(|i| {
            if i < 3 {
                blend(i, 0.9)
            } else {
                axis(i + 8, 0.0)
            }
        })
        .collect();
    clip("angle_b", 30.0, recorded_at, vectors)
}

#[test]
fn another_angle_filmed_40_s_later_is_the_same_moment() {
    match verdict(&angle(Some("2026-10-20T10:00:40.000Z")), &base()) {
        Verdict::SameMoment(score) => assert!((score - 0.9).abs() < 1e-3, "{score}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_same_scene_two_hours_apart_is_not_the_same_moment() {
    let later = angle(Some("2026-10-20T12:00:00.000Z"));
    assert_eq!(verdict(&later, &base()), Verdict::Unrelated);
}

#[test]
fn the_upload_time_never_stands_in_for_a_missing_recording_time() {
    let unknown = angle(None);
    assert_eq!(verdict(&unknown, &base()), Verdict::Unrelated);
}

#[test]
fn blank_moments_never_count_and_an_all_blank_clip_never_links() {
    let mut dark = clip(
        "dark",
        30.0,
        Some(T0),
        (0..5).map(|i| axis(i, 0.0)).collect(),
    );
    let mut dark_base = base();
    for m in dark.moments.iter_mut().chain(dark_base.moments.iter_mut()) {
        m.blank = true;
    }
    assert_eq!(verdict(&dark, &dark_base), Verdict::Unrelated);

    // A copy of a clip that starts and ends dark: the dark moments are left out on both sides,
    // and the other three still carry the copy.
    let mut half = base();
    let mut copy = clip("copy", 30.0, None, (0..5).map(|i| axis(i, 0.0)).collect());
    for f in [&mut half, &mut copy] {
        f.moments[0].blank = true;
        f.moments[4].blank = true;
    }
    assert!(is_copy(verdict(&copy, &half)));
}

#[test]
fn blank_is_a_grey_spread_under_twelve() {
    assert!(is_blank(0.0));
    assert!(is_blank(11.9));
    assert!(!is_blank(12.0));
    assert!(!is_blank(48.0));
}

#[test]
fn the_oldest_original_wins_kept_pairs_are_skipped_and_newer_copies_are_reported() {
    let mut me = clip("me", 30.0, None, Vec::new()).clip;
    me.created_at = "2026-10-27T05:00:00.000Z".into();
    let at = |name: &str, created: &str| {
        let mut c = clip(name, 30.0, None, Vec::new()).clip;
        c.created_at = created.into();
        c
    };
    let (old, older, kept, newer_one, angle_c) = (
        at("old", "2026-10-27T03:00:00.000Z"),
        at("older", "2026-10-27T01:00:00.000Z"),
        at("kept", "2026-10-26T00:00:00.000Z"),
        at("newer", "2026-10-27T09:00:00.000Z"),
        at("angle", "2026-10-27T04:00:00.000Z"),
    );
    let out = outcome(
        &me,
        [
            (&old, Verdict::NearCopy(0.97)),
            (&older, Verdict::NearCopy(0.93)),
            (&kept, Verdict::NearCopy(0.99)),
            (&newer_one, Verdict::NearCopy(0.95)),
            (&angle_c, Verdict::SameMoment(0.9)),
        ],
        std::slice::from_ref(&kept.id),
    );
    assert_eq!(out.copy_of, Some((older.id.clone(), 0.93)));
    assert_eq!(out.copied_by, [(newer_one.id.clone(), 0.95)]);
    assert!(
        out.same_moment.is_empty(),
        "a copy is never another clip's angle"
    );
}

#[test]
fn a_same_moment_link_skips_clips_already_set_aside_as_copies() {
    let me = clip("me", 30.0, None, Vec::new()).clip;
    let angle = clip("angle", 30.0, None, Vec::new()).clip;
    let mut near = clip("near", 30.0, None, Vec::new()).clip;
    near.status = ClipStatus::NearCopy;
    let mut dup = clip("dup", 30.0, None, Vec::new()).clip;
    dup.status = ClipStatus::Duplicate;

    let out = outcome(
        &me,
        [
            (&angle, Verdict::SameMoment(0.9)),
            (&near, Verdict::SameMoment(0.93)),
            (&dup, Verdict::SameMoment(0.95)),
        ],
        &[],
    );

    assert_eq!(out.same_moment, [(angle.id.clone(), 0.9)]);
}

#[test]
fn a_link_reads_as_near_copy_from_the_copy_and_copied_by_from_the_original() {
    let (copy, original, third) = (
        ClipId::parse("copy").unwrap(),
        ClipId::parse("orig").unwrap(),
        ClipId::parse("third").unwrap(),
    );
    let mut link = ClipLink {
        clip: copy.clone(),
        other: original.clone(),
        kind: LinkKind::NearCopyOf,
        score: 0.95,
    };
    assert_eq!(
        link.seen_from(&copy),
        Some((&original, LinkRole::NearCopyOf))
    );
    assert_eq!(link.seen_from(&original), Some((&copy, LinkRole::CopiedBy)));
    assert_eq!(link.seen_from(&third), None);
    link.kind = LinkKind::Kept;
    assert_eq!(link.seen_from(&copy), None, "a kept pair is never shown");
    let same = ClipLink::same_moment(&copy, &original, 0.9);
    assert_eq!(
        same.seen_from(&copy),
        Some((&original, LinkRole::SameMoment))
    );
    assert_eq!(
        same.seen_from(&original),
        Some((&copy, LinkRole::SameMoment))
    );
}

#[test]
fn a_same_moment_pair_is_stored_once_lower_id_first() {
    let (a, b) = (ClipId::parse("a").unwrap(), ClipId::parse("b").unwrap());
    assert_eq!(
        ClipLink::same_moment(&b, &a, 0.9),
        ClipLink::same_moment(&a, &b, 0.9)
    );
    assert_eq!(ClipLink::same_moment(&b, &a, 0.9).clip, a);
    assert_eq!(
        LinkKind::parse("near_copy_of").unwrap(),
        LinkKind::NearCopyOf
    );
}
