//! `POST /api/session`: passcode in, signed session cookie out.

use axum::Json;
use axum::extract::State;
use axum_extra::extract::cookie::{Cookie, SameSite, SignedCookieJar};
use nimbytes_contracts::session::{SESSION_COOKIE, SessionRequest, SessionResponse};
use nimbytes_core::usecases::session::log_in;

use super::ApiError;
use super::json::ApiJson;
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
