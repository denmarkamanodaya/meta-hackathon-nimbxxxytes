//! JSON body extractor whose rejection is the standard `VALIDATION_FAILED` envelope instead of
//! axum's plain-text error.

use axum::Json;
use axum::extract::{FromRequest, Request};
use nimbytes_core::{AppError, ErrorCode};
use serde::de::DeserializeOwned;

use super::ApiError;

/// `Json<T>` with the API's error body on a missing or malformed body.
pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, ApiError> {
        Json::<T>::from_request(req, state)
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
