//! Ask-box handlers over fakes: status codes, the exact wire shape (every key present), the raised
//! body limit on the voice route only, and `FORBIDDEN` on another user's clip.

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::{ClipId, UserId};
use nimbytes_core::domain::intent::{Choice, IntentDraft};
use nimbytes_core::domain::voice::MAX_AUDIO_BYTES;
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::world::{clip, probe, said};
use serde_json::{Value, json};

use super::test_support::{TestApp, post_json};

fn audio(cookie: Option<&str>, content_type: Option<&str>, bytes: Vec<u8>) -> Request<Body> {
    let mut req = Request::post("/api/transcribe");
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    if let Some(t) = content_type {
        req = req.header(header::CONTENT_TYPE, t);
    }
    req.body(Body::from(bytes)).unwrap()
}

fn code(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap();
    v["error"]["code"].as_str().unwrap_or_default().to_owned()
}

/// u1 owns the ready clip c1 "Beach sunset"; u2 owns x1.
fn app() -> (TestApp, String) {
    let app = TestApp::new();
    let mut c1 = clip(Some(probe(12.0, true))).unwrap();
    c1.status = ClipStatus::Ready;
    c1.title = Some("Beach sunset".into());
    app.catalogue.put_clip(c1);
    let mut x1 = clip(Some(probe(5.0, true))).unwrap();
    x1.id = ClipId::parse("x1").unwrap();
    x1.user_id = UserId::parse("u2").unwrap();
    app.catalogue.put_clip(x1);
    let cookie = app.cookie_for("u1");
    (app, cookie)
}

#[tokio::test]
async fn transcribe_answers_the_spoken_text() {
    let (app, cookie) = app();
    app.transcriber.returns(vec![
        said(0, 800, "sunset at"),
        said(800, 1500, " the beach "),
    ]);

    let (status, _, body) = app
        .send(audio(Some(&cookie), Some("audio/mp4"), b"m4a".to_vec()))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"text": "sunset at the beach"})
    );
}

#[tokio::test]
async fn transcribe_refuses_an_empty_body_an_unknown_type_and_no_session() {
    let (app, cookie) = app();
    let (status, _, body) = app
        .send(audio(Some(&cookie), Some("audio/webm"), Vec::new()))
        .await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );

    let (status, _, body) = app
        .send(audio(Some(&cookie), Some("text/plain"), b"hi".to_vec()))
        .await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );

    let (status, _, body) = app.send(audio(Some(&cookie), None, b"hi".to_vec())).await;
    assert_eq!(code(&body), "VALIDATION_FAILED", "{status}");

    let (status, _, _) = app
        .send(audio(None, Some("audio/webm"), b"hi".to_vec()))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(app.transcriber.calls().is_empty());
}

#[tokio::test]
async fn transcribe_takes_ten_mib_but_refuses_one_byte_more() {
    let (app, cookie) = app();
    let (status, _, body) = app
        .send(audio(
            Some(&cookie),
            Some("audio/wav"),
            vec![0; MAX_AUDIO_BYTES],
        ))
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the raised limit lets 10 MiB in: {body}"
    );

    let (status, _, body) = app
        .send(audio(
            Some(&cookie),
            Some("audio/wav"),
            vec![0; MAX_AUDIO_BYTES + 1],
        ))
        .await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert!(body.contains("10 MB"), "{body}");

    let (status, _, body) = app
        .send(audio(
            Some(&cookie),
            Some("audio/wav"),
            vec![0; 3 * MAX_AUDIO_BYTES],
        ))
        .await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(app.transcriber.calls().len(), 1, "only the 10 MiB one");
}

#[tokio::test]
async fn other_routes_keep_the_default_body_limit() {
    let (app, cookie) = app();
    let big = format!(
        r#"{{"text": "x", "clip_ids": [], "pad": "{}"}}"#,
        "a".repeat(3 << 20)
    );
    let (status, _, _) = app
        .send(post_json("/api/intents", Some(&cookie), &big))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(app.intents.calls().is_empty());
}

