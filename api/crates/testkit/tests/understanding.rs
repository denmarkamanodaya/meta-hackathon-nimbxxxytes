//! Describe, faces, embed and index steps against fakes.

#![cfg(test)]

use nimbytes_core::domain::faces::{BoxPx, Detection};
use nimbytes_core::domain::facts::FactsStatus;
use nimbytes_core::domain::ids::SegmentId;
use nimbytes_core::ports::FactsAttempt;
use nimbytes_testkit::world::{CLIP, IngestWorld, clip, facts, probe, said};

fn seg(i: u32) -> SegmentId {
    SegmentId::parse(format!("{CLIP}-s{i}")).unwrap()
}

/// 21.5 s with a cut at 8 s: segments [0,8), [8,14.75), [14.75,21.5); one turn 5.82–13.98.
async fn world() -> IngestWorld {
    let w = IngestWorld::new(probe(21.5, true), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();
    w.transcriber
        .returns(vec![said(5_820, 13_980, "with food.")]);
    w
}

fn invalid(text: &str, error: &str) -> FactsAttempt {
    FactsAttempt::Invalid {
        text: text.into(),
        error: error.into(),
    }
}

#[tokio::test]
async fn describe_sends_our_times_context_and_snippet_for_every_segment() {
    let w = world().await;

    w.run_once().await.unwrap();

    let calls = w.describer.calls();
    assert_eq!(calls.len(), 1, "all answers valid: no retry");
    let p = &calls[0];
    assert_eq!(p.len(), 3);
    assert_eq!((p[1].start_s, p[1].end_s), (8.0, 14.75));
    assert_eq!(
        (p[0].transcript.as_str(), p[1].transcript.as_str()),
        ("with food.", "with food.")
    );
    assert_eq!(p[2].transcript, "(none)");
    assert_eq!(p[0].recorded_at, "2026-01-28T05:59:00.000Z");
    assert!(p[0].snippet.ends_with("snippet_0.mp4"));
    assert!(p.iter().all(|x| x.previous_error.is_none()));
}

#[tokio::test]
async fn only_invalid_answers_are_retried_once_with_their_error_then_fall_back() {
    let w = world().await;
    w.describer.then(vec![
        FactsAttempt::Valid(facts("first")),
        invalid("garbled", "quality: 11 is greater than 10"),
        invalid("{}", "missing description"),
    ]);
    w.describer.then(vec![
        FactsAttempt::Valid(facts("second, fixed")),
        invalid("A busy street at dusk", "x"),
    ]);

    w.run_once().await.unwrap();

    let retry = &w.describer.calls()[1];
    assert_eq!(retry.len(), 2);
    assert_eq!(
        retry[0].previous_error.as_deref(),
        Some("quality: 11 is greater than 10")
    );
    assert_eq!((retry[0].start_s, retry[1].start_s), (8.0, 14.75));
    let stored: Vec<_> = (0..3)
        .map(|i| w.catalogue.facts(&seg(i)).unwrap())
        .collect();
    assert_eq!(stored[0].description, "first");
    assert_eq!(
        (stored[1].description.as_str(), stored[1].status),
        ("second, fixed", FactsStatus::Ok)
    );
    assert_eq!(
        (stored[2].description.as_str(), stored[2].status),
        ("A busy street at dusk", FactsStatus::Fallback)
    );
    assert!(stored[2].objects.is_empty());
}

fn face(frame: u32, ordinal: u32, x: f64) -> Detection {
    let bbox = BoxPx {
        x1: x,
        y1: 300.0,
        x2: x + 80.0,
        y2: 390.0,
    };
    Detection {
        frame,
        ordinal,
        bbox,
        frame_w: 720,
        frame_h: 1280,
        conf: 0.8,
    }
}

#[tokio::test]
async fn faces_crop_each_kept_track_and_link_it_to_the_segments_it_appears_in() {
    let w = world().await;
    w.tracker.returns(vec![
        face(9, 0, 340.0),
        face(10, 0, 300.0),
        face(12, 0, 300.0),
        face(3, 1, 10.0),
    ]);

    w.run_once().await.unwrap();

    let crops: Vec<String> = w
        .media
        .calls()
        .into_iter()
        .filter(|c| c.starts_with("crop"))
        .collect();
    assert_eq!(crops, ["crop@12 277x282+125 proxy_720p.mp4 -> face_0.jpg"]);
    assert!(
        w.blobs
            .puts()
            .iter()
            .any(|(k, mime)| k == "users/u1/faces/c1/c1-f0.jpg" && mime == "image/jpeg")
    );
    let stored = w
        .catalogue
        .face_tracks(&nimbytes_core::domain::ids::ClipId::parse(CLIP).unwrap())
        .unwrap();
    assert_eq!(stored.rows.len(), 1, "the one-frame track is dropped");
    let t = &stored.rows[0];
    assert_eq!((t.id.as_str(), t.first_s, t.last_s), ("c1-f0", 9.0, 12.0));
    assert_eq!(t.crop_key, "users/u1/faces/c1/c1-f0.jpg");
    let linked: Vec<&str> = stored.links.iter().map(|(_, s)| s.as_str()).collect();
    assert_eq!(linked, ["c1-s1"], "seen 9–13 s: only [8, 14.75)");
}

#[tokio::test]
async fn faces_store_each_kept_tracks_boxes_as_shares_of_the_frame() {
    let w = world().await;
    w.tracker.returns(vec![
        face(10, 0, 300.0),
        face(9, 0, 340.0),
        face(12, 0, 300.0),
        face(3, 1, 10.0),
    ]);

    w.run_once().await.unwrap();

    let boxes = w.privacy.boxes.lock().unwrap();
    let clip = boxes
        .get(&nimbytes_core::domain::ids::ClipId::parse(CLIP).unwrap())
        .unwrap();
    assert_eq!(clip.len(), 1, "only the kept track");
    assert_eq!(clip[0].0.as_str(), "c1-f0");
    let times: Vec<f64> = clip[0].1.iter().map(|b| b.t_s).collect();
    assert_eq!(times, [9.0, 10.0, 12.0], "one per second, in time order");
    let b = clip[0].1[1];
    assert!((b.x - 300.0 / 720.0).abs() < 1e-9, "{b:?}");
    assert!(b.w > 0.0 && b.x + b.w <= 1.0 && b.y + b.h <= 1.0, "{b:?}");
}

#[tokio::test]
async fn embed_stores_one_vector_per_segment_for_the_clip_owner() {
    let w = world().await;

    w.run_once().await.unwrap();

    let rows = w.vectors.rows();
    let segs: Vec<&str> = rows.iter().map(|(s, _, _)| s.as_str()).collect();
    assert_eq!(segs, ["c1-s0", "c1-s1", "c1-s2"]);
    assert!(
        rows.iter()
            .all(|(_, u, v)| u.as_str() == "u1" && !v.is_empty())
    );
}

#[tokio::test]
async fn index_stores_a_document_per_segment_with_facts_and_speech() {
    let w = world().await;

    w.run_once().await.unwrap();

    let docs = w.text_index.docs();
    assert_eq!(docs.len(), 3);
    assert_eq!(docs[0].segment_id, seg(0));
    assert_eq!(docs[0].description, "a described moment");
    assert_eq!(docs[0].transcript, "with food.");
    assert_eq!(docs[2].transcript, "");
    assert_eq!(docs[0].user_id.as_str(), "u1");
}
