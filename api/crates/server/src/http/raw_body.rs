//! Raw request bodies (a recording, a document's file): the extractor's rejection as a typed
//! `VALIDATION_FAILED`, naming the limit when the body is too large.

use axum::body::Bytes;
use axum::extract::rejection::BytesRejection;
use axum::http::StatusCode;
use nimbytes_core::{AppError, ErrorCode};

/// The body, or `VALIDATION_FAILED` with `too_large` for a body over the route's limit and the
/// extractor's own text otherwise.
///
/// # Errors
/// `VALIDATION_FAILED` when the body could not be read.
pub fn raw_body(body: Result<Bytes, BytesRejection>, too_large: &str) -> Result<Bytes, AppError> {
    body.map_err(|e| {
        let msg = if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            too_large.to_owned()
        } else {
            e.body_text()
        };
        AppError::new(ErrorCode::ValidationFailed, msg)
    })
}
