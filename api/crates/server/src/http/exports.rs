//! Publishing a short: start its exports, read them, edit one platform, ask for more covers, and
//! watch the run over Server-Sent Events.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;
use nimbytes_contracts::exports::{
    CreateExportsRequest, EditExportRequest, ExportEvent, ExportItem, ExportsResponse,
};
use nimbytes_contracts::productions::StartedResponse;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::job::StepStatus;
use nimbytes_core::domain::production::{Platform, is_last_event};
use nimbytes_core::usecases::exports::{ExportEdit, ExportView, edit_export, list_exports, step};
use nimbytes_core::usecases::shorts::short_steps;

use super::events::subject_stream;
use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::progress::StepEvent;
use crate::state::AppState;

fn started() -> (StatusCode, Json<StartedResponse>) {
    (
        StatusCode::ACCEPTED,
        Json(StartedResponse { started: true }),
    )
}

/// `POST /api/shorts/{id}/exports`: captions, covers and renders for the platforms, in the
/// background.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<CreateExportsRequest>,
) -> Result<(StatusCode, Json<StartedResponse>), ApiError> {
    let id = ShortId::parse(id)?;
    state.publisher.publish(&user, &id, &body.platforms).await?;
    Ok(started())
}

fn item(v: ExportView) -> ExportItem {
    let e = v.export;
    ExportItem {
        platform: e.platform,
        aspect: e.aspect,
        version_n: e.version_n,
        status: e.status,
        render_url: v.render_url,
        caption: e.caption,
        caption_limit: u32::try_from(v.caption_limit).unwrap_or(u32::MAX),
        hashtags: e.hashtags,
        cover_urls: v.cover_urls,
        cover_pick: e.cover_pick,
        updated_at: e.updated_at,
    }
}

/// `GET /api/shorts/{id}/exports`.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ExportsResponse>, ApiError> {
    let id = ShortId::parse(id)?;
    let views = list_exports(&state.publisher.deps(), &user, &id).await?;
    Ok(Json(ExportsResponse {
        exports: views.into_iter().map(item).collect(),
        busy: state.publisher.is_busy(&id),
    }))
}

/// `PUT /api/shorts/{id}/exports/{platform}`.
pub async fn edit(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, platform)): Path<(String, String)>,
    ApiJson(body): ApiJson<EditExportRequest>,
) -> Result<StatusCode, ApiError> {
    let id = ShortId::parse(id)?;
    let platform = Platform::parse(&platform)?;
    let change = ExportEdit {
        caption: body.caption,
        hashtags: body.hashtags,
        cover_pick: body.cover_pick,
    };
    edit_export(&state.publisher.deps(), &user, (&id, platform), change).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/shorts/{id}/exports/{platform}/covers`: 3 more covers, in the background.
pub async fn covers(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, platform)): Path<(String, String)>,
) -> Result<(StatusCode, Json<StartedResponse>), ApiError> {
    let id = ShortId::parse(id)?;
    let platform = Platform::parse(&platform)?;
    state.publisher.covers(&user, &id, platform).await?;
    Ok(started())
}

fn export_event(e: StepEvent) -> ExportEvent {
    ExportEvent {
        step: e.step,
        status: e.status,
    }
}

fn is_last(e: &ExportEvent) -> bool {
    is_last_event(&e.step, e.status)
}

/// `GET /api/shorts/{id}/exports/events`: the steps of the short's publish or cover run; the
/// first event is the current state, and the stream ends after `done` or a failed step.
pub async fn events(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, axum::Error>>>, ApiError> {
    let id = ShortId::parse(id)?;
    // Subscribe before checking, so no step between the two is lost.
    let rx = state.progress.subscribe();
    short_steps(state.ports.shorts.as_ref(), &user, &id).await?;
    let first = if state.publisher.is_busy(&id) {
        (step::EXPORTS, StepStatus::Running)
    } else {
        (step::DONE, StepStatus::Done)
    };
    let first = ExportEvent {
        step: first.0.to_owned(),
        status: first.1,
    };
    let stream = subject_stream(id.to_string(), Some(first), rx, (export_event, is_last));
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
