//! `GET /api/health`.

use axum::Json;
use nimbytes_contracts::HealthResponse;

/// Answers `{ "ok": true }` while the process can serve requests.
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

#[cfg(test)]
mod tests {
    use axum::body::{Body, to_bytes};
    use axum::http::{Request, StatusCode, header};
    use tower::ServiceExt;

    use crate::http::router;

    #[tokio::test]
    async fn health_returns_ok_true_as_json() {
        let response = router()
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(&body[..], br#"{"ok":true}"#);
    }
}
