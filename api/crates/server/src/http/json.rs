//! JSON body extractor whose rejection is the standard `VALIDATION_FAILED` envelope instead of
//! axum's plain-text error. As `Option<ApiJson<T>>` the body may be left out (an empty body,
//! whatever its content type, is no body).

use axum::Json;
use axum::body::Bytes;
use axum::extract::{FromRequest, OptionalFromRequest, Request};
use nimbytes_core::{AppError, ErrorCode};
use serde::de::DeserializeOwned;

use super::ApiError;

/// `Json<T>` with the API's error body on a missing or malformed body.
pub struct ApiJson<T>(pub T);

fn malformed(msg: impl Into<String>) -> ApiError {
    ApiError(AppError::new(ErrorCode::ValidationFailed, msg.into()))
}

impl<T, S> OptionalFromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Option<Self>, ApiError> {
        let bytes = Bytes::from_request(req, state)
            .await
            .map_err(|e| malformed(e.body_text()))?;
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(None);
        }
        Json::<T>::from_bytes(&bytes)
            .map(|Json(value)| Some(Self(value)))
            .map_err(|e| malformed(e.body_text()))
    }
}

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, ApiError> {
        <Json<T> as FromRequest<S>>::from_request(req, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|rejection| {
                ApiError(AppError::new(
                    ErrorCode::ValidationFailed,
                    rejection.body_text(),
                ))
            })
    }
}
