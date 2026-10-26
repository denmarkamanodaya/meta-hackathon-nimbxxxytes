//! Critique wire format and answer handling against a local fake API.

use std::time::Duration;

use nimbytes_core::domain::critique::Verdict;
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::short::ShortSegment;
use nimbytes_core::domain::timeline::Timeline;
use nimbytes_core::ports::Reasoner;

use super::*;
use crate::meta::fake_api::fake_api;
use crate::meta::reasoner::reasoner_tests::reasoner;

fn moment() -> ShortSegment {
    ShortSegment {
        segment_id: SegmentId::parse("c1-s0").unwrap(),
        clip_id: ClipId::parse("c1").unwrap(),
        clip_ext: MediaExt::Mp4,
        span: Span {
            start_s: 0.0,
            end_s: 7.0,
        },
        description: Some("A latte".into()),
        hook_score: Some(8),
        quality: Some(6),
        turns: vec![],
    }
}

fn timeline() -> Timeline {
    serde_json::from_value(json!({"aspect": "4:5", "target_seconds": 15, "clips": [
        {"segment_id": "c1-s0", "in": 1.0, "out": 4.0}],
        "captions": {"style": "phrase", "source": "transcript"},
        "post": {"caption": "c", "hashtags": []}, "rationale": "r"}))
    .unwrap()
}

fn answer(critique: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": critique.to_string()}]}]})
    .to_string()
}

/// Version, target, request, the timeline JSON as is, and the moment lines.
fn assert_user_text(user: &str) {
    assert!(
        user.starts_with("Version 2 of the draft. Target: 15 seconds."),
        "{user}"
    );
    assert!(
        user.contains("Owner's request: start with the coffee"),
        "{user}"
    );
    assert!(
        user.contains(r#""clips":[{"segment_id":"c1-s0","in":1.0,"out":4.0,"#),
        "timeline JSON kept as is: {user}"
    );
    assert!(
        user.ends_with("c1-s0 | 0.0–7.0 | A latte | 8 | 6 | -"),
        "{user}"
    );
}

#[tokio::test]
async fn critique_sends_the_preview_inline_with_the_timeline_and_settles_the_total() {
    // The model says total 40 and version 7; the sum is 35 and the version reviewed is 2.
    let reply = answer(&json!({"version": 7, "scores": {"hook": 6, "pacing": 5,
        "continuity": 7, "captions": 8, "length": 9}, "total": 40,
        "notes": [{"at": 2.4, "issue": "Second shot repeats the first angle",
        "fix": "Swap c1-s0 for c1-s1"}], "verdict": "revise"}));
    let (base, seen) = fake_api(vec![(200, reply.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v2.mp4");
    std::fs::write(&video, b"mp4-bytes").unwrap();
    let moments = [moment()];
    let request = CritiqueRequest {
        video: &video,
        version: 2,
        prompt: "start with the coffee",
        target_s: 15.0,
        timeline: &timeline(),
        segments: &moments,
    };

    let c = r.critique(&request).await.unwrap();

    assert_eq!((c.version, c.total, c.verdict), (2, 35, Verdict::Revise));
    assert_eq!(c.notes[0].at, 2.4);
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    assert_eq!(
        (
            body["store"].as_bool(),
            body["reasoning"]["effort"].as_str()
        ),
        (Some(false), Some("low"))
    );
    assert_eq!(body["text"]["format"]["name"], "critique");
    let parts = &body["input"][1]["content"];
    assert_eq!(parts[1]["type"], "input_video");
    assert_eq!(parts[1]["video_url"], "data:video/mp4;base64,bXA0LWJ5dGVz");
    assert_user_text(parts[0]["text"].as_str().unwrap());
}

#[tokio::test]
async fn a_critique_with_an_unknown_verdict_fails_validation() {
    let reply = answer(&json!({"version": 1, "scores": {"hook": 6, "pacing": 5,
        "continuity": 7, "captions": 8, "length": 9}, "total": 35, "notes": [],
        "verdict": "maybe"}));
    let (base, _seen) = fake_api(vec![(200, reply.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v1.mp4");
    std::fs::write(&video, b"x").unwrap();
    let moments = [moment()];
    let request = CritiqueRequest {
        video: &video,
        version: 1,
        prompt: "",
        target_s: 10.0,
        timeline: &timeline(),
        segments: &moments,
    };

    let err = r.critique(&request).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        err.message.contains("critique answer invalid"),
        "{}",
        err.message
    );
}
