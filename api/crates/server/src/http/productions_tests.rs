//! The productions routes exist and refuse requests without a session; renaming a production.

use axum::http::StatusCode;
use nimbytes_testkit::studio_world::{production, shot};
use serde_json::Value;

use crate::http::test_support::{TestApp, get, post_json, put_json};

#[tokio::test]
async fn every_production_route_needs_a_session() {
    let app = TestApp::new();
    let requests = [
        get("/api/productions", None),
        post_json("/api/productions", None, "{}"),
        get("/api/productions/p1", None),
        get("/api/productions/p1/events", None),
        post_json("/api/productions/p1/coverage", None, "{}"),
        post_json("/api/productions/p1/retry", None, "{}"),
        post_json("/api/productions/p1/cut", None, "{}"),
        get("/api/shorts/x1/production", None),
        get("/api/shorts/x1/finish", None),
        get("/api/brand", None),
        get("/api/shorts/x1/exports", None),
        post_json("/api/shorts/x1/exports", None, "{}"),
        get("/api/shorts/x1/exports/events", None),
        post_json("/api/shorts/x1/exports/tiktok/covers", None, "{}"),
        post_json("/api/brand/uploads", None, "{}"),
        post_json("/api/shorts/x1/exports/tiktok/covers/0/redraw", None, "{}"),
        post_json("/api/productions/p1/shots/s1/board", None, "{}"),
        post_json("/api/productions/p1/art", None, "{}"),
        post_json("/api/productions/p1/art/cover", None, "{}"),
        post_json("/api/projects/p1/art", None, "{}"),
    ];

    for req in requests {
        let uri = req.uri().to_string();
        let (status, _, body) = app.send(req).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
        assert!(body.contains("UNAUTHORIZED"), "{uri}: {body}");
    }
}

fn code_of(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap();
    v["error"]["code"].as_str().unwrap_or_default().to_owned()
}

/// Production p1 of u1 with one shot.
fn renamable() -> TestApp {
    let app = TestApp::with_studio();
    app.productions
        .put(production("p1", "u1", None), vec![shot("a", 1, None)]);
    app
}

#[tokio::test]
async fn a_rename_replies_with_the_detail_and_the_new_title() {
    let app = renamable();
    let cookie = app.cookie_for("u1");
    let uri = "/api/productions/p1";

    let (status, _, body) = app
        .send(put_json(uri, &cookie, r#"{"title":"  Night   walk "}"#))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["production"]["title"], "Night walk");
    assert_eq!(v["shots"].as_array().map(Vec::len), Some(1));

    let (_, _, body) = app.send(get(uri, Some(&cookie))).await;
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["production"]["title"], "Night walk", "GET sees it");
}

#[tokio::test]
async fn a_bad_title_or_body_is_validation_failed() {
    let app = renamable();
    let cookie = app.cookie_for("u1");
    let long = format!(r#"{{"title":"{}"}}"#, "a".repeat(81));
    for json in [r#"{"title":"   "}"#, long.as_str(), r#"{"name":"x"}"#, "{}"] {
        let (status, _, body) = app
            .send(put_json("/api/productions/p1", &cookie, json))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{json}");
        assert_eq!(code_of(&body), "VALIDATION_FAILED", "{json}");
    }
}

#[tokio::test]
async fn only_the_owner_renames_an_existing_production() {
    let app = renamable();
    let (owner, other) = (app.cookie_for("u1"), app.cookie_for("u2"));
    let json = r#"{"title":"Mine"}"#;
    let cases = [
        (
            &other,
            "/api/productions/p1",
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
        ),
        (
            &owner,
            "/api/productions/zz",
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
        ),
    ];
    for (cookie, uri, status, code) in cases {
        let (got, _, body) = app.send(put_json(uri, cookie, json)).await;
        assert_eq!((got, code_of(&body).as_str()), (status, code), "{uri}");
    }
    let (_, _, body) = app.send(get("/api/productions/p1", Some(&owner))).await;
    assert!(body.contains("Beach day"), "nothing was stored: {body}");
}
