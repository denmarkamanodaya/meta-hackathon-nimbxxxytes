//! Photos handlers over fakes: status codes, the exact wire shapes (every key present, `null` for
//! empty), HEIC refused, the source streamed past the default 2 MB limit, `NOT_FOUND` and
//! `FORBIDDEN` on another user's photo, and a photo search result's shape.

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use nimbytes_core::domain::ids::{PhotoId, UserId};
use nimbytes_core::domain::index::PhotoDoc;
use nimbytes_core::domain::photo::{NewPhoto, Photo, PhotoFacts, PhotoFormat, PhotoStatus};
use nimbytes_core::ports::TextIndex;
use serde_json::{Value, json};

use super::test_support::{TestApp, delete, get, patch_json, post_json};

const AT: &str = "2026-10-30T01:00:00.000Z";

fn photo(id: &str, status: PhotoStatus) -> Photo {
    let req = NewPhoto {
        filename: "_MG_4210.jpg".into(),
        content_type: "image/jpeg".into(),
        size_bytes: 79_810,
        last_modified: None,
    };
    let ids = (PhotoId::parse(id).unwrap(), UserId::parse("u1").unwrap());
    let mut p = Photo::uploading(ids, req, PhotoFormat::Jpeg, AT);
    p.status = status;
    p
}

/// u1 owns the ready p1 and p2, still uploading.
fn app() -> (TestApp, String, String) {
    let app = TestApp::new();
    let mut p = photo("p1", PhotoStatus::Ready);
    p.title = "Birthday stage".into();
    p.facts = PhotoFacts {
        title: "Birthday stage".into(),
        description: "A white loveseat on a stage.".into(),
        things: vec!["stage".into(), "balloons".into()],
        place: "event hall".into(),
        mood: "festive".into(),
    };
    (p.width, p.height) = (Some(320), Some(480));
    p.taken_at = Some("2026-08-08T06:09:37.000Z".into());
    p.camera = Some("Canon EOS 200D".into());
    app.photos.put(p);
    app.photos.put(photo("p2", PhotoStatus::Uploading));
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

fn ready_row() -> Value {
    json!({
        "id": "p1", "title": "Birthday stage", "filename": "_MG_4210.jpg", "status": "ready",
        "taken_at": "2026-08-08T06:09:37.000Z", "width": 320, "height": 480,
        "size_bytes": 79810, "thumb_url": "https://signed/users/u1/photos/p1/thumb.jpg?ttl=3600",
        "created_at": AT, "project_ids": [], "error": null
    })
}

#[tokio::test]
async fn creating_answers_201_uploading_and_refuses_heic_and_bad_input() {
    let (app, cookie, _) = app();
    let ok = r#"{"filename":"a.jpg","content_type":"image/jpeg","size_bytes":5000,"last_modified":"2026-08-19T10:00:00Z"}"#;
    let (status, _, body) = app.send(post_json("/api/photos", Some(&cookie), ok)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"photo_id": "p-1", "status": "uploading"})
    );

    let heic = ok.replace("image/jpeg", "image/heic");
    let (s, _, b) = app
        .send(post_json("/api/photos", Some(&cookie), &heic))
        .await;
    assert_eq!(
        (s, code(&b).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(
        json_of(&b)["error"]["message"],
        "HEIC isn't supported yet; export as JPEG"
    );
    let (s, _, _) = app
        .send(post_json(
            "/api/photos",
            Some(&cookie),
            &ok.replace("5000", "0"),
        ))
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (anon, _, _) = app.send(post_json("/api/photos", None, ok)).await;
    assert_eq!(anon, StatusCode::UNAUTHORIZED);
}

fn source_put(id: &str, cookie: &str, content_type: &str, bytes: Vec<u8>) -> Request<Body> {
    Request::put(format!("/api/photos/{id}/source"))
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(bytes))
        .unwrap()
}

