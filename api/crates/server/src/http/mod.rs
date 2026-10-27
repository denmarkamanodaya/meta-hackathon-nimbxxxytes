//! Axum router and driving adapters (handlers). Handlers parse, call one use case, shape output.

mod auth;
mod clips;
pub mod error;
mod events;
mod health;
mod json;
mod people;
mod search;
mod session;
mod settings;
mod short_events;
mod shorts;
mod storage;
mod uploads;

use axum::Router;
use axum::routing::{get, post, put};

use crate::state::AppState;

pub use auth::CurrentUser;
pub use error::ApiError;

/// Builds the `/api` router over `state`.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .route("/api/session", get(session::current).post(session::create))
        .route("/api/session/logout", post(session::logout))
        .route("/api/search", post(search::run))
        .route("/api/people", get(people::list))
        .route("/api/people/overview", get(people::overview))
        .route("/api/storage", get(storage::summary))
        .route("/api/tracks/name", post(people::name_many))
        .route("/api/tracks/{id}", put(people::update_track))
        .route("/api/settings", get(settings::get).put(settings::put))
        .route("/api/speakers/{id}", put(people::update_speaker))
        .route("/api/costs", get(people::costs))
        .route("/api/shorts", get(shorts::list).post(shorts::create))
        .route("/api/shorts/{id}", get(shorts::detail))
        .route("/api/shorts/{id}/events", get(short_events::short_events))
        .route("/api/shorts/{id}/timeline", put(shorts::save))
        .route("/api/shorts/{id}/render", post(shorts::render))
        .route("/api/shorts/{id}/download", get(shorts::download))
        .route("/api/uploads", post(uploads::create))
        .route("/api/uploads/check", post(uploads::check))
        .route("/api/uploads/{id}/parts", post(uploads::presign))
        .route("/api/uploads/{id}/complete", post(uploads::complete))
        .route("/api/clips", get(clips::list))
        .route("/api/clips/{id}", get(clips::detail).delete(clips::remove))
        .route("/api/clips/{id}/events", get(events::clip_events))
        .fallback(error::not_found)
        .with_state(state)
}

#[cfg(test)]
mod clip_detail_tests;
#[cfg(test)]
mod duplicates_tests;
#[cfg(test)]
mod face_matching_tests;
#[cfg(test)]
mod handler_tests;
#[cfg(test)]
mod redesign_tests;
#[cfg(test)]
mod search_people_tests;
#[cfg(test)]
mod shorts_tests;
#[cfg(test)]
pub(crate) mod test_support;
