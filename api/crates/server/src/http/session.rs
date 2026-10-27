//! `POST /api/session`: passcode in, signed session cookie out. `GET /api/session`: is the
//! cookie still valid (the PWA asks before it draws any screen).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum_extra::extract::cookie::{Cookie, SameSite, SignedCookieJar};
use nimbytes_contracts::session::{SESSION_COOKIE, SessionRequest, SessionResponse};
use nimbytes_core::usecases::session::log_in;

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// Signs in the demo account and sets the `nb_session` cookie (HttpOnly, Secure, SameSite=Lax).
pub async fn create(
    State(state): State<AppState>,
    jar: SignedCookieJar,
    ApiJson(body): ApiJson<SessionRequest>,
) -> Result<(SignedCookieJar, Json<SessionResponse>), ApiError> {
    let user = log_in(&state.ports.session_deps(), &body.passcode).await?;
    let cookie = Cookie::build((SESSION_COOKIE, user.to_string()))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Lax)
        .path("/")
        .permanent();
    Ok((
        jar.add(cookie),
        Json(SessionResponse {
            user_id: user.to_string(),
        }),
    ))
}

/// `GET /api/session`: 200 with the user id while the cookie is valid; the [`CurrentUser`]
/// extractor answers 401 otherwise.
pub async fn current(CurrentUser(user): CurrentUser) -> Json<SessionResponse> {
    Json(SessionResponse {
        user_id: user.to_string(),
    })
}

/// `POST /api/session/logout`: clears the cookie; 204 whether or not one was set.
pub async fn logout(jar: SignedCookieJar) -> (SignedCookieJar, StatusCode) {
    (
        jar.remove(Cookie::build(SESSION_COOKIE).path("/")),
        StatusCode::NO_CONTENT,
    )
}
