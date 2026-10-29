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
        documents: vec![
            AskDocument {
                id: nimbytes_core::domain::ids::DocumentId::parse("d1").unwrap(),
                title: "Water | bill".into(),
                kind: nimbytes_core::domain::document::DocKind::Bill,
                sender: "City Water".into(),
                date: "1 October 2026".into(),
                added: true,
            },
            AskDocument {
                id: nimbytes_core::domain::ids::DocumentId::parse("d2").unwrap(),
                title: String::new(),
                kind: nimbytes_core::domain::document::DocKind::Other,
                sender: String::new(),
                date: String::new(),
                added: false,
            },
        ],
    }
}

fn short_answer() -> Value {
    json!({
        "kind": "make_short", "title": "Beach sunsets", "query": null, "source": "attached",
        "project_id": null, "new_project_name": null, "clip_ids": ["c1", "c2"],
        "target_s": 30, "aspect": null,
        "choices": [], "document_ids": [], "question": null
    })
}

/// The user message [`request`] fills: projects, added clips, library size, the caller's
/// documents (the added one marked, an unread one shown as being read) and the request.
fn user_text() -> &'static str {
    "Projects:\np1 | TJ   Concert | 7 clips\n\n\
     Added clips:\nc1 | Beach sunset | 12.3 s\nc2 | IMG_0002.MOV | unknown length\n\n\
     Clips in the library: 42\n\n\
     Documents:\nd1 | Water   bill | bill | City Water | 1 October 2026 | added\n\
     d2 | (being read) | other | - | - | listed\n\n\
     Request: make a 30 second short of {these} | now"
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
    assert_eq!(format["schema"]["required"].as_array().unwrap().len(), 12);
    assert!(format["schema"].get("$schema").is_none());
    assert_eq!(body["input"][1]["content"][0]["text"], user_text());
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(system.starts_with("You read one request"), "{system}");
}

#[tokio::test]
async fn a_project_short_answer_keeps_its_topic_and_the_schema_says_so() {
    let mut project_short = short_answer();
    project_short["source"] = json!("project");
    project_short["project_id"] = json!("p1");
    project_short["query"] = json!("sunsets");
    project_short["clip_ids"] = json!([]);
    let ok = answer(&project_short);
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let draft = r.read_intent(&request()).await.unwrap();

    assert_eq!(draft.query.as_deref(), Some("sunsets"));
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    let query = &body["text"]["format"]["schema"]["properties"]["query"];
    assert_eq!(query["type"], json!(["string", "null"]));
    let said = query["description"].as_str().unwrap();
    assert!(said.contains("topic within it"), "{said}");
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
        "aspect": null, "document_ids": [], "question": null,
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

#[tokio::test]
async fn a_read_document_answer_keeps_its_document_and_question() {
    let mut read = short_answer();
    read["kind"] = json!("read_document");
    read["clip_ids"] = json!([]);
    read["source"] = json!(null);
    read["document_ids"] = json!(["d1"]);
    read["question"] = json!("When is it due?");
    let ok = answer(&read);
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let r = reasoner(base, Duration::from_secs(10)).await;

    let draft = r.read_intent(&request()).await.unwrap();

    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    let kinds = &body["text"]["format"]["schema"]["properties"]["kind"]["enum"];
    assert!(kinds.as_array().unwrap().contains(&json!("read_document")));
    assert_eq!(draft.kind, "read_document");
    assert_eq!(draft.document_ids, ["d1"]);
    assert_eq!(draft.question.as_deref(), Some("When is it due?"));
}
