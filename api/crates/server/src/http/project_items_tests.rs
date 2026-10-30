//! Recordings, documents and photos in projects: add (204, repeats ignored), remove (204), the
//! per-kind counts, `project_ids` on each list and detail, and the ownership answers (403 on
//! another user's project or item, 404 on an unknown one, 400 on a bad kind or an empty list).

use axum::http::StatusCode;
use nimbytes_core::domain::document::{DocFormat, DocStatus, Document, NewDocument};
use nimbytes_core::domain::ids::{DocumentId, ListenId, PhotoId, UserId};
use nimbytes_core::domain::listen::{Listen, ListenSource, ListenStart, ListenStatus};
use nimbytes_core::domain::photo::{NewPhoto, Photo, PhotoFormat, PhotoStatus};
use serde_json::Value;

use super::test_support::{TestApp, delete, get, post_json};

const AT: &str = "2026-10-30T01:00:00.000Z";

fn listen(id: &str) -> Listen {
    let start = ListenStart {
        source: ListenSource::File,
        clip_id: None,
        source_name: "a.mp3".into(),
        content_type: "audio/mpeg".into(),
        ext: "mp3".into(),
        size_bytes: 10,
        target: "en".into(),
    };
    let ids = (ListenId::parse(id).unwrap(), UserId::parse("u1").unwrap());
    Listen::new(ids, start, ListenStatus::Ready, AT)
}

fn document(id: &str, owner: &str) -> Document {
    let req = NewDocument {
        filename: "a.pdf".into(),
        content_type: "application/pdf".into(),
        size_bytes: 20,
    };
    let ids = (
        DocumentId::parse(id).unwrap(),
        UserId::parse(owner).unwrap(),
    );
    let mut d = Document::uploading(ids, req, DocFormat::Pdf, AT);
    d.status = DocStatus::Ready;
    d
}

fn photo(id: &str) -> Photo {
    let req = NewPhoto {
        filename: "a.jpg".into(),
        content_type: "image/jpeg".into(),
        size_bytes: 30,
        last_modified: None,
    };
    let ids = (PhotoId::parse(id).unwrap(), UserId::parse("u1").unwrap());
    let mut p = Photo::uploading(ids, req, PhotoFormat::Jpeg, AT);
    p.status = PhotoStatus::Ready;
    p
}

fn json_of(body: &str) -> Value {
    serde_json::from_str(body).unwrap()
}

/// u1 owns l1, d1, p1 and a project; u2 owns d2.
async fn app() -> (TestApp, String, String) {
    let app = TestApp::new();
    app.listens.put(listen("l1"), Vec::new(), Vec::new());
    app.documents.put(document("d1", "u1"), Vec::new());
    app.documents.put(document("d2", "u2"), Vec::new());
    app.photos.put(photo("p1"));
    let mine = app.cookie_for("u1");
    let (status, _, body) = app
        .send(post_json(
            "/api/projects",
            Some(&mine),
            r#"{"name":"Tokyo","color":"blue"}"#,
        ))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = json_of(&body)["project_id"].as_str().unwrap().to_owned();
    (app, mine, id)
}

async fn project(app: &TestApp, cookie: &str) -> Value {
    let (_, _, body) = app.send(get("/api/projects", Some(cookie))).await;
    json_of(&body)[0].clone()
}

#[tokio::test]
async fn items_are_added_once_and_counted_per_kind() {
    let (app, mine, id) = app().await;
    let uri = format!("/api/projects/{id}/items");
    let body = r#"{"items":[{"kind":"listen","id":"l1"},{"kind":"document","id":"d1"},
        {"kind":"photo","id":"p1"},{"kind":"photo","id":"p1"}]}"#;

    let (first, _, empty) = app.send(post_json(&uri, Some(&mine), body)).await;
    let (again, _, _) = app.send(post_json(&uri, Some(&mine), body)).await;

    assert_eq!((first, empty.as_str()), (StatusCode::NO_CONTENT, ""));
    assert_eq!(again, StatusCode::NO_CONTENT, "repeats are ignored");
    let p = project(&app, &mine).await;
    let counts = [
        "clip_count",
        "listen_count",
        "document_count",
        "photo_count",
    ]
    .map(|k| p[k].as_u64().unwrap());
    assert_eq!(counts, [0, 1, 1, 1]);
}