#[tokio::test]
async fn a_transcribe_failure_is_model_unavailable() {
    let (app, cookie) = app();
    app.transcriber.fails_with(AppError::new(
        ErrorCode::ModelUnavailable,
        "502 from Transcribe",
    ));
    let (status, _, body) = app
        .send(audio(Some(&cookie), Some("audio/ogg"), b"x".to_vec()))
        .await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::BAD_GATEWAY, "MODEL_UNAVAILABLE")
    );
}

#[tokio::test]
async fn intents_answer_every_key_for_a_short() {
    let (app, cookie) = app();
    app.intents.answers(IntentDraft {
        kind: "make_short".into(),
        title: "Beach sunsets".into(),
        source: Some("attached".into()),
        clip_ids: vec!["c1".into()],
        ..IntentDraft::default()
    });

    let (status, _, body) = app
        .send(post_json(
            "/api/intents",
            Some(&cookie),
            r#"{"text": "make a short of this", "clip_ids": ["c1"]}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({
            "kind": "make_short", "title": "Beach sunsets", "query": null,
            "source": "attached", "project_id": null, "new_project_name": null,
            "clip_ids": ["c1"], "target_s": 30.0, "aspect": "4:5", "choices": [],
            "document_ids": [], "question": null,
            "person_id": null, "viewer_id": null, "clip_id": null
        })
    );
}

#[tokio::test]
async fn an_unclear_intent_carries_its_choices_and_nulls() {
    let (app, cookie) = app();
    app.intents.answers(IntentDraft {
        kind: "unclear".into(),
        title: "Birthday".into(),
        choices: vec![Choice {
            label: "Search for birthday".into(),
            text: "search for the 60th birthday".into(),
        }],
        ..IntentDraft::default()
    });

    let (status, _, body) = app
        .send(post_json(
            "/api/intents",
            Some(&cookie),
            r#"{"text": "something nice for the 60th birthday"}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({
            "kind": "unclear", "title": "Birthday", "query": null, "source": null,
            "project_id": null, "new_project_name": null, "clip_ids": [],
            "target_s": null, "aspect": null,
            "choices": [{"label": "Search for birthday", "text": "search for the 60th birthday"}],
            "document_ids": [], "question": null,
            "person_id": null, "viewer_id": null, "clip_id": null
        })
    );
}

#[tokio::test]
async fn another_users_clip_is_forbidden() {
    let (app, cookie) = app();
    app.intents.answers(IntentDraft::default());

    let (status, _, body) = app
        .send(post_json(
            "/api/intents",
            Some(&cookie),
            r#"{"text": "make a guide from this", "clip_ids": ["c1", "x1"]}"#,
        ))
        .await;

    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );
    assert!(app.intents.calls().is_empty());
}

#[tokio::test]
async fn intents_refuse_a_bad_body_and_no_session() {
    let (app, cookie) = app();
    for bad in [
        r#"{"text": "   "}"#,
        r#"{"clip_ids": []}"#,
        r#"{"text": "go", "clip_ids": ["../etc"]}"#,
        "not json",
    ] {
        let (status, _, body) = app
            .send(post_json("/api/intents", Some(&cookie), bad))
            .await;
        assert_eq!(
            (status, code(&body).as_str()),
            (StatusCode::BAD_REQUEST, "VALIDATION_FAILED"),
            "{bad}"
        );
    }
    let (status, _, _) = app
        .send(post_json("/api/intents", None, r#"{"text": "go"}"#))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_spark_failure_is_model_unavailable() {
    let (app, cookie) = app();
    let (status, _, body) = app
        .send(post_json(
            "/api/intents",
            Some(&cookie),
            r#"{"text": "go"}"#,
        ))
        .await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::BAD_GATEWAY, "MODEL_UNAVAILABLE")
    );
}

