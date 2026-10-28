//! The subject tracker: prompt builders, the request body, and parsing the recorded spike
//! answers (point, box, plate concept, a 12 fps shot, one image).

use std::path::Path;
use std::time::Duration;

use nimbytes_core::domain::sam::Propagation;
use serde_json::Value;

use super::*;
use crate::meta::fake_api::{client, fake_api};

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/sam/",
            $name
        ))
    };
}

const POINT: &str = fixture!("s1_point.json");
const BOX: &str = fixture!("s1_box.json");
const PLATE: &str = fixture!("b1_plate.json");
const SHOT: &str = fixture!("s3_shot.json");
const IMAGE: &str = fixture!("s4_image.json");

fn answer(raw: &str) -> Vec<SamRecord> {
    records(&output_text(&json_body(raw).unwrap()))
}

#[test]
fn the_face_ingest_body_stays_byte_identical() {
    assert_eq!(
        body("data:x").to_string(),
        r#"{"model":"sam-3.1","stream":true,"metadata":{"include_confidence":"true"},"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"face"},{"type":"input_video","video_url":"data:x"}]}]}"#
    );
}

#[test]
fn prompt_builders_write_the_documented_tokens() {
    assert_eq!(concept(" license plate "), "license plate");
    assert_eq!(
        point(3, 1, (120, 300), (480, 640)),
        "<3f>1<|point;x=120;y=300;w=480;h=640|>"
    );
    assert_eq!(
        boxed(0, 1, (19, 207, 290, 367), (480, 640)),
        "<0f>1<|box;x1=19;y1=207;x2=290;y2=367;w=480;h=640|>"
    );
}

#[test]
fn a_point_answer_follows_one_id_with_one_bit_masks_height_first() {
    let r = answer(POINT);
    assert_eq!(r.len(), 5);
    assert!(r.iter().all(|x| x.id == 1));
    assert_eq!(
        r.iter().map(|x| x.frame).collect::<Vec<_>>(),
        [0, 1, 2, 3, 4]
    );
    let m = r[0].mask.as_ref().unwrap();
    assert_eq!(
        (m.encoding, m.height, m.width),
        (MaskEncoding::OneBit, 161, 272)
    );
    assert!(m.payload.starts_with("!!!!#aA]PRcv6x"), "{}", m.payload);
    assert!(
        m.payload.ends_with("iIT(x#"),
        "kept whole, up to the token end"
    );
    assert_eq!(
        (r[0].bbox.x1, r[0].bbox.y2, r[0].frame_w, r[0].frame_h),
        (19.0, 367.0, 480, 640)
    );
    assert_eq!(answer_usage(POINT), Some(Usage::Frames(50)));
    assert_eq!(answer(BOX).len(), 5);
}

#[test]
fn a_concept_answer_keeps_every_object_and_several_per_line() {
    let r = answer(PLATE);
    let mut ids: Vec<u32> = r.iter().map(|x| x.id).collect();
    ids.dedup();
    assert_eq!(ids, [0, 1, 2, 3, 2]);
    let twelve: Vec<&SamRecord> = r.iter().filter(|x| x.frame == 12).collect();
    assert_eq!(twelve.len(), 2, "two objects on one line");
    assert!(twelve.iter().all(|x| x.mask.is_some()));
    assert_eq!(
        twelve[1].mask.as_ref().map(|m| (m.height, m.width)),
        Some((9, 20))
    );
}

#[test]
fn a_12_fps_shot_and_an_image_parse_and_bill_their_own_unit() {
    let shot = answer(SHOT);
    assert!(shot.len() > 50, "{}", shot.len());
    assert_eq!(answer_usage(SHOT), Some(Usage::Frames(72)));
    let image = answer(IMAGE);
    assert_eq!(image.len(), 1);
    assert_eq!((image[0].frame_w, image[0].frame_h), (240, 426));
    assert_eq!(answer_usage(IMAGE), Some(Usage::SamImages(1)));
}

#[test]
fn records_parse_in_any_frame_order_and_lossless_masks_are_named() {
    let text = "<4f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10|><|mask;x=0;y=0;data=2,3,~ab|>\n<1f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=10|>";
    let r = records(text);
    assert_eq!(r.iter().map(|x| x.frame).collect::<Vec<_>>(), [4, 1]);
    let m = r[0].mask.as_ref().unwrap();
    assert_eq!(
        (m.encoding, m.height, m.width, m.payload.as_str()),
        (MaskEncoding::Lossless, 2, 3, "~ab")
    );
    assert!(r[1].mask.is_none());
}

async fn segment(request: SamRequest<'_>, reply: &str) -> (Vec<SamRecord>, Value) {
    let (base, seen) = fake_api(vec![(200, reply)]).await;
    let (c, _pool) = client(base).await;
    let tracker = SamSubjectTracker::new(c, Duration::from_secs(5));
    let got = tracker.segment(&request).await.unwrap();
    let body = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    (got, body)
}

#[tokio::test]
async fn a_point_request_sends_the_prompt_propagation_and_inline_video() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fps1.mp4");
    std::fs::write(&path, b"\x00\x01\x02mp4").unwrap();
    let request = SamRequest {
        media: SamMedia::Video(&path),
        prompt: SamPrompt::Point {
            frame: 3,
            id: 1,
            x: 120,
            y: 300,
            w: 480,
            h: 640,
        },
        propagation: Some(Propagation::Both),
        purpose: "find_object",
    };
    let (got, body) = segment(request, POINT).await;
    assert_eq!(got.len(), 5);
    assert_eq!(
        (body["model"].as_str(), body["stream"].as_bool()),
        (Some("sam-3.1"), Some(false))
    );
    assert_eq!(
        body["metadata"],
        serde_json::json!({"include_confidence": "true", "mask_encoding": "one_bit", "propagation_direction": "both"})
    );
    let content = &body["input"][0]["content"];
    assert_eq!(content[0]["text"], "<3f>1<|point;x=120;y=300;w=480;h=640|>");
    assert_eq!(content[1]["type"], "input_video");
    assert_eq!(content[1]["video_url"], "data:video/mp4;base64,AAECbXA0");
}

#[tokio::test]
async fn an_image_concept_sends_input_image_without_propagation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("frame.jpg");
    std::fs::write(&path, b"\xff\xd8jpg").unwrap();
    let request = SamRequest {
        media: SamMedia::Image(Path::new(&path)),
        prompt: SamPrompt::Concept("person".into()),
        propagation: None,
        purpose: "cutout",
    };
    let (got, body) = segment(request, IMAGE).await;
    assert_eq!(got.len(), 1);
    assert!(body["metadata"].get("propagation_direction").is_none());
    let content = &body["input"][0]["content"];
    assert_eq!(content[0]["text"], "person");
    assert_eq!(content[1]["type"], "input_image");
    assert_eq!(content[1]["image_url"], "data:image/jpeg;base64,/9hqcGc=");
}
