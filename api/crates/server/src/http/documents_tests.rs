//! iRead handlers over fakes: status codes, the exact wire shapes (every key present),
//! `VALIDATION_FAILED`, `NOT_FOUND` and `FORBIDDEN` on another user's document for every route.

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use nimbytes_core::domain::document::{
    DocFormat, DocKind, DocStatus, Document, DocumentPage, MAX_BYTES,
};
use nimbytes_core::domain::ids::{DocumentId, UserId};
use nimbytes_core::keys::ObjectKey;
use serde_json::{Value, json};

use super::test_support::{TestApp, delete, get, patch_json, post_json};

fn doc(id: &str, status: DocStatus) -> Document {
    Document {
        id: DocumentId::parse(id).unwrap(),
        user_id: UserId::parse("u1").unwrap(),
        filename: "bill.jpg".into(),
        format: DocFormat::Jpeg,
        size_bytes: 1000,
        status,
        title: "Water bill".into(),
        kind: DocKind::Bill,
        sender: "City Water".into(),
        date: "1 October 2026".into(),
        text: "Amount due: $142.60. Pay by 14 November 2026.".into(),
        summary: "Pay $142.60.".into(),
        page_count: 1,
        summary_audio_key: None,
        error: None,
        created_at: "2026-10-29T01:00:00.000Z".into(),
        updated_at: "2026-10-29T01:00:00.000Z".into(),
    }
}

fn page() -> DocumentPage {
    DocumentPage {
        n: 1,
        image_key: ObjectKey::from_stored("users/u1/documents/d1/page_1.jpg".into()),
    }
}

/// u1 owns the ready document d1 (one page) and d2, still being read.
fn app() -> (TestApp, String, String) {
    let app = TestApp::new();
    app.documents.put(doc("d1", DocStatus::Ready), vec![page()]);
    app.documents.put(doc("d2", DocStatus::Reading), Vec::new());
    let (mine, theirs) = (app.cookie_for("u1"), app.cookie_for("u2"));
    (app, mine, theirs)
}

fn code(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap();
    v["error"]["code"].as_str().unwrap_or_default().to_owned()
}

fn json_of(body: &str) -> Value {
    serde_json::from_str(body).unwrap()
}

