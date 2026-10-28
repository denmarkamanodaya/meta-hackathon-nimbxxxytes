use super::*;
use crate::domain::faces::BoxPx;

const FRAME: (u32, u32) = (480, 640);
const DT: f64 = 1.0 / 12.0;

fn seen(centres: &[Option<(f64, f64)>]) -> Vec<TrackSample> {
    centres
        .iter()
        .enumerate()
        .map(|(i, c)| TrackSample {
            t_s: 10.0 + i as f64 * DT,
            centre: *c,
        })
        .collect()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn a_3_4_frame_cut_to_9_16_keeps_the_full_height_and_three_quarters_of_the_width() {
    let (hw, hh) = crop_half(0.75, VERTICAL_ASPECT);
    assert!(close(hw, 0.375) && close(hh, 0.5), "{hw} {hh}");
    let (hw, hh) = crop_half(16.0 / 9.0, 1.0);
    assert!(close(hw, 0.28125) && close(hh, 0.5));
    let (hw, hh) = crop_half(0.5, VERTICAL_ASPECT);
    assert!(close(hw, 0.5) && hh < 0.5, "a narrower frame crops height");
}

#[test]
fn a_still_subject_gives_a_still_camera() {
    let path = crop_path(&seen(&[Some((0.55, 0.5)); 24]), FRAME, VERTICAL_ASPECT);
    assert_eq!(path.len(), 24);
    assert!(path.iter().all(|k| close(k.cx, 0.55) && close(k.cy, 0.5)));
    assert!(
        close(path[23].t_s, 10.0 + 23.0 * DT),
        "times are clip seconds"
    );
}

#[test]
fn jitter_inside_the_dead_zone_never_moves_the_camera() {
    let wobble: Vec<Option<(f64, f64)>> = (0..36)
        .map(|i| Some((0.55 + if i % 2 == 0 { 0.015 } else { -0.015 }, 0.5)))
        .collect();
    let path = crop_path(&seen(&wobble), FRAME, VERTICAL_ASPECT);
    let first = path[0].cx;
    assert!(path.iter().all(|k| close(k.cx, first)), "{path:?}");
}

#[test]
fn a_fast_pan_is_limited_to_the_max_speed_and_still_arrives() {
    let mut c = vec![Some((0.4, 0.5)); 2];
    c.extend(vec![Some((0.62, 0.5)); 70]);
    let path = crop_path(&seen(&c), FRAME, VERTICAL_ASPECT);
    for w in path.windows(2) {
        let speed = (w[1].cx - w[0].cx).abs() / (w[1].t_s - w[0].t_s);
        assert!(speed <= MAX_PAN_PER_S + 1e-9, "pan at {speed}/s");
    }
    assert!(path[2].cx > path[1].cx, "it starts moving");
    let last = path.last().map_or(0.0, |k| k.cx);
    assert!((0.62 - DEAD_ZONE - 0.01..=0.62).contains(&last), "{last}");
}

#[test]
fn a_lost_subject_holds_the_last_position() {
    let mut c = vec![Some((0.5, 0.5)); 3];
    c.extend(vec![Some((0.62, 0.5)); 6]);
    c.extend(vec![None; 12]);
    let path = crop_path(&seen(&c), FRAME, VERTICAL_ASPECT);
    let held = path[8].cx;
    assert!(held > 0.5);
    assert!(path[9..].iter().all(|k| close(k.cx, held)), "{path:?}");
}

#[test]
fn a_subject_never_seen_keeps_the_centre_and_late_sightings_start_there() {
    let path = crop_path(&seen(&[None; 5]), FRAME, VERTICAL_ASPECT);
    assert!(path.iter().all(|k| close(k.cx, 0.5) && close(k.cy, 0.5)));
    let mut c = vec![None; 3];
    c.push(Some((0.6, 0.5)));
    let path = crop_path(&seen(&c), FRAME, VERTICAL_ASPECT);
    assert!(close(path[0].cx, 0.6), "starts on the first sighting");
}

#[test]
fn the_crop_never_leaves_the_frame_at_the_edges() {
    let left = crop_path(&seen(&[Some((0.0, 0.5)); 12]), FRAME, VERTICAL_ASPECT);
    assert!(left.iter().all(|k| close(k.cx, 0.375)), "{left:?}");
    let right = crop_path(&seen(&[Some((0.99, 0.02)); 12]), FRAME, VERTICAL_ASPECT);
    assert!(right.iter().all(|k| close(k.cx, 0.625) && close(k.cy, 0.5)));
    let wide = crop_path(&seen(&[Some((0.5, 0.0)); 4]), (480, 960), VERTICAL_ASPECT);
    let (_, hh) = crop_half(0.5, VERTICAL_ASPECT);
    assert!(wide.iter().all(|k| close(k.cy, hh)));
}

fn rec(frame: u32, (x1, x2): (f64, f64)) -> SamRecord {
    SamRecord {
        frame,
        id: 0,
        bbox: BoxPx {
            x1,
            y1: 100.0,
            x2,
            y2: 300.0,
        },
        frame_w: 480,
        frame_h: 640,
        conf: 1.0,
        mask: None,
    }
}

#[test]
fn samples_cover_every_proxy_frame_in_clip_seconds() {
    let track = [
        rec(0, (100.0, 140.0)),
        rec(24, (200.0, 280.0)),
        rec(24, (0.0, 10.0)),
    ];
    let s = samples(&track, 12.0, frames_in(12.0, 14.5, 12), 12);
    assert_eq!(s.len(), 30);
    assert!(close(s[24].t_s, 14.0), "frame 24 from 12.0 at 12 fps");
    assert_eq!(s[0].centre, Some((120.0 / 480.0, 200.0 / 640.0)));
    assert_eq!(
        s[24].centre,
        Some((240.0 / 480.0, 200.0 / 640.0)),
        "the larger box"
    );
    assert_eq!(s[1].centre, None);
}

fn clip(seg: &str, subject: Option<&str>) -> TimelineClip {
    TimelineClip {
        segment_id: SegmentId::parse(seg).unwrap(),
        in_s: 1.0,
        out_s: 3.0,
        subject: subject.map(str::to_owned),
        punch_in: 1.0,
        reason: String::new(),
    }
}

fn row(n: u32, seg: &str, subject: &str) -> ShotReframe {
    ShotReframe {
        short_id: ShortId::parse("sh").unwrap(),
        version_n: n,
        segment_id: SegmentId::parse(seg).unwrap(),
        subject: subject.into(),
        crop_path: vec![],
        frames_tracked: 1,
        frames_total: 2,
        lost_s: 0.0,
        updated_at: "t".into(),
    }
}

#[test]
fn a_saved_cut_reuses_a_row_with_the_same_subject_and_a_changed_subject_matches_none() {
    let rows = [row(1, "a", "dog"), row(2, "a", "dog"), row(1, "b", "car")];
    assert_eq!(
        reframe_for(&rows, 3, &clip("a", Some("dog"))).map(|r| r.version_n),
        Some(2)
    );
    assert_eq!(
        reframe_for(&rows, 1, &clip("a", Some("dog"))).map(|r| r.version_n),
        Some(1)
    );
    assert!(reframe_for(&rows, 3, &clip("a", Some("cat"))).is_none());
    assert!(reframe_for(&rows, 3, &clip("a", None)).is_none());
}

#[test]
fn only_shots_with_a_subject_are_followed_each_once_and_at_most_20() {
    let mut clips = vec![
        clip("a", Some("dog")),
        clip("b", None),
        clip("a", Some("dog ")),
        clip("c", Some(" ")),
    ];
    assert_eq!(reframe_shots(&clips).len(), 1);
    clips = (0..25).map(|i| clip(&format!("s{i}"), Some("x"))).collect();
    assert_eq!(reframe_shots(&clips).len(), MAX_REFRAME_SHOTS);
}

#[test]
fn status_prefers_running_then_ready_then_failed() {
    assert_eq!(reframe_status(true, true, 2, 2), ReframeStatus::Running);
    assert_eq!(reframe_status(false, true, 2, 2), ReframeStatus::Ready);
    assert_eq!(reframe_status(false, true, 2, 1), ReframeStatus::Failed);
    assert_eq!(reframe_status(false, false, 2, 1), ReframeStatus::Idle);
    assert_eq!(reframe_step(3, 5), "reframe 3/5");
}
