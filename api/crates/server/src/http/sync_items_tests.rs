//! Recordings, documents and photos in the Mac app's sync API: the `items` wire shape (ready only,
//! file listens only, newest first), the etag moving when one is added, and the owner-only
//! original of each kind.

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use nimbytes_core::domain::document::{DocFormat, DocStatus, Document, NewDocument};
use nimbytes_core::domain::ids::{DocumentId, ListenId, PhotoId, UserId};
use nimbytes_core::domain::listen::{Listen, ListenSource, ListenStart, ListenStatus};
use nimbytes_core::domain::photo::{NewPhoto, Photo, PhotoFormat, PhotoStatus};

use super::test_support::{TestApp, get};

fn listen(id: &str, source: ListenSource, status: ListenStatus) -> Listen {
    let start = ListenStart {
        source,
        clip_id: None,
        source_name: "Voice 3.m4a".into(),
        content_type: "audio/mp4".into(),
        ext: "m4a".into(),
        size_bytes: 4_000,
        target: "en".into(),
    };
    let ids = (ListenId::parse(id).unwrap(), UserId::parse("u1").unwrap());
    let mut l = Listen::new(ids, start, status, "2026-10-28T00:00:00.000Z");
    l.title = "Standup".into();
    l
}

fn document(id: &str, owner: &str, status: DocStatus) -> Document {
    let req = NewDocument {
        filename: "bill.pdf".into(),
        content_type: "application/pdf".into(),
        size_bytes: 9_000,
    };
    let ids = (
        DocumentId::parse(id).unwrap(),
        UserId::parse(owner).unwrap(),
    );
    let mut d = Document::uploading(ids, req, DocFormat::Pdf, "2026-10-27T00:00:00.000Z");
    d.status = status;
    d.title = "Power bill".into();
    d
}

fn photo(id: &str, status: PhotoStatus) -> Photo {
    let req = NewPhoto {
        filename: "IMG_9.png".into(),
        content_type: "image/png".into(),
        size_bytes: 7_000,
        last_modified: None,
    };
    let ids = (PhotoId::parse(id).unwrap(), UserId::parse("u1").unwrap());
    let mut p = Photo::uploading(ids, req, PhotoFormat::Png, "2026-10-30T00:00:00.000Z");
    p.status = status;
    p.title = "Stage".into();
    p.taken_at = Some("2026-08-08T06:09:37.000Z".into());
    p
}

/// u1: a ready file listen, a ready clip listen, a listen still listening, a ready document, a
/// reading document, a ready photo and an analysing one; u2: a ready document.
fn app() -> TestApp {
    let app = TestApp::new();
    for l in [
        listen("l1", ListenSource::File, ListenStatus::Ready),
        listen("l2", ListenSource::Clip, ListenStatus::Ready),
        listen("l3", ListenSource::File, ListenStatus::Listening),
    ] {
        app.listens.put(l, Vec::new(), Vec::new());
    }
    app.documents
        .put(document("d1", "u1", DocStatus::Ready), Vec::new());
    app.documents
        .put(document("d2", "u1", DocStatus::Reading), Vec::new());
    app.documents
        .put(document("d3", "u2", DocStatus::Ready), Vec::new());
    app.photos.put(photo("p1", PhotoStatus::Ready));
    app.photos.put(photo("p2", PhotoStatus::Analysing));
    app
}

fn post(uri: &str, cookie: &str) -> Request<Body> {
    Request::post(uri)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn the_manifest_lists_ready_items_newest_first_in_the_agreed_shape() {
    let app = app();

    let (status, _, body) = app
        .send(get("/api/sync/manifest", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK);
    let want = [
        r#""items":["#,
        r#"{"kind":"listen","id":"l1","title":"Standup","filename":"Voice 3.m4a","ext":"m4a","#,
        r#""size_bytes":4000,"dated_at":"2026-10-28T00:00:00.000Z"},"#,
        r#"{"kind":"document","id":"d1","title":"Power bill","filename":"bill.pdf","ext":"pdf","#,
        r#""size_bytes":9000,"dated_at":"2026-10-27T00:00:00.000Z"},"#,
        r#"{"kind":"photo","id":"p1","title":"Stage","filename":"IMG_9.png","ext":"png","#,
        r#""size_bytes":7000,"dated_at":"2026-08-08T06:09:37.000Z"}]}"#,
    ]
    .concat();
    assert!(body.ends_with(&want), "{body}");
}

#[tokio::test]
async fn the_etag_moves_when_an_item_is_added() {
    let app = app();
    let cookie = app.cookie_for("u1");
    let (_, headers, _) = app.send(get("/api/sync/manifest", Some(&cookie))).await;
    let before = headers[header::ETAG].to_str().unwrap().to_owned();

    app.photos.put(photo("p3", PhotoStatus::Ready));
    let (_, headers, body) = app.send(get("/api/sync/manifest", Some(&cookie))).await;

    assert_ne!(headers[header::ETAG].to_str().unwrap(), before);
    assert!(body.contains(r#""id":"p3""#), "{body}");
}

#[tokio::test]
async fn each_kinds_original_downloads_as_its_title() {
    let app = app();
    let mine = app.cookie_for("u1");

    let mut got = Vec::new();
    for uri in [
        "/api/sync/items/listen/l1/original",
        "/api/sync/items/document/d1/original",
        "/api/sync/items/photo/p1/original",
    ] {
        let (status, _, body) = app.send(post(uri, &mine)).await;
        assert_eq!(status, StatusCode::OK, "{uri}");
        got.push(body);
    }

    assert_eq!(
        got,
        [
            r#"{"url":"https://signed/users/u1/listens/l1/source.m4a?ttl=3600&download=Standup.m4a"}"#,
            r#"{"url":"https://signed/users/u1/documents/d1/source.pdf?ttl=3600&download=Power bill.pdf"}"#,
            r#"{"url":"https://signed/users/u1/photos/p1/original.png?ttl=3600&download=Stage.png"}"#,
        ]
    );
}

#[tokio::test]
async fn an_original_is_not_found_unless_it_is_the_owners_and_mirrored() {
    let app = app();
    let mine = app.cookie_for("u1");

    let not_found = r#"{"error":{"code":"NOT_FOUND","message":"no such item"}}"#;
    for uri in [
        "/api/sync/items/listen/l2/original",
        "/api/sync/items/listen/l3/original",
        "/api/sync/items/document/d2/original",
        "/api/sync/items/document/d3/original",
        "/api/sync/items/photo/p2/original",
        "/api/sync/items/photo/p9/original",
    ] {
        let (status, _, body) = app.send(post(uri, &mine)).await;
        assert_eq!(
            (status, body.as_str()),
            (StatusCode::NOT_FOUND, not_found),
            "{uri}"
        );
    }
    let (theirs, _, _) = app
        .send(post(
            "/api/sync/items/document/d1/original",
            &app.cookie_for("u2"),
        ))
        .await;
    let (bad_kind, _, _) = app
        .send(post("/api/sync/items/clip/c1/original", &mine))
        .await;
    let (signed_out, _, _) = app
        .send(
            Request::post("/api/sync/items/photo/p1/original")
                .body(Body::empty())
                .unwrap(),
        )
        .await;

    assert_eq!(theirs, StatusCode::NOT_FOUND);
    assert_eq!(bad_kind, StatusCode::BAD_REQUEST);
    assert_eq!(signed_out, StatusCode::UNAUTHORIZED);
}
