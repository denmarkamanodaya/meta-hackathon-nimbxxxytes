//! Edit plan wire format and answer handling against a local fake API.

use std::time::Duration;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::captions::SpokenTurn;
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::ports::Reasoner;

use super::*;
use crate::meta::fake_api::fake_api;
use crate::meta::reasoner::reasoner_tests::reasoner;

fn moment(id: &str, start_s: f64, speech: &[&str]) -> ShortSegment {
    ShortSegment {
        segment_id: SegmentId::parse(id).unwrap(),
        clip_id: ClipId::parse("c1").unwrap(),
        clip_ext: MediaExt::Mp4,
        span: Span {
            start_s,
            end_s: start_s + 6.5,
        },
        description: Some("Latte | pour\nclose up".into()),
        hook_score: Some(8),
        quality: None,
        turns: speech
            .iter()
            .map(|t| SpokenTurn {
                span: Span {
                    start_s,
                    end_s: start_s + 1.0,
                },
                text: (*t).to_owned(),
            })
            .collect(),
    }
}

/// A Responses API answer whose text is `timeline` JSON.
fn answer(timeline: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": timeline.to_string()}]}]})
    .to_string()
}

fn timeline(segment_id: &str) -> Value {
    json!({"aspect": "4:5", "target_seconds": 12, "clips": [{"segment_id": segment_id,
        "in": 1.0, "out": 4.5, "subject": "the latte pour", "punch_in": 1.0,
        "reason": "Strongest hook"}], "captions": {"style": "phrase", "source": "transcript"},
        "post": {"caption": "Slow mornings", "hashtags": ["#pov"]},
        "rationale": "Open on the pour.", "revision": null})
}

#[tokio::test]
async fn plan_sends_low_effort_the_moment_lines_and_a_segment_enum_then_parses_the_timeline() {
    let ok = answer(&timeline("c1-s0"));
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let moments = [
        moment("c1-s0", 0.0, &["okay latte", "art"]),
        moment("c1-s1", 7.0, &[]),
    ];
    let request = PlanRequest {
        prompt: " ",
        aspect: Aspect::Portrait,
        target_s: 12.0,
        segments: &moments,
        previous: None,
        rejection: None,
        allowed_ids: &[],
        tools: None,
    };

    let t = r.plan_edit(&request).await.unwrap();

    assert_eq!(t.clips[0].segment_id.as_str(), "c1-s0");
    assert_eq!((t.clips[0].in_s, t.clips[0].out_s), (1.0, 4.5));
    assert_eq!(t.revision, None);
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    assert_eq!(
        (
            body["store"].as_bool(),
            body["reasoning"]["effort"].as_str()
        ),
        (Some(false), Some("low"))
    );
    assert_eq!(body["text"]["format"]["name"], "timeline");
    let id_schema = &body["text"]["format"]["schema"]["properties"]["clips"]["items"]["properties"]
        ["segment_id"];
    assert_eq!(id_schema["enum"], json!(["c1-s0", "c1-s1"]));
    assert_moment_lines(body["input"][1]["content"][0]["text"].as_str().unwrap());
}

/// The user message lists both moments, cleaned, and says there is no earlier version.
fn assert_moment_lines(user: &str) {
    assert!(
        user.starts_with("Request: (none: make the best short"),
        "{user}"
    );
    assert!(user.contains("Target: 12 seconds, aspect 4:5."), "{user}");
    assert!(
        user.contains("c1-s0 | 0.0–6.5 | Latte   pour close up | 8 | - | okay latte art\n"),
        "{user}"
    );
    assert!(
        user.contains("c1-s1 | 7.0–13.5 | Latte   pour close up | 8 | - | -"),
        "{user}"
    );
    assert!(user.ends_with("(none)"), "{user}");
}

#[tokio::test]
async fn a_plan_naming_a_moment_that_was_not_offered_fails_validation() {
    let bad = answer(&timeline("ghost"));
    let (base, _seen) = fake_api(vec![(200, bad.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let moments = [moment("c1-s0", 0.0, &[])];
    let request = PlanRequest {
        prompt: "make it calm",
        aspect: Aspect::Square,
        target_s: 10.0,
        segments: &moments,
        previous: None,
        rejection: None,
        allowed_ids: &[],
        tools: None,
    };

    let err = r.plan_edit(&request).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        err.message.contains("plan_edit answer invalid"),
        "{}",
        err.message
    );
}

const PLAN_OK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/spark/plan_edit_low_response.json"
));

#[tokio::test]
async fn a_recorded_plan_answer_parses_into_a_timeline_over_the_offered_moments() {
    let (base, _seen) = fake_api(vec![(200, PLAN_OK)]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let ids = [
        "01a179c0-1f2b-72da-a041-dc704dee27dd-s1",
        "01a179c0-cf9a-7250-a79f-35280b4c2d58-s1",
        "01a179c0-cf9a-7250-a79f-35280b4c2d58-s0",
        "01a179c0-08c5-7096-8973-a2bd2506f979-s0",
    ];
    let moments: Vec<ShortSegment> = ids.iter().map(|id| moment(id, 0.0, &[])).collect();
    let request = PlanRequest {
        prompt: "A calm day out",
        aspect: Aspect::Portrait,
        target_s: 12.0,
        segments: &moments,
        previous: None,
        rejection: None,
        allowed_ids: &[],
        tools: None,
    };

    let t = r.plan_edit(&request).await.unwrap();

    let order: Vec<&str> = t.clips.iter().map(|c| c.segment_id.as_str()).collect();
    assert_eq!(order, [ids[0], ids[2], ids[1], ids[3]]);
    assert_eq!(
        (t.clips[0].in_s, t.clips[0].out_s, t.clips[0].punch_in),
        (7.5, 10.5, 1.2)
    );
    assert_eq!(t.post.hashtags.len(), 4);
    assert!(t.rationale.starts_with("Opens on kangaroo hook"));
}
