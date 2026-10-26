//! Axum router and driving adapters (handlers). Handlers parse, call one use case, shape output.

mod auth;
mod clips;
pub mod error;
mod events;
mod health;
mod json;
mod session;
mod uploads;

use axum::Router;
use axum::routing::{get, post};

use crate::state::AppState;

pub use auth::CurrentUser;
pub use error::ApiError;

/// Builds the `/api` router over `state`.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .route("/api/session", post(session::create))
        .route("/api/uploads", post(uploads::create))
        .route("/api/uploads/{id}/parts", post(uploads::presign))
        .route("/api/uploads/{id}/complete", post(uploads::complete))
        .route("/api/clips", get(clips::list))
        .route("/api/clips/{id}", get(clips::detail))
        .route("/api/clips/{id}/events", get(events::clip_events))
        .fallback(error::not_found)
        .with_state(state)
}

#[cfg(test)]
mod clip_detail_tests;
#[cfg(test)]
mod handler_tests;
#[cfg(test)]
pub(crate) mod test_support;