/// u1's ready document d1 and u2's document x1 in the app's document store.
fn with_documents(app: &TestApp) {
    use nimbytes_core::domain::document::{DocFormat, DocStatus, Document, NewDocument};
    use nimbytes_core::domain::ids::{DocumentId, UserId};
    for (id, user) in [("d1", "u1"), ("x1", "u2")] {
        let req = NewDocument {
            filename: "letter.jpg".into(),
            content_type: "image/jpeg".into(),
            size_bytes: 10,
        };
        let ids = (DocumentId::parse(id).unwrap(), UserId::parse(user).unwrap());
        let mut d = Document::uploading(ids, req, DocFormat::Jpeg, "2026-10-29T01:00:00.000Z");
        d.status = DocStatus::Ready;
        app.documents.put(d, Vec::new());
    }
}

#[tokio::test]
async fn a_read_document_intent_answers_its_document_and_question() {
    let (app, cookie) = app();
    with_documents(&app);
    app.intents.answers(IntentDraft {
        kind: "read_document".into(),
        title: "Read my letter".into(),
        question: Some("When is it due?".into()),
        ..IntentDraft::default()
    });

    let body = r#"{"text": "when is this due", "document_ids": ["d1"]}"#;
    let (status, _, body) = app
        .send(post_json("/api/intents", Some(&cookie), body))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({
            "kind": "read_document", "title": "Read my letter", "query": null, "source": null,
            "project_id": null, "new_project_name": null, "clip_ids": [], "target_s": null,
            "aspect": null, "choices": [], "document_ids": ["d1"], "question": "When is it due?",
            "person_id": null, "viewer_id": null, "clip_id": null
        })
    );
    let seen = &app.intents.calls()[0];
    assert!(
        seen.documents
            .iter()
            .any(|d| d.id.as_str() == "d1" && d.added)
    );
    assert!(
        seen.documents.iter().all(|d| d.id.as_str() != "x1"),
        "only the caller's"
    );
}

#[tokio::test]
async fn adding_another_users_document_is_forbidden_and_too_many_is_validation_failed() {
    let (app, cookie) = app();
    with_documents(&app);
    app.intents.answers(IntentDraft::default());

    let foreign = r#"{"text": "read this", "document_ids": ["x1"]}"#;
    let (status, _, body) = app
        .send(post_json("/api/intents", Some(&cookie), foreign))
        .await;
    let six = r#"{"text": "read", "document_ids": ["a1","a2","a3","a4","a5","a6"]}"#;
    let (many, _, many_body) = app
        .send(post_json("/api/intents", Some(&cookie), six))
        .await;

    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );
    assert_eq!(
        (many, code(&many_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert!(app.intents.calls().is_empty());
}

#[tokio::test]
async fn a_memory_lane_intent_answers_the_callers_person_and_viewer_ids() {
    use nimbytes_core::domain::ids::{PersonId, UserId};
    use nimbytes_core::ports::PeopleStore;
    let (app, cookie) = app();
    let u1 = UserId::parse("u1").unwrap();
    for (id, name) in [("p-ann", "Ann"), ("p-eric", "Eric")] {
        app.people
            .upsert_person(&u1, &PersonId::parse(id).unwrap(), name)
            .await
            .unwrap();
    }
    app.intents.answers(IntentDraft {
        kind: "memory_lane".into(),
        title: "Ann for Eric".into(),
        person_name: Some("ann".into()),
        viewer_name: Some("Eric".into()),
        ..IntentDraft::default()
    });

    let (status, _, body) = app
        .send(post_json(
            "/api/intents",
            Some(&cookie),
            r#"{"text": "show Eric his memories of Ann"}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({
            "kind": "memory_lane", "title": "Ann for Eric", "query": null,
            "source": null, "project_id": null, "new_project_name": null,
            "clip_ids": [], "target_s": null, "aspect": null, "choices": [],
            "document_ids": [], "question": null,
            "person_id": "p-ann", "viewer_id": "p-eric", "clip_id": null
        })
    );
}
