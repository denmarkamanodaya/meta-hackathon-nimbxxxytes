//! Ask-box intent wire format and answer handling against a local fake API.

use std::time::Duration;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::{ClipId, ProjectId};
use serde_json::{Value, json};

use super::*;
use crate::meta::fake_api::fake_api;
use crate::meta::reasoner::reasoner_tests::reasoner;

fn answer(v: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": v.to_string()}]}]})
    .to_string()
}

fn request() -> IntentRequest {
    IntentRequest {
        text: "make a 30 second short of {these} | now".into(),
        projects: vec![AskProject {
            id: ProjectId::parse("p1").unwrap(),
            name: "TJ | Concert".into(),
            clip_count: 7,
        }],
        clips: vec![
            AskClip {
                id: ClipId::parse("c1").unwrap(),
                title: "Beach\nsunset".into(),
                duration_s: Some(12.345),
            },
            AskClip {
                id: ClipId::parse("c2").unwrap(),
                title: "IMG_0002.MOV".into(),
                duration_s: None,
            },
        ],
        library_clips: 42,
    }
}

fn short_answer() -> Value {
    json!({
        "kind": "make_short", "title": "Beach sunsets", "query": null, "source": "attached",
        "project_id": null, "new_project_name": null, "clip_ids": ["c1", "c2"],
        "target_s": 30, "aspect": null,
        "choices": []
    })
}

#[tokio::test]
async fn the_intent_call_sends_the_request_and_its_context_with_store_false_and_a_strict_schema() {
    let ok = answer(&short_answer());
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let draft = r.read_intent(&request()).await.unwrap();

    assert_eq!(draft.kind, "make_short");
    assert_eq!(draft.source.as_deref(), Some("attached"));
    assert_eq!(draft.clip_ids, ["c1", "c2"]);
    assert_eq!(draft.target_s, Some(30.0));
    assert_eq!(draft.aspect, None);
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    assert_eq!(
        (
            body["model"].as_str(),
            body["store"].as_bool(),
            body["reasoning"]["effort"].as_str()
        ),
        (Some("muse-spark-1.3"), Some(false), Some("minimal"))
    );
    let format = &body["text"]["format"];
    assert_eq!(
        (
            format["type"].as_str(),
            format["name"].as_str(),
            format["strict"].as_bool()
        ),
        (Some("json_schema"), Some("intent"), Some(true))
    );
    assert_eq!(format["schema"]["additionalProperties"], false);
    assert_eq!(format["schema"]["required"].as_array().unwrap().len(), 10);
    assert!(format["schema"].get("$schema").is_none());
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert_eq!(
        user,
        "Projects:\np1 | TJ   Concert | 7 clips\n\n\
         Added clips:\nc1 | Beach sunset | 12.3 s\nc2 | IMG_0002.MOV | unknown length\n\n\
         Clips in the library: 42\n\n\
         Request: make a 30 second short of {these} | now"
    );
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(system.starts_with("You read one request"), "{system}");
}

#[tokio::test]
async fn empty_projects_and_clips_are_sent_as_none() {
    let ok = answer(&short_answer());
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;
    let mut req = request();
    req.projects.clear();
    req.clips.clear();

    r.read_intent(&req).await.unwrap();

    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert!(
        user.starts_with("Projects:\n(none)\n\nAdded clips:\n(none)\n"),
        "{user}"
    );
}

#[tokio::test]
async fn an_unclear_answer_keeps_its_choices() {
    let ok = answer(&json!({
        "kind": "unclear", "title": "Birthday", "query": null, "source": null,
        "project_id": null, "new_project_name": null, "clip_ids": [], "target_s": null,
        "aspect": null,
        "choices": [{"label": "Search for birthday", "text": "search for the 60th birthday"}]
    }));
    let (base, _seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let draft = r.read_intent(&request()).await.unwrap();

    assert_eq!(draft.kind, "unclear");
    assert_eq!(
        draft.choices,
        [Choice {
            label: "Search for birthday".into(),
            text: "search for the 60th birthday".into()
        }]
    );
}

#[tokio::test]
async fn an_answer_outside_the_schema_is_model_unavailable() {
    let mut bad = short_answer();
    bad["kind"] = json!("delete_everything");
    let ok = answer(&bad);
    let (base, _seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let err = r.read_intent(&request()).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        err.message.contains("intent answer invalid"),
        "{}",
        err.message
    );
}
