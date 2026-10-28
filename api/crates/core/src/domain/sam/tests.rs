use super::*;

fn rec(frame: u32, id: u32, (x1, y1, x2, y2): (f64, f64, f64, f64)) -> SamRecord {
    SamRecord {
        frame,
        id,
        bbox: BoxPx { x1, y1, x2, y2 },
        frame_w: 480,
        frame_h: 640,
        conf: 0.9,
        mask: None,
    }
}

#[test]
fn the_track_seen_in_most_frames_wins_then_the_larger_one() {
    let small_long = [0, 1, 2].map(|f| rec(f, 0, (0.0, 0.0, 10.0, 10.0)));
    let big_short = [0, 1].map(|f| rec(f, 1, (0.0, 0.0, 200.0, 200.0)));
    let all: Vec<SamRecord> = small_long.iter().chain(&big_short).cloned().collect();
    assert_eq!(pick_track(&all), Some(0), "frames first");

    let big_same = [0, 1, 2].map(|f| rec(f, 2, (0.0, 0.0, 50.0, 50.0)));
    let all: Vec<SamRecord> = small_long.iter().chain(&big_same).cloned().collect();
    assert_eq!(pick_track(&all), Some(2), "then mean area");

    let twin = [0, 1, 2].map(|f| rec(f, 5, (0.0, 0.0, 10.0, 10.0)));
    let all: Vec<SamRecord> = twin.iter().chain(&small_long).cloned().collect();
    assert_eq!(pick_track(&all), Some(0), "then the lower id");
    assert_eq!(pick_track(&[]), None);
}

#[test]
fn two_records_of_one_object_in_one_frame_count_one_frame() {
    let mut a: Vec<SamRecord> = [0, 0, 0].map(|f| rec(f, 0, (0.0, 0.0, 9.0, 9.0))).into();
    a.extend([0, 1].map(|f| rec(f, 1, (0.0, 0.0, 9.0, 9.0))));
    assert_eq!(pick_track(&a), Some(1));
}

#[test]
fn the_largest_record_is_found_by_box_area() {
    let a = [
        rec(0, 0, (0.0, 0.0, 10.0, 10.0)),
        rec(1, 0, (0.0, 0.0, 30.0, 5.0)),
        rec(2, 0, (0.0, 0.0, 10.0, 10.0)),
    ];
    assert_eq!(largest(&a).map(|r| r.frame), Some(1));
    assert!(largest(&[]).is_none());
    let two = [
        rec(0, 1, (0.0, 0.0, 1.0, 1.0)),
        rec(0, 2, (0.0, 0.0, 1.0, 1.0)),
    ];
    assert_eq!(of_object(&two, 2).len(), 1);
}

#[test]
fn range_proxy_frames_map_to_source_seconds() {
    assert!((frame_time(12.0, 24, 12) - 14.0).abs() < 1e-9);
    assert!((frame_time(12.0, 0, 12) - 12.0).abs() < 1e-9);
    assert!((frame_time(3.5, 5, 10) - 4.0).abs() < 1e-9);
}

#[test]
fn a_clip_second_maps_to_the_nearest_frame_of_a_copy() {
    assert_eq!(frame_at_time(4.4, 1), 4);
    assert_eq!(frame_at_time(4.5, 1), 5);
    assert_eq!(frame_at_time(-2.0, 1), 0);
    assert_eq!(frame_at_time(1.0, 12), 12);
}

#[test]
fn shares_map_to_pixels_inside_the_frame() {
    assert_eq!(to_px(0.5, 480), 240);
    assert_eq!(to_px(0.0, 480), 0);
    assert_eq!(to_px(1.0, 480), 479, "the right edge stays inside");
    assert_eq!(to_px(1.7, 480), 479);
    assert_eq!(to_px(-0.2, 640), 0);
    assert_eq!(to_px(0.999, 640), 639);
}

#[test]
fn masks_serialise_as_the_renderer_reads_them() {
    let m = MaskRef {
        encoding: MaskEncoding::OneBit,
        width: 35,
        height: 18,
        payload: "!!!!!:NV".into(),
    };
    assert_eq!(
        serde_json::to_string(&m).unwrap(),
        r#"{"encoding":"one_bit","width":35,"height":18,"payload":"!!!!!:NV"}"#
    );
}
