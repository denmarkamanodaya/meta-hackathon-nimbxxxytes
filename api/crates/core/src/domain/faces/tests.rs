use super::*;

/// A detection in a 480x640 frame (portrait 1 fps copy).
fn det(frame: u32, ordinal: u32, (x1, y1, x2, y2): (f64, f64, f64, f64), conf: f64) -> Detection {
    Detection {
        frame,
        ordinal,
        bbox: BoxPx { x1, y1, x2, y2 },
        frame_w: 480,
        frame_h: 640,
        conf,
    }
}

#[test]
fn small_or_unsure_boxes_and_one_frame_tracks_are_dropped() {
    // 1.5 % of the 640 long edge is 9.6 px; 24 px here is 48 px on the 1280 proxy.
    let ds = [
        det(1, 0, (100.0, 100.0, 124.0, 130.0), 0.71), // 24x30: kept
        det(2, 0, (100.0, 100.0, 124.0, 130.0), 0.71),
        det(1, 1, (10.0, 10.0, 19.0, 30.0), 0.9), // 9 px wide: dropped
        det(2, 1, (10.0, 10.0, 19.0, 30.0), 0.9),
        det(1, 2, (200.0, 200.0, 260.0, 270.0), 0.4), // low confidence: dropped
        det(2, 2, (200.0, 200.0, 260.0, 270.0), 0.4),
        det(5, 3, (300.0, 300.0, 340.0, 350.0), 0.9), // one frame only: dropped
    ];
    let t = tracks(&ds);
    assert_eq!(t.len(), 1);
    assert_eq!((t[0].ordinal, t[0].first_s, t[0].last_s), (0, 1.0, 2.0));
}

#[test]
fn best_frame_prefers_bigger_more_central_more_confident_boxes() {
    let ds = [
        det(1, 0, (0.0, 0.0, 40.0, 40.0), 0.9),       // corner
        det(2, 0, (220.0, 300.0, 260.0, 340.0), 0.9), // centre, same size
        det(3, 0, (215.0, 295.0, 265.0, 345.0), 0.5), // centre, bigger, unsure
    ];
    let t = tracks(&ds);
    assert_eq!(t[0].best.frame, 2);
    assert!(best_frame_score(&ds[1]) > best_frame_score(&ds[0]));
}

#[test]
fn crop_maps_1fps_coords_to_the_proxy_and_pads_20_percent_square() {
    // 480x640 → 720x1280: x scale 1.5, y scale 2.0.
    let d = det(1, 0, (200.0, 300.0, 240.0, 330.0), 0.9);
    let c = crop_rect(&d, 720, 1280);
    // Box on the proxy: x 300..360 (60 wide), y 600..660 (60 high); side 60 × 1.4 = 84.
    assert_eq!(
        c,
        CropRect {
            x: 288,
            y: 588,
            side: 84
        }
    );
}

#[test]
fn crops_near_the_edge_shift_inside_and_never_exceed_the_frame() {
    let corner = det(1, 0, (0.0, 0.0, 30.0, 30.0), 0.9);
    let c = crop_rect(&corner, 720, 1280);
    assert_eq!((c.x, c.y), (0, 0));
    let huge = det(1, 0, (0.0, 0.0, 480.0, 640.0), 0.9);
    let c = crop_rect(&huge, 720, 1280);
    assert!(
        c.side <= 720 && c.x + c.side <= 720 && c.y + c.side <= 1280,
        "{c:?}"
    );
}

#[test]
fn track_span_covers_its_last_second() {
    let t = &tracks(&[
        det(3, 0, (100.0, 100.0, 150.0, 150.0), 0.9),
        det(5, 0, (100.0, 100.0, 150.0, 150.0), 0.9),
    ])[0];
    assert_eq!(
        t.span(),
        Span {
            start_s: 3.0,
            end_s: 6.0
        }
    );
}

#[test]
fn a_face_too_small_to_crop_from_the_proxy_is_dropped() {
    // The street face: 14x17 at 640 is 28 px on the 1280 proxy, under the 48 px minimum.
    let street = [
        det(1, 0, (100.0, 100.0, 114.0, 117.0), 0.71),
        det(2, 0, (100.0, 100.0, 114.0, 117.0), 0.71),
    ];
    assert_eq!(proxy_short_side(&street[0]), 28.0);
    assert!(tracks(&street).is_empty());
    let edge = [
        det(1, 4, (100.0, 100.0, 124.0, 124.0), 0.9), // exactly 48 px on the proxy: kept
        det(2, 4, (100.0, 100.0, 124.0, 124.0), 0.9),
    ];
    assert_eq!(tracks(&edge).len(), 1);
}
