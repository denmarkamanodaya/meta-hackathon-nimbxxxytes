//! The Production Studio routes are gone: a signed-in owner gets the router's `NOT_FOUND` for
//! each of them, while the shorts list keeps answering.

use axum::http::StatusCode;

use super::muse_image_tests::code_of;
use super::test_support::{TestApp, get, post_json};

#[tokio::test]
async fn the_production_routes_answer_not_found() {
    let app = TestApp::new();
    let cookie = app.cookie_for("u1");
    let create = r#"{"brief":"Beach","format":"story","aspect":"4:5","target_s":60}"#;
    for (what, req) in [
        ("list", get("/api/productions", Some(&cookie))),
        (
            "create",
            post_json("/api/productions", Some(&cookie), create),
        ),
        ("detail", get("/api/productions/p1", Some(&cookie))),
        ("of short", get("/api/shorts/x1/production", Some(&cookie))),
    ] {
        let (status, _, body) = app.send(req).await;
        assert_eq!(
            (status, code_of(&body).as_str()),
            (StatusCode::NOT_FOUND, "NOT_FOUND"),
            "{what}"
        );
    }
    let (status, _, body) = app.send(get("/api/shorts", Some(&cookie))).await;
    assert_eq!((status, body.as_str()), (StatusCode::OK, "[]"));
}
