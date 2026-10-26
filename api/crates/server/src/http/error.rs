//! The one place an [`AppError`] becomes an HTTP status and the error envelope
//! `{ "error": { "code": "UPPER_SNAKE", "message": "…" } }`, the shape the web client parses.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use nimbytes_contracts::{ErrorBody, ErrorCode, ErrorEnvelope};
use nimbytes_core::AppError;

/// Handler error wrapper; converts into the wire error response.
#[derive(Debug)]
pub struct ApiError(pub AppError);

impl From<AppError> for ApiError {
    fn from(err: AppError) -> Self {
        Self(err)
    }
}

/// Maps each error code to its HTTP status.
pub fn status_for(code: ErrorCode) -> StatusCode {
    match code {
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        ErrorCode::Forbidden => StatusCode::FORBIDDEN,
        ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
        ErrorCode::ValidationFailed => StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::UploadIncomplete => StatusCode::CONFLICT,
        ErrorCode::ModelUnavailable => StatusCode::BAD_GATEWAY,
        ErrorCode::MediaFailed | ErrorCode::RenderFailed | ErrorCode::Internal => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let AppError { code, message } = self.0;
        let status = status_for(code);
        // INTERNAL never leaks its detail; the log keeps it.
        let message = if code == ErrorCode::Internal {
            tracing::error!(%message, "internal error");
            "internal error".to_owned()
        } else {
            message
        };
        (
            status,
            Json(ErrorEnvelope {
                error: ErrorBody { code, message },
            }),
        )
            .into_response()
    }
}

/// Router fallback: any unknown path answers `NOT_FOUND` in the error envelope.
pub async fn not_found() -> ApiError {
    ApiError(AppError::new(ErrorCode::NotFound, "no such route"))
}

#[cfg(test)]
mod tests {
    use axum::body::{Body, to_bytes};
    use axum::http::Request;
    use tower::ServiceExt;

    use super::*;
    use crate::http::router;

    async fn wire(err: AppError) -> (StatusCode, String) {
        let response = ApiError(err).into_response();
        let status = response.status();
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn forbidden_maps_to_403_with_the_exact_envelope() {
        let (status, body) = wire(AppError::new(ErrorCode::Forbidden, "not your clip")).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            body,
            r#"{"error":{"code":"FORBIDDEN","message":"not your clip"}}"#
        );
    }

    #[tokio::test]
    async fn validation_failed_maps_to_422() {
        let (status, body) = wire(AppError::new(ErrorCode::ValidationFailed, "bad size")).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            body,
            r#"{"error":{"code":"VALIDATION_FAILED","message":"bad size"}}"#
        );
    }

    #[tokio::test]
    async fn internal_hides_its_message_on_the_wire() {
        let (status, body) = wire(AppError::new(ErrorCode::Internal, "db path /data/x")).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body,
            r#"{"error":{"code":"INTERNAL","message":"internal error"}}"#
        );
    }

    #[test]
    fn every_code_has_a_status() {
        let table = [
            (ErrorCode::NotFound, 404),
            (ErrorCode::Forbidden, 403),
            (ErrorCode::Unauthorized, 401),
            (ErrorCode::ValidationFailed, 422),
            (ErrorCode::UploadIncomplete, 409),
            (ErrorCode::ModelUnavailable, 502),
            (ErrorCode::MediaFailed, 500),
            (ErrorCode::RenderFailed, 500),
            (ErrorCode::Internal, 500),
        ];
        for (code, status) in table {
            assert_eq!(status_for(code).as_u16(), status, "{code:?}");
        }
    }

    #[tokio::test]
    async fn unknown_route_returns_not_found_envelope() {
        let response = router()
            .oneshot(Request::get("/api/nope").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        assert_eq!(
            &body[..],
            br#"{"error":{"code":"NOT_FOUND","message":"no such route"}}"#
        );
    }
}
