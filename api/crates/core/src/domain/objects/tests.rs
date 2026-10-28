use super::*;
use crate::domain::faces::BoxPx;

fn rec(frame: u32, id: u32, conf: f64, (x1, y1, x2, y2): (f64, f64, f64, f64)) -> SamRecord {
    SamRecord {
        frame,
        id,
        bbox: BoxPx { x1, y1, x2, y2 },
        frame_w: 480,
        frame_h: 640,
        conf,
        mask: None,
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn screens_and_plates_become_padded_blur_entries_in_clip_seconds() {
    let seg = SegmentId::parse("seg").unwrap();
    let records = [
        rec(5, 1, 0.9, (100.0, 100.0, 200.0, 140.0)),
        rec(0, 1, 0.9, (100.0, 100.0, 200.0, 140.0)),
        rec(3, 2, 0.3, (0.0, 0.0, 10.0, 10.0)),
        rec(4, 3, 0.8, (470.0, 630.0, 479.0, 639.0)),
    ];
    let blur = object_blur(&seg, 20.0, &records);
    assert_eq!(blur.len(), 2, "the weak object is dropped");
    let plate = &blur[0];
    assert!(close(plate.aspect, 0.75));
    assert_eq!(plate.boxes.len(), 2);
    assert!(close(plate.boxes[0].t_s, 20.0) && close(plate.boxes[1].t_s, 20.5));
    let b = plate.boxes[0];
    assert!(
        close(b.x, 85.0 / 480.0) && close(b.w, 130.0 / 480.0),
        "{b:?}"
    );
    assert!(
        close(b.y, 94.0 / 640.0) && close(b.h, 52.0 / 640.0),
        "{b:?}"
    );
    let edge = blur[1].boxes[0];
    assert!(edge.x + edge.w <= 1.0 + 1e-12 && edge.y + edge.h <= 1.0 + 1e-12);
    assert!(object_blur(&seg, 0.0, &[]).is_empty());
}

#[test]
fn the_fallback_crop_is_a_quarter_of_the_short_side_around_the_tap_inside_the_frame() {
    assert_eq!(
        fallback_crop((0.5, 0.5), (480, 640)),
        PixelRect {
            x: 180,
            y: 260,
            w: 120,
            h: 120
        }
    );
    assert_eq!(
        fallback_crop((0.0, 1.0), (480, 640)),
        PixelRect {
            x: 0,
            y: 520,
            w: 120,
            h: 120
        }
    );
    assert_eq!(fallback_crop((1.0, 0.0), (480, 640)).x, 360);
}

#[test]
fn boxes_become_pixel_rects_and_scale_to_another_size() {
    let r = rec(0, 0, 1.0, (19.0, 207.0, 290.0, 367.0));
    let rect = box_rect(&r);
    assert_eq!(
        rect,
        PixelRect {
            x: 19,
            y: 207,
            w: 272,
            h: 161
        }
    );
    let big = scale_rect(rect, (480, 640), (960, 1280));
    assert_eq!(
        big,
        PixelRect {
            x: 38,
            y: 414,
            w: 544,
            h: 322
        }
    );
    let edge = scale_rect(
        PixelRect {
            x: 479,
            y: 0,
            w: 5,
            h: 5,
        },
        (480, 640),
        (240, 320),
    );
    assert!(edge.x + edge.w <= 240 && edge.w >= 1);
}

#[test]
fn the_tapped_object_is_in_view_from_its_first_to_its_last_second() {
    let track = [
        rec(7, 1, 1.0, (0.0, 0.0, 1.0, 1.0)),
        rec(4, 1, 1.0, (0.0, 0.0, 1.0, 1.0)),
    ];
    assert_eq!(
        in_view(&track, 1),
        Some(Span {
            start_s: 4.0,
            end_s: 8.0
        })
    );
    assert_eq!(in_view(&[], 1), None);
}

fn m(clip: &str, score: f64, start: f64) -> FindMatch {
    FindMatch {
        clip_id: ClipId::parse(clip).unwrap(),
        segment_id: None,
        span: Span {
            start_s: start,
            end_s: start + 2.0,
        },
        score,
    }
}

#[test]
fn hits_group_by_clip_best_first_with_the_tapped_clip_on_top() {
    let this = ClipId::parse("c0").unwrap();
    let view = Span {
        start_s: 3.0,
        end_s: 9.0,
    };
    let hits = group_hits(
        (&this, Some(view)),
        vec![
            m("c1", 0.5, 1.0),
            m("c2", 0.9, 4.0),
            m("c1", 0.8, 6.0),
            m("c0", 0.4, 0.0),
        ],
    );
    let order: Vec<&str> = hits.iter().map(|h| h.clip_id.as_str()).collect();
    assert_eq!(order, ["c0", "c2", "c1"]);
    assert_eq!(
        hits[0].span, view,
        "the tapped clip shows its in-view range"
    );
    assert!(close(hits[2].span.start_s, 6.0) && close(hits[2].score, 0.8));

    let none = group_hits((&this, Some(view)), vec![m("c1", 0.5, 1.0)]);
    assert_eq!(none[0].clip_id, this, "added even without a vector match");
    let many: Vec<FindMatch> = (0..20).map(|i| m(&format!("k{i}"), 0.5, 0.0)).collect();
    assert_eq!(group_hits((&this, None), many).len(), MAX_FIND_HITS);
}

#[test]
fn weak_matches_in_other_clips_are_left_out_but_the_tapped_clip_stays() {
    let this = ClipId::parse("c0").unwrap();
    let hits = group_hits(
        (&this, None),
        vec![
            m("c0", 0.3, 0.0),
            m("c1", 0.82, 1.0),
            m("c2", 0.46, 4.0),
            m("c3", 0.5, 2.0),
        ],
    );
    let order: Vec<&str> = hits.iter().map(|h| h.clip_id.as_str()).collect();
    assert_eq!(
        order,
        ["c0", "c1", "c3"],
        "c2 at 0.46 is an unrelated scene"
    );
}

#[test]
fn labels_are_one_to_three_lowercase_words() {
    assert_eq!(clean_label("  Red Coffee MUG cup "), "red coffee mug");
    assert_eq!(clean_label("\"Dog.\""), "dog");
    assert_eq!(clean_label("  "), "thing");
}
