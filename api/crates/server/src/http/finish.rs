//! `GET/PUT /api/shorts/{id}/finish`: a short's finish settings (privacy blur, titles, effect).

use axum::Json;
use axum::extract::{Path, State};
use nimbytes_contracts::finish::ShortFinishBody;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::privacy::ShortFinish;
use nimbytes_core::usecases::shorts::{short_finish, update_finish};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

fn body(f: ShortFinish) -> ShortFinishBody {
    ShortFinishBody {
        blur_bystanders: f.blur_bystanders,
        title_text: f.title_text,
        speaker_colors: f.speaker_colors,
        effect: f.effect,
    }
}

/// `GET /api/shorts/{id}/finish`: the saved finish, or the defaults.
pub async fn get(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ShortFinishBody>, ApiError> {
    let id = ShortId::parse(id)?;
    let f = short_finish(&state.ports.short_deps(), &user, &id).await?;
    Ok(Json(body(f)))
}

/// `PUT /api/shorts/{id}/finish`: saves the finish; previews and renders made after follow it.
pub async fn put(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(b): ApiJson<ShortFinishBody>,
) -> Result<Json<ShortFinishBody>, ApiError> {
    let id = ShortId::parse(id)?;
    let finish = ShortFinish {
        blur_bystanders: b.blur_bystanders,
        title_text: b.title_text,
        speaker_colors: b.speaker_colors,
        effect: b.effect,
    };
    let f = update_finish(&state.ports.short_deps(), &user, &id, finish).await?;
    Ok(Json(body(f)))
}
