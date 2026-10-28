//! The productions routes exist and refuse requests without a session.

use axum::http::StatusCode;

use crate::http::test_support::{TestApp, get, post_json};

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
