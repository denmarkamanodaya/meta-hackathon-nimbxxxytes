//! `GET /api/health`.

use axum::Json;
use nimbytes_contracts::HealthResponse;

/// Answers `{ "ok": true }` while the process can serve requests.
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

#[cfg(test)]
mod tests {
    use axum::http::{StatusCode, header};

    use crate::http::test_support::{TestApp, get};

    #[tokio::test]
    async fn health_returns_ok_true_as_json_without_a_session() {
        let (status, headers, body) = TestApp::new().send(get("/api/health", None)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[header::CONTENT_TYPE], "application/json");
        assert_eq!(body, r#"{"ok":true}"#);
    }
}
