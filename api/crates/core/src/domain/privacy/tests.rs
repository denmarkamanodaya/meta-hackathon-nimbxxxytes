use super::*;
use crate::domain::faces::{BoxPx, track_runs};

fn det(frame: u32, ordinal: u32, (x1, y1, x2, y2): (f64, f64, f64, f64)) -> Detection {
    Detection {
        frame,
        ordinal,
        bbox: BoxPx { x1, y1, x2, y2 },
        frame_w: 720,
        frame_h: 1280,
        conf: 0.9,
    }
}

fn fb(t_s: f64) -> FaceBox {
    FaceBox {
        t_s,
        x: 0.1,
        y: 0.2,
        w: 0.1,
        h: 0.1,
    }
}

fn hidden(segment: &str, track: &str, (start_s, end_s): (f64, f64), times: &[f64]) -> HiddenBoxes {
    HiddenBoxes {
        segment_id: SegmentId::parse(segment).unwrap(),
        span: Span { start_s, end_s },
        track_id: TrackId::parse(track).unwrap(),
        aspect: Some(0.5625),
        boxes: times.iter().map(|t| fb(*t)).collect(),
    }
}

#[test]
fn boxes_are_shares_of_the_upright_frame_clipped_to_it() {
    let b = normalised_box(&det(3, 0, (72.0, 128.0, 216.0, 384.0))).unwrap();
    assert_eq!((b.t_s, b.x, b.y), (3.0, 0.1, 0.1));
    assert!((b.w - 0.2).abs() < 1e-12 && (b.h - 0.2).abs() < 1e-12);

    let edge = normalised_box(&det(0, 0, (-36.0, 1200.0, 72.0, 1400.0))).unwrap();
    assert_eq!(
        (edge.x, edge.y + edge.h),
        (0.0, 1.0),
        "clipped to the frame"
    );
    assert_eq!(normalised_box(&det(0, 0, (800.0, 0.0, 900.0, 10.0))), None);
    let mut empty = det(0, 0, (0.0, 0.0, 10.0, 10.0));
    empty.frame_w = 0;
    assert_eq!(normalised_box(&empty), None);
}

#[test]
fn a_run_keeps_one_box_per_second_in_time_order_the_largest_first() {
    let run = [
        det(2, 0, (0.0, 0.0, 72.0, 128.0)),
        det(1, 0, (0.0, 0.0, 72.0, 128.0)),
        det(1, 0, (0.0, 0.0, 144.0, 256.0)),
    ];

    let boxes = run_boxes(&run);

    let times: Vec<f64> = boxes.iter().map(|b| b.t_s).collect();
    assert_eq!(times, [1.0, 2.0]);
    assert!(
        (boxes[0].w - 0.2).abs() < 1e-12,
        "the larger box of second 1"
    );
}

#[test]
fn each_run_of_one_sam_object_keeps_its_own_boxes() {
    // Object 0 jumps across the frame at second 3 (a cut): two runs, two tracks.
    let ds = [
        det(1, 0, (10.0, 10.0, 110.0, 130.0)),
        det(2, 0, (12.0, 10.0, 112.0, 130.0)),
        det(3, 0, (600.0, 1000.0, 700.0, 1120.0)),
        det(4, 0, (602.0, 1000.0, 702.0, 1120.0)),
    ];

    let runs = track_runs(&ds);

    assert_eq!(runs.len(), 2);
    let frames = |i: usize| -> Vec<f64> { run_boxes(&runs[i].1).iter().map(|b| b.t_s).collect() };
    assert_eq!((frames(0), frames(1)), (vec![1.0, 2.0], vec![3.0, 4.0]));
    assert_eq!((runs[0].0.ordinal, runs[1].0.ordinal), (0, 1));
}

#[test]
fn only_hidden_faces_in_the_shots_segments_are_blurred_and_only_when_on() {
    let shots = [
        SegmentId::parse("s2").unwrap(),
        SegmentId::parse("s1").unwrap(),
    ];
    let hidden = vec![
        hidden("s1", "t1", (5.0, 10.0), &[3.0, 4.0, 5.0, 9.0, 11.0, 12.0]),
        hidden("s2", "t2", (0.0, 5.0), &[1.0, 2.0]),
        hidden("s9", "t3", (20.0, 25.0), &[21.0]),
        hidden("s1", "t4", (5.0, 10.0), &[30.0]),
        HiddenBoxes {
            aspect: None,
            ..hidden("s2", "t5", (0.0, 5.0), &[1.0])
        },
    ];

    let got = blur_entries(&shots, hidden.clone(), true);

    let ids: Vec<&str> = got.iter().map(|b| b.segment_id.as_str()).collect();
    assert_eq!(
        ids,
        ["s2", "s1"],
        "first shot first; no other segment; no empty entry; no unknown size"
    );
    assert_eq!(got[0].aspect, 0.5625);
    let times: Vec<f64> = got[1].boxes.iter().map(|b| b.t_s).collect();
    assert_eq!(
        times,
        [4.0, 5.0, 9.0, 11.0],
        "within the segment plus a second each side"
    );
    assert!(blur_entries(&shots, hidden, false).is_empty(), "blur off");
}

#[test]
fn the_finish_defaults_to_the_productions_blur_choice_else_on() {
    assert!(finish_or_default(None, None).blur_bystanders);
    assert!(!finish_or_default(None, Some(false)).blur_bystanders);
    let stored = ShortFinish {
        blur_bystanders: false,
        title_text: None,
        speaker_colors: true,
        effect: Effect::Spotlight,
        keep_subject: true,
    };
    assert_eq!(finish_or_default(Some(stored.clone()), Some(true)), stored);
    assert_eq!(Effect::parse("blur_bg").unwrap(), Effect::BlurBg);
    assert_eq!(
        serde_json::to_string(&Effect::BlurBg).unwrap(),
        "\"blur_bg\""
    );
}

#[test]
fn a_finish_title_is_trimmed_and_capped() {
    let with = |t: &str| ShortFinish {
        blur_bystanders: true,
        title_text: Some(t.into()),
        speaker_colors: false,
        effect: Effect::None,
        keep_subject: true,
    };
    assert_eq!(
        checked_finish(with("  Hi ")).unwrap().title_text.as_deref(),
        Some("Hi")
    );
    assert_eq!(checked_finish(with("   ")).unwrap().title_text, None);
    assert!(checked_finish(with(&"x".repeat(81))).is_err());
}
