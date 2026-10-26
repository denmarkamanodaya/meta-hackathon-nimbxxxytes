//! SAM stream parsing on the recorded fixture, and the request wire format.

use std::time::Duration;

use nimbytes_core::ports::FaceTracker;
use serde_json::Value;

use super::*;
use crate::meta::fake_api::{client, fake_api};

const SSE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/sam/face_stream.sse"
));
const DELTAS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/sam/face_deltas.txt"
));

#[test]
fn the_recorded_stream_yields_one_face_in_frames_11_and_12() {
    let d = detections(SSE);
    assert_eq!(d.len(), 2);
    assert_eq!(
        (d[0].frame, d[0].ordinal, d[0].frame_w, d[0].frame_h),
        (11, 0, 480, 640)
    );
    assert_eq!(
        (d[0].bbox.x1, d[0].bbox.y1, d[0].bbox.x2, d[0].bbox.y2),
        (443.0, 200.0, 457.0, 217.0)
    );
    assert!((d[0].conf - 0.714).abs() < 0.001);
    assert_eq!((d[1].frame, d[1].bbox.x1), (12, 430.0));
    assert_eq!(frame_usage(SSE), Some(Usage::Frames(50)));
}

#[test]
fn any_split_of_the_delta_text_gives_the_same_detections() {
    let whole = {
        let mut p = DetectionParser::default();
        let mut v = p.push(DELTAS);
        v.extend(p.finish());
        v
    };
    assert_eq!(whole.len(), 2);
    let mut seed: u64 = 42;
    for _ in 0..200 {
        let mut p = DetectionParser::default();
        let mut got = Vec::new();
        let mut rest = DELTAS;
        while !rest.is_empty() {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let mut n = 1 + (seed >> 33) as usize % 40;
            while !rest.is_char_boundary(n.min(rest.len())) {
                n += 1;
            }
            let (chunk, tail) = rest.split_at(n.min(rest.len()));
            got.extend(p.push(chunk));
            rest = tail;
        }
        got.extend(p.finish());
        assert_eq!(got, whole, "seed {seed}");
    }
}

#[test]
fn several_objects_on_one_line_and_comma_separated_records_parse() {
    let line = "<3f>0<|box;x1=1;y1=2;x2=30;y2=40;w=480;h=640|><|mask;x=0;y=0;data=1,1,~a|b|>,1<|box;x1=5;y1=6;x2=50;y2=60;w=480;h=640;c=0.9|>\n";
    let d = DetectionParser::default().push(line);
    assert_eq!(
        d.iter().map(|x| (x.frame, x.ordinal)).collect::<Vec<_>>(),
        [(3, 0), (3, 1)]
    );
    assert_eq!(d[0].conf, 1.0, "no confidence means 1");
}

#[tokio::test]
async fn request_streams_the_face_concept_with_confidence_over_the_inline_video() {
    let (base, seen) = fake_api(vec![(200, SSE)]).await;
    let (c, _pool) = client(base).await;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("fps1.mp4"), b"\x00\x01\x02mp4").unwrap();

    let d = SamFaceTracker::new(c, Duration::from_secs(5))
        .track_faces(&dir.path().join("fps1.mp4"))
        .await
        .unwrap();

    assert_eq!(d.len(), 2);
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    assert_eq!(
        (body["model"].as_str(), body["stream"].as_bool()),
        (Some("sam-3.1"), Some(true))
    );
    assert_eq!(body["metadata"]["include_confidence"], "true");
    let content = &body["input"][0]["content"];
    assert_eq!(content[0]["text"], "face");
    assert_eq!(content[1]["video_url"], "data:video/mp4;base64,AAECbXA0");
}