#[tokio::test]
async fn creating_answers_201_with_the_upload_url_and_refuses_a_bad_type() {
    let (app, cookie, _) = app();
    let ok = r#"{"filename":"bill.pdf","content_type":"application/pdf","size_bytes":5000}"#;

    let (status, _, body) = app
        .send(post_json("/api/documents", Some(&cookie), ok))
        .await;
    let gif = ok.replace("application/pdf", "image/gif");
    let (bad, _, bad_body) = app
        .send(post_json("/api/documents", Some(&cookie), &gif))
        .await;
    let (anon, _, _) = app.send(post_json("/api/documents", None, ok)).await;

    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"document_id": "d-1",
               "upload_url": "https://put/users/u1/documents/d-1/source.pdf?ttl=900"})
    );
    assert_eq!(
        (bad, code(&bad_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(anon, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn completing_answers_202_reading_once_the_file_is_there() {
    let app = TestApp::new();
    let mut d = doc("d1", DocStatus::Uploading);
    d.page_count = 0;
    app.documents.put(d, Vec::new());
    let (cookie, other) = (app.cookie_for("u1"), app.cookie_for("u2"));
    let uri = "/api/documents/d1/complete";

    let (early, _, early_body) = app.send(post_json(uri, Some(&cookie), "")).await;
    app.blobs.store("users/u1/documents/d1/source.jpg", 1000);
    let (foreign, _, foreign_body) = app.send(post_json(uri, Some(&other), "")).await;
    let (status, _, body) = app.send(post_json(uri, Some(&cookie), "")).await;
    let missing = post_json("/api/documents/nope/complete", Some(&cookie), "");
    let (gone, _, _) = app.send(missing).await;

    assert_eq!(
        (early, code(&early_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(
        (foreign, code(&foreign_body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"document_id": "d1", "status": "reading"})
    );
    assert_eq!(gone, StatusCode::NOT_FOUND);
    assert_eq!(app.jobs.all().len(), 1, "one read job");
}

/// `PUT /api/documents/{id}/source` with a raw body.
fn source_put(id: &str, cookie: &str, content_type: Option<&str>, bytes: Vec<u8>) -> Request<Body> {
    let mut req =
        Request::put(format!("/api/documents/{id}/source")).header(header::COOKIE, cookie);
    if let Some(t) = content_type {
        req = req.header(header::CONTENT_TYPE, t);
    }
    req.body(Body::from(bytes)).unwrap()
}

/// u1's d1, still uploading (no pages yet).
fn uploading_app() -> (TestApp, String, String) {
    let app = TestApp::new();
    let mut d = doc("d1", DocStatus::Uploading);
    d.page_count = 0;
    app.documents.put(d, Vec::new());
    let (mine, theirs) = (app.cookie_for("u1"), app.cookie_for("u2"));
    (app, mine, theirs)
}

#[tokio::test]
async fn sending_the_file_answers_202_reading_and_stores_it_at_the_source_key() {
    let (app, cookie, _) = uploading_app();

    let req = source_put("d1", &cookie, Some("image/jpeg"), b"jpeg bytes".to_vec());
    let (status, _, body) = app.send(req).await;

    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"document_id": "d1", "status": "reading"})
    );
    assert_eq!(
        app.blobs.puts(),
        [(
            "users/u1/documents/d1/source.jpg".to_owned(),
            "image/jpeg".to_owned()
        )]
    );
    assert_eq!(app.jobs.all().len(), 1, "one read job");
}

#[tokio::test]
async fn sending_the_file_refuses_a_bad_type_and_an_empty_or_too_large_body() {
    let (app, cookie, _) = uploading_app();
    let jpeg = |bytes| source_put("d1", &cookie, Some("image/jpeg"), bytes);
    let refused = [
        source_put("d1", &cookie, Some("image/gif"), b"gif".to_vec()),
        source_put("d1", &cookie, None, b"jpg".to_vec()),
        source_put("d1", &cookie, Some("image/png"), b"png".to_vec()),
        jpeg(Vec::new()),
        jpeg(vec![0; MAX_BYTES as usize + 1]),
        jpeg(vec![0; MAX_BYTES as usize + 2]),
    ];

    for req in refused {
        let (status, _, body) = app.send(req).await;
        assert_eq!(
            (status, code(&body).as_str()),
            (StatusCode::BAD_REQUEST, "VALIDATION_FAILED"),
            "{body}"
        );
    }
    assert!(app.blobs.puts().is_empty(), "nothing stored");
    assert!(app.jobs.all().is_empty(), "nothing queued");
}

#[tokio::test]
async fn sending_the_file_of_another_users_or_a_missing_document_is_refused() {
    let (app, cookie, other) = uploading_app();

    let foreign = source_put("d1", &other, Some("image/jpeg"), b"x".to_vec());
    let (status, _, body) = app.send(foreign).await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );
    let missing = source_put("nope", &cookie, Some("image/jpeg"), b"x".to_vec());
    let (status, _, body) = app.send(missing).await;
    assert_eq!(
        (status, code(&body).as_str()),
        (StatusCode::NOT_FOUND, "NOT_FOUND")
    );
    assert!(app.blobs.puts().is_empty(), "nothing stored");
    assert!(app.jobs.all().is_empty(), "nothing queued");
}

fn summary_row() -> Value {
    json!({"id": "d1", "title": "Water bill", "kind": "bill", "sender": "City Water",
           "date": "1 October 2026", "status": "ready", "page_count": 1,
           "thumb_url": "https://signed/users/u1/documents/d1/page_1.jpg?ttl=3600",
           "created_at": "2026-10-29T01:00:00.000Z", "project_ids": [], "size_bytes": 1000,
           "error": null})
}

#[tokio::test]
async fn the_list_and_the_detail_carry_every_key() {
    // A ready letter with no summary voice gets one spoken when it is opened (the narrator is on).
    let (app, cookie, _) = app();

    let (listed, _, list) = app.send(get("/api/documents", Some(&cookie))).await;
    let (status, _, body) = app.send(get("/api/documents/d1", Some(&cookie))).await;

    assert_eq!(listed, StatusCode::OK);
    assert_eq!(json_of(&list).as_array().unwrap().len(), 2);
    assert_eq!(
        json_of(&list)[1],
        summary_row(),
        "newest first; d1 and d2 share a time"
    );
    assert_eq!(status, StatusCode::OK, "{body}");
    let mut want = summary_row();
    let extra = json!({"summary": "Pay $142.60.",
                       "text": "Amount due: $142.60. Pay by 14 November 2026.",
                       "pages": [{"n": 1, "image_url": "https://signed/users/u1/documents/d1/page_1.jpg?ttl=3600"}],
                       "summary_audio_url": "https://signed/users/u1/documents/d1/voice_a24012576cdf0c27.wav?ttl=3600"});
    want.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    assert_eq!(json_of(&body), want);
}

#[tokio::test]
async fn reading_renaming_and_deleting_another_users_document_is_forbidden() {
    let (app, _, other) = app();
    let rename = patch_json("/api/documents/d1", &other, r#"{"title":"Mine"}"#);

    let results = [
        app.send(get("/api/documents/d1", Some(&other))).await,
        app.send(rename).await,
        app.send(delete("/api/documents/d1", &other)).await,
        app.send(post_json(
            "/api/documents/d1/ask",
            Some(&other),
            r#"{"question":"q"}"#,
        ))
        .await,
        app.send(post_json(
            "/api/documents/d1/speak",
            Some(&other),
            r#"{"part":0}"#,
        ))
        .await,
    ];

    for (status, _, body) in results {
        assert_eq!(
            (status, code(&body).as_str()),
            (StatusCode::FORBIDDEN, "FORBIDDEN")
        );
    }
    assert!(app.documents.doc("d1").is_some());
    assert!(app.doc_reader.questions().is_empty());
}

#[tokio::test]
async fn a_missing_or_malformed_id_is_not_found_or_validation_failed() {
    let (app, cookie, _) = app();
    let routes = [
        get("/api/documents/nope", Some(&cookie)),
        patch_json("/api/documents/nope", &cookie, r#"{"title":"x"}"#),
        delete("/api/documents/nope", &cookie),
        post_json(
            "/api/documents/nope/ask",
            Some(&cookie),
            r#"{"question":"q"}"#,
        ),
        post_json("/api/documents/nope/speak", Some(&cookie), r#"{"part":0}"#),
    ];
    for req in routes {
        let (status, _, body) = app.send(req).await;
        assert_eq!(
            (status, code(&body).as_str()),
            (StatusCode::NOT_FOUND, "NOT_FOUND")
        );
    }
    let (bad, _, body) = app.send(get("/api/documents/a.b", Some(&cookie))).await;
    assert_eq!(
        (bad, code(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
}

#[tokio::test]
async fn renaming_answers_the_detail_and_refuses_an_empty_title() {
    let (app, cookie, _) = app();

    let ok = patch_json("/api/documents/d1", &cookie, r#"{"title":"  My  bill "}"#);
    let (status, _, body) = app.send(ok).await;
    let empty = patch_json("/api/documents/d1", &cookie, r#"{"title":" "}"#);
    let (bad, _, bad_body) = app.send(empty).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(json_of(&body)["title"], "My bill");
    assert_eq!(
        (bad, code(&bad_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
}

#[tokio::test]
async fn deleting_answers_204_and_removes_the_objects() {
    let (app, cookie, _) = app();

    let (status, _, _) = app.send(delete("/api/documents/d1", &cookie)).await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(app.documents.doc("d1").is_none());
    assert!(
        app.blobs
            .deleted()
            .contains(&"users/u1/documents/d1/source.jpg".to_owned())
    );
}

#[tokio::test]
async fn asking_answers_the_question_with_its_voice_and_refuses_while_reading() {
    let (app, cookie, _) = app();
    app.doc_reader.answers("You owe $142.60.");
    let ask = |id: &str, q: &str| {
        let body = json!({ "question": q }).to_string();
        post_json(&format!("/api/documents/{id}/ask"), Some(&cookie), &body)
    };

    let (status, _, body) = app.send(ask("d1", " How much? ")).await;
    let (reading, _, reading_body) = app.send(ask("d2", "How much?")).await;
    let (empty, _, empty_body) = app.send(ask("d1", "  ")).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v = json_of(&body);
    assert_eq!(
        (v["question"].as_str(), v["answer"].as_str()),
        (Some("How much?"), Some("You owe $142.60."))
    );
    let url = v["audio_url"].as_str().unwrap();
    assert!(
        url.starts_with("https://signed/users/u1/documents/d1/voice_"),
        "{url}"
    );
    assert_eq!(v.as_object().unwrap().len(), 3);
    assert_eq!(
        (reading, code(&reading_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(
        (empty, code(&empty_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(
        app.doc_reader.questions().len(),
        1,
        "only the ready document was asked"
    );
}

#[tokio::test]
async fn an_answer_without_a_voice_has_a_null_audio_url() {
    let (app, cookie, _) = app();
    app.doc_reader.answers("You owe $142.60.");
    app.narrator.fail();

    let req = post_json(
        "/api/documents/d1/ask",
        Some(&cookie),
        r#"{"question":"How much?"}"#,
    );
    let (status, _, body) = app.send(req).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(json_of(&body)["audio_url"], Value::Null);
}

#[tokio::test]
async fn speaking_answers_one_part_and_refuses_a_part_past_the_end() {
    let (app, cookie, _) = app();
    let speak = |part: &str| post_json("/api/documents/d1/speak", Some(&cookie), part);

    let (status, _, body) = app.send(speak(r#"{"part":0}"#)).await;
    let (past, _, past_body) = app.send(speak(r#"{"part":1}"#)).await;
    let (bad, _, bad_body) = app.send(speak(r#"{"part":-1}"#)).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v = json_of(&body);
    assert_eq!(
        (v["part"].as_u64(), v["parts"].as_u64()),
        (Some(0), Some(1))
    );
    assert_eq!(v["text"], "Amount due: $142.60. Pay by 14 November 2026.");
    assert!(v["audio_url"].as_str().is_some());
    assert_eq!(
        (past, code(&past_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(
        (bad, code(&bad_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
}
