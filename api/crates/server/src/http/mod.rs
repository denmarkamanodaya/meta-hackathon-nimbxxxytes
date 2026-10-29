//! Axum router and driving adapters (handlers). Handlers parse, call one use case, shape output.

mod ask;
mod auth;
mod brand;
mod clips;
mod documents;
pub mod error;
mod events;
mod exports;
mod finish;
mod guides;
mod health;
mod json;
mod people;
mod projects;
mod search;
mod search_stream;
mod session;
mod settings;
mod short_events;
mod shorts;
mod storage;
mod subjects;
mod sync;
mod uploads;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, patch, post, put};

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
        .route("/api/search/stream", post(search_stream::stream))
        .route("/api/people", get(people::list))
        .route("/api/people/overview", get(people::overview))
        .route("/api/storage", get(storage::summary))
        .route("/api/tracks/name", post(people::name_many))
        .route("/api/tracks/{id}", put(people::update_track))
        .route("/api/settings", get(settings::get).put(settings::put))
        .route("/api/speakers/{id}", put(people::update_speaker))
        .route("/api/costs", get(people::costs))
        .route("/api/shorts", get(shorts::list).post(shorts::create))
        .route(
            "/api/shorts/{id}",
            get(shorts::detail).delete(shorts::remove),
        )
        .route("/api/shorts/{id}/events", get(short_events::short_events))
        .route("/api/shorts/{id}/timeline", put(shorts::save))
        .route("/api/shorts/{id}/render", post(shorts::render))
        .route("/api/shorts/{id}/download", get(shorts::download))
        .merge(subject_routes())
        .merge(publish_routes())
        .merge(project_routes())
        .merge(feature_routes())
        .route("/api/uploads", post(uploads::create))
        .route("/api/uploads/check", post(uploads::check))
        .route("/api/uploads/{id}/parts", post(uploads::presign))
        .route("/api/uploads/{id}/proxy", post(uploads::proxy))
        .route("/api/uploads/{id}/complete", post(uploads::complete))
        .route("/api/clips", get(clips::list))
        .route("/api/clips/{id}", get(clips::detail).delete(clips::remove))
        .route("/api/clips/{id}/events", get(events::clip_events))
        .route("/api/clips/{id}/keep", post(clips::keep))
        .route("/api/sync/manifest", get(sync::manifest))
        .route("/api/sync/clips/{id}/original", post(sync::original))
        .fallback(error::not_found)
        .with_state(state)
}

/// The SAM routes: keep subject in frame, Find this and Cut out.
fn subject_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/shorts/{id}/reframe",
            get(subjects::status).post(subjects::start),
        )
        .route("/api/clips/{id}/find", post(subjects::find))
        .route("/api/clips/{id}/cutout", post(subjects::cutout))
}

/// The MyWay routes: make, read, edit and delete guides.
fn guide_routes() -> Router<AppState> {
    Router::new()
        .route("/api/clips/{id}/guide", post(guides::start))
        .route("/api/guides", get(guides::list))
        .route(
            "/api/guides/{id}",
            get(guides::detail)
                .patch(guides::rename)
                .delete(guides::remove),
        )
        .route("/api/guides/{id}/steps/{n}", patch(guides::patch_step))
}

/// The Features (iGuide, iRead) and the ask box that runs them.
fn feature_routes() -> Router<AppState> {
    guide_routes().merge(document_routes()).merge(ask_routes())
}

/// The iRead routes: upload, read, ask, read aloud, rename and delete documents.
fn document_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/documents",
            get(documents::list).post(documents::create),
        )
        .route(
            "/api/documents/{id}",
            get(documents::detail)
                .patch(documents::rename)
                .delete(documents::remove),
        )
        .route("/api/documents/{id}/complete", post(documents::complete))
        .route("/api/documents/{id}/ask", post(documents::ask))
        .route("/api/documents/{id}/speak", post(documents::speak))
}

/// The ask box routes; only the voice route takes a body larger than the default 2 MB.
fn ask_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/transcribe",
            post(ask::transcribe).layer(DefaultBodyLimit::max(ask::TRANSCRIBE_BODY_LIMIT)),
        )
        .route("/api/intents", post(ask::intents))
}

/// The project routes.
fn project_routes() -> Router<AppState> {
    Router::new()
        .route("/api/projects", get(projects::list).post(projects::create))
        .route(
            "/api/projects/{id}",
            patch(projects::update).delete(projects::remove),
        )
        .route("/api/projects/{id}/clips", post(projects::add_clips))
        .route("/api/projects/{id}/art", post(projects::art))
        .route(
            "/api/projects/{id}/clips/{clip_id}",
            delete(projects::remove_clip),
        )
}

/// The finish, brand and publish (exports and covers) routes.
fn publish_routes() -> Router<AppState> {
    Router::new()
        .route("/api/shorts/{id}/finish", get(finish::get).put(finish::put))
        .route("/api/brand", get(brand::get).put(brand::put))
        .route("/api/brand/uploads", post(brand::upload))
        .route(
            "/api/shorts/{id}/exports",
            get(exports::list).post(exports::create),
        )
        .route("/api/shorts/{id}/exports/events", get(exports::events))
        .route("/api/shorts/{id}/exports/{platform}", put(exports::edit))
        .route(
            "/api/shorts/{id}/exports/{platform}/covers",
            post(exports::covers),
        )
        .route(
            "/api/shorts/{id}/exports/{platform}/covers/{n}/redraw",
            post(exports::redraw),
        )
}

#[cfg(test)]
mod ask_tests;
#[cfg(test)]
mod clip_detail_tests;
#[cfg(test)]
mod documents_tests;
#[cfg(test)]
mod duplicates_tests;
#[cfg(test)]
mod face_matching_tests;
#[cfg(test)]
mod guides_tests;
#[cfg(test)]
mod handler_tests;
#[cfg(test)]
mod muse_image_tests;
#[cfg(test)]
mod redesign_tests;
#[cfg(test)]
mod removed_routes_tests;
#[cfg(test)]
mod search_people_tests;
#[cfg(test)]
mod shorts_tests;
#[cfg(test)]
mod similar_tests;
#[cfg(test)]
mod subjects_tests;
#[cfg(test)]
mod sync_tests;
#[cfg(test)]
pub(crate) mod test_support;