#[tokio::test]
async fn the_source_streams_past_the_default_limit_and_queues_the_analysis() {
    let (app, cookie, other) = app();
    let three_mb = vec![7u8; 3 * 1024 * 1024];

    let (status, _, body) = app
        .send(source_put("p2", &cookie, "image/jpeg", three_mb))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"photo_id": "p2", "status": "analysing"})
    );
    assert_eq!(
        app.blobs.puts(),
        [(
            "users/u1/photos/p2/original.jpg".to_owned(),
            "image/jpeg".to_owned()
        )]
    );
    assert_eq!(app.jobs.all().len(), 1);

    let (s, _, b) = app
        .send(source_put("p2", &other, "image/jpeg", b"x".to_vec()))
        .await;
    assert_eq!((s, code(&b).as_str()), (StatusCode::FORBIDDEN, "FORBIDDEN"));
    let (s, _, _) = app
        .send(source_put("nope", &cookie, "image/jpeg", b"x".to_vec()))
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_list_and_detail_show_every_key_and_only_the_owners() {
    let (app, cookie, other) = app();
    let (_, _, body) = app.send(get("/api/photos", Some(&cookie))).await;
    let rows = json_of(&body);
    assert_eq!(
        rows[1],
        ready_row(),
        "taken in August; p2 sorts by when it was added"
    );
    assert_eq!(
        (
            &rows[0]["title"],
            &rows[0]["thumb_url"],
            &rows[0]["taken_at"]
        ),
        (&json!("_MG_4210.jpg"), &Value::Null, &Value::Null)
    );
    let (_, _, theirs) = app.send(get("/api/photos", Some(&other))).await;
    assert_eq!(json_of(&theirs), json!([]));

    let (status, _, body) = app.send(get("/api/photos/p1", Some(&cookie))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mut expected = ready_row();
    for (k, v) in [
        ("description", json!("A white loveseat on a stage.")),
        ("things", json!(["stage", "balloons"])),
        (
            "image_url",
            json!("https://signed/users/u1/photos/p1/view.jpg?ttl=3600"),
        ),
        (
            "original_url",
            json!("https://signed/users/u1/photos/p1/original.jpg?ttl=3600"),
        ),
        ("camera", json!("Canon EOS 200D")),
    ] {
        expected[k] = v;
    }
    assert_eq!(json_of(&body), expected);
    let (s, _, _) = app.send(get("/api/photos/p1", Some(&other))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn renaming_answers_the_photo_and_delete_answers_204_then_404() {
    let (app, cookie, other) = app();
    let (status, _, body) = app
        .send(patch_json(
            "/api/photos/p1",
            &cookie,
            r#"{"title":" Mum's  60th "}"#,
        ))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(json_of(&body)["title"], "Mum's 60th");
    let (empty, _, _) = app
        .send(patch_json("/api/photos/p1", &cookie, r#"{"title":" "}"#))
        .await;
    assert_eq!(empty, StatusCode::BAD_REQUEST);

    let (foreign, _, _) = app.send(delete("/api/photos/p1", &other)).await;
    let (gone, _, _) = app.send(delete("/api/photos/p1", &cookie)).await;
    let (again, _, _) = app.send(delete("/api/photos/p1", &cookie)).await;
    assert_eq!(
        (foreign, gone, again),
        (
            StatusCode::FORBIDDEN,
            StatusCode::NO_CONTENT,
            StatusCode::NOT_FOUND
        )
    );
    assert_eq!(app.blobs.deleted().len(), 3);
}

#[tokio::test]
async fn a_photo_search_result_has_the_photo_kind_and_its_fields() {
    let (app, cookie, _) = app();
    let doc = PhotoDoc {
        key: nimbytes_core::domain::photo::search_key(&PhotoId::parse("p1").unwrap()).unwrap(),
        user_id: UserId::parse("u1").unwrap(),
        description: "Birthday stage. A white loveseat on a stage.".into(),
        things: "stage, balloons".into(),
        place: "event hall".into(),
        mood: "festive".into(),
        taken_at: None,
    };
    app.text.upsert_photo(&doc).await.unwrap();

    let (status, _, body) = app
        .send(post_json(
            "/api/search",
            Some(&cookie),
            r#"{"query":"loveseat"}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        json_of(&body)["results"][0],
        json!({
            "kind": "photo", "photo_id": "p1", "segment_id": "photo:p1", "clip_id": "",
            "start_s": 0.0, "end_s": 0.0, "score": 1.0 / 61.0,
            "thumb_url": "https://signed/users/u1/photos/p1/thumb.jpg?ttl=3600", "reason": null,
            "clip_filename": "_MG_4210.jpg", "clip_title": "Birthday stage",
            "recorded_at": "2026-08-08T06:09:37.000Z", "faces": []
        })
    );
}