#[tokio::test]
async fn each_list_and_detail_names_the_projects_an_item_is_in() {
    let (app, mine, id) = app().await;
    let body = r#"{"items":[{"kind":"listen","id":"l1"},{"kind":"document","id":"d1"},
        {"kind":"photo","id":"p1"}]}"#;
    app.send(post_json(
        &format!("/api/projects/{id}/items"),
        Some(&mine),
        body,
    ))
    .await;

    for (list, detail) in [
        ("/api/listens", "/api/listens/l1"),
        ("/api/documents", "/api/documents/d1"),
        ("/api/photos", "/api/photos/p1"),
    ] {
        let (_, _, rows) = app.send(get(list, Some(&mine))).await;
        let (_, _, one) = app.send(get(detail, Some(&mine))).await;
        assert_eq!(
            json_of(&rows)[0]["project_ids"],
            serde_json::json!([id]),
            "{list}"
        );
        assert_eq!(
            json_of(&one)["project_ids"],
            serde_json::json!([id]),
            "{detail}: {one}"
        );
    }
}

#[tokio::test]
async fn an_item_is_removed_with_204_also_when_it_was_not_in_it() {
    let (app, mine, id) = app().await;
    let body = r#"{"items":[{"kind":"photo","id":"p1"}]}"#;
    app.send(post_json(
        &format!("/api/projects/{id}/items"),
        Some(&mine),
        body,
    ))
    .await;

    let uri = format!("/api/projects/{id}/items/photo/p1");
    let (gone, _, _) = app.send(delete(&uri, &mine)).await;
    let (again, _, _) = app.send(delete(&uri, &mine)).await;

    assert_eq!(
        (gone, again),
        (StatusCode::NO_CONTENT, StatusCode::NO_CONTENT)
    );
    assert_eq!(project(&app, &mine).await["photo_count"], 0);
    let (_, _, rows) = app.send(get("/api/photos", Some(&mine))).await;
    assert_eq!(json_of(&rows)[0]["project_ids"], serde_json::json!([]));
}

fn code(body: &str) -> String {
    json_of(body)["error"]["code"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

#[tokio::test]
async fn adding_checks_the_project_each_item_and_the_list() {
    let (app, mine, id) = app().await;
    let theirs = app.cookie_for("u2");
    let uri = format!("/api/projects/{id}/items");
    let cases = [
        (r#"[{"kind":"document","id":"d2"}]"#, &mine, "FORBIDDEN"),
        (r#"[{"kind":"photo","id":"p9"}]"#, &mine, "NOT_FOUND"),
        (r#"[{"kind":"clip","id":"c1"}]"#, &mine, "VALIDATION_FAILED"),
        ("[]", &mine, "VALIDATION_FAILED"),
        (r#"[{"kind":"photo","id":"p1"}]"#, &theirs, "FORBIDDEN"),
    ];

    for (items, cookie, want) in cases {
        let json = format!(r#"{{"items":{items}}}"#);
        let (status, _, body) = app.send(post_json(&uri, Some(cookie), &json)).await;
        let status_of = match want {
            "FORBIDDEN" => StatusCode::FORBIDDEN,
            "NOT_FOUND" => StatusCode::NOT_FOUND,
            _ => StatusCode::BAD_REQUEST,
        };
        assert_eq!((status, code(&body).as_str()), (status_of, want), "{json}");
    }
    let p = project(&app, &mine).await;
    assert_eq!(
        (p["document_count"].as_u64(), p["photo_count"].as_u64()),
        (Some(0), Some(0))
    );
}

#[tokio::test]
async fn removing_checks_the_project_and_the_kind() {
    let (app, mine, id) = app().await;
    let uri = format!("/api/projects/{id}/items");

    let (other_owner, _, _) = app
        .send(delete(&format!("{uri}/photo/p1"), &app.cookie_for("u2")))
        .await;
    let (unknown_project, _, _) = app
        .send(delete("/api/projects/nope/items/photo/p1", &mine))
        .await;
    let (bad_kind, _, _) = app.send(delete(&format!("{uri}/clip/c1"), &mine)).await;

    assert_eq!(other_owner, StatusCode::FORBIDDEN);
    assert_eq!(unknown_project, StatusCode::NOT_FOUND);
    assert_eq!(bad_kind, StatusCode::BAD_REQUEST);
}
