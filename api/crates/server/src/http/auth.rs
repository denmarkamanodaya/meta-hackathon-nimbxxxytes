//! Session extractor: every handler that takes [`CurrentUser`] answers `401 UNAUTHORIZED` unless
//! the request carries a validly signed session cookie.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum_extra::extract::cookie::SignedCookieJar;
use nimbytes_contracts::session::SESSION_COOKIE;
use nimbytes_core::domain::ids::UserId;
use nimbytes_core::{AppError, ErrorCode};

use super::ApiError;
use crate::state::AppState;

/// The signed-in user, read from the signed `nb_session` cookie.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentUser(pub UserId);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let jar = SignedCookieJar::from_headers(&parts.headers, state.cookie_key.clone());
        let unauthorized = || ApiError(AppError::new(ErrorCode::Unauthorized, "sign in first"));
        let cookie = jar.get(SESSION_COOKIE).ok_or_else(unauthorized)?;
        UserId::parse(cookie.value())
            .map(Self)
            .map_err(|_| unauthorized())
    }
}
