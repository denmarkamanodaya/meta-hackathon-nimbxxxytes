//! The planner's tool rounds on the wire: tools offered, calls answered with the whole exchange
//! sent back, a final round without tools, and bad calls answered with an error.

use std::sync::Mutex;
use std::time::Duration;

use nimbytes_core::domain::ids::SegmentId;
use nimbytes_core::domain::short::MomentCard;
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::ports::{BoxFuture, Reasoner};

use super::*;
use crate::meta::fake_api::fake_api;
use crate::meta::reasoner::reasoner_tests::reasoner;

/// Answers every lookup with moment `s2` and records the calls.
#[derive(Default)]
struct OneMoment {
    calls: Mutex<Vec<PlannerToolCall>>,
}

impl PlannerTools for OneMoment {
    fn call<'a>(&'a self, call: PlannerToolCall) -> BoxFuture<'a, Result<Vec<MomentCard>, String>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(call);
            Ok(vec![MomentCard {
                segment_id: SegmentId::parse("s2").unwrap(),
                start_s: 20.0,
                end_s: 28.0,
                description: Some("A sunset".into()),
                hook: Some(9),
                quality: Some(8),
                speech: String::new(),
                reason: None,
            }])
        })
    }
}

/// A response that calls `name` with `args`.
fn calls(name: &str, args: &str) -> String {
    json!({"output": [
        {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "opaque"},
        {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": name,
         "arguments": args, "status": "completed"}
    ]})
    .to_string()
}

fn timeline_answer() -> String {
    let t = json!({"aspect": "4:5", "target_seconds": 12, "clips": [{"segment_id": "s2",
        "in": 21.0, "out": 24.0, "subject": null, "punch_in": 1.0, "reason": "Golden light"}],
        "captions": {"style": "none", "source": "transcript"},
        "post": {"caption": "Sunset", "hashtags": []}, "rationale": "Ends on the sunset.",
        "revision": null});
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": t.to_string()}]}]})
    .to_string()
}

fn ids(raw: &[&str]) -> Vec<SegmentId> {
    raw.iter().map(|i| SegmentId::parse(*i).unwrap()).collect()
}

/// Round 1 offers both tools and the allowed ids; round 2 sends the reasoning item, the call and
/// its output back.
fn assert_exchange(seen: &[crate::meta::fake_api::Seen]) {
    let first: Value = serde_json::from_slice(&seen[0].body).unwrap();
    let names: Vec<&str> = first["tools"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert_eq!(names, ["search_moments", "get_segment"]);
    let id_enum = &first["text"]["format"]["schema"]["properties"]["clips"]["items"]["properties"]
        ["segment_id"]["enum"];
    assert_eq!(*id_enum, json!(["s0", "s2"]));
    let second: Value = serde_json::from_slice(&seen[1].body).unwrap();
    let input = second["input"].as_array().unwrap();
    assert_eq!(input.len(), 5, "system, user, reasoning, call, output");
    assert_eq!(
        (input[2]["type"].as_str(), input[3]["type"].as_str()),
        (Some("reasoning"), Some("function_call"))
    );
    assert_eq!(input[4]["type"], "function_call_output");
    assert_eq!(input[4]["call_id"], "call_1");
    let output: Value = serde_json::from_str(input[4]["output"].as_str().unwrap()).unwrap();
    assert_eq!(output["moments"][0]["segment_id"], "s2");
    assert_eq!(output["moments"][0]["hook"], 9);
}

#[tokio::test]
async fn a_tool_call_is_answered_and_the_exchange_is_sent_back_before_the_answer() {
    let (call, done) = (
        calls("get_segment", r#"{"segment_id":"s2"}"#),
        timeline_answer(),
    );
    let (base, seen) = fake_api(vec![(200, call.as_str()), (200, done.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let tools = OneMoment::default();
    let allowed = ids(&["s0", "s2"]);
    let request = PlanRequest {
        prompt: "end on a sunset",
        aspect: Aspect::Portrait,
        target_s: 12.0,
        segments: &[],
        previous: None,
        rejection: None,
        allowed_ids: &allowed,
        tools: Some(&tools),
    };

    let t = r.plan_edit(&request).await.unwrap();

    assert_eq!(t.clips[0].segment_id.as_str(), "s2");
    let asked = tools.calls.lock().unwrap().clone();
    let s2 = PlannerToolCall::GetSegment {
        segment_id: "s2".into(),
    };
    assert_eq!(asked, [s2]);
    assert_exchange(&seen.lock().unwrap());
}

#[tokio::test]
async fn the_last_round_offers_no_tools_so_the_model_must_answer() {
    let call = calls("search_moments", r#"{"query":"sunset"}"#);
    let (base, seen) = fake_api(vec![(200, call.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let tools = OneMoment::default();
    let request = PlanRequest {
        prompt: "",
        aspect: Aspect::Square,
        target_s: 10.0,
        segments: &[],
        previous: None,
        rejection: None,
        allowed_ids: &ids(&["s2"]),
        tools: Some(&tools),
    };

    let err = r.plan_edit(&request).await.unwrap_err();

    assert!(
        err.message.contains("plan_edit answer invalid"),
        "{}",
        err.message
    );
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), usize::try_from(MAX_TOOL_TURNS).unwrap());
    let last: Value = serde_json::from_slice(&seen[seen.len() - 1].body).unwrap();
    assert!(last.get("tools").is_none(), "no tools on the last round");
    assert_eq!(tools.calls.lock().unwrap().len(), 3);
}

#[test]
fn unknown_tools_and_bad_arguments_become_errors_for_the_model() {
    let search = parse_tool_call("search_moments", r#"{"query":" dog "}"#);
    assert_eq!(
        search,
        Ok(PlannerToolCall::SearchMoments {
            query: "dog".into()
        })
    );
    assert_eq!(
        parse_tool_call("delete_all", "{}"),
        Err("unknown tool delete_all; use search_moments or get_segment".into())
    );
    assert_eq!(
        parse_tool_call("get_segment", r#"{"segment_id":""}"#),
        Err("get_segment: segment_id is required".into())
    );
    assert_eq!(
        parse_tool_call("search_moments", "not json"),
        Err("search_moments: arguments are not JSON".into())
    );
}
