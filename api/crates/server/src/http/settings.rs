//! `GET` / `PUT /api/settings`.

use axum::Json;
use axum::extract::State;
use nimbytes_contracts::settings::Settings;
use nimbytes_core::usecases::face_matching::set_face_matching;

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `GET /api/settings`.
pub async fn get(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Settings>, ApiError> {
    let face_matching = state.ports.faces.matching(&user).await?;
    let blur_objects = state.ports.subjects.store.blur_objects(&user).await?;
    Ok(Json(Settings {
        face_matching,
        blur_objects,
    }))
}

/// `PUT /api/settings`.
pub async fn put(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<Settings>,
) -> Result<Json<Settings>, ApiError> {
    let face_matching =
        set_face_matching(&state.ports.settings_deps(), &user, body.face_matching).await?;
    let store = &state.ports.subjects.store;
    store.set_blur_objects(&user, body.blur_objects).await?;
    let blur_objects = store.blur_objects(&user).await?;
    Ok(Json(Settings {
        face_matching,
        blur_objects,
    }))
}
