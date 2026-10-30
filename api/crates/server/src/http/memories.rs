//! Memory Lane: `POST /api/memories` (201), `GET /api/memories`, `GET /api/memories/{id}` and
//! `DELETE /api/memories/{id}` (204).

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::memories::{
    CreateMemoryRequest, CreateMemoryResponse, MemoryDetail, MemoryMoment, MemoryPerson,
    MemorySummary,
};
use nimbytes_core::domain::ids::MemoryId;
use nimbytes_core::usecases::memories::{
    MemoryDetailView, MemoryStart, MemoryView, MomentView, create_memory, delete_memory,
    get_memory, list_memories,
};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `POST /api/memories`: a session about one person or one clip, made in the background.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(b): ApiJson<CreateMemoryRequest>,
) -> Result<(StatusCode, Json<CreateMemoryResponse>), ApiError> {
    let start = MemoryStart {
        person_id: b.person_id,
        clip_id: b.clip_id,
        viewer_id: b.viewer_id,
    };
    let made = create_memory(&state.memories, &user, start).await?;
    let body = CreateMemoryResponse {
        memory_id: made.id.into(),
        status: made.status.as_str().to_owned(),
    };
    Ok((StatusCode::CREATED, Json(body)))
}

/// `GET /api/memories`, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<MemorySummary>>, ApiError> {
    let rows = list_memories(&state.memories, &user).await?;
    Ok(Json(rows.into_iter().map(summary_body).collect()))
}

/// `GET /api/memories/{id}`: the session with its moments.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<MemoryDetail>, ApiError> {
    let id = MemoryId::parse(id)?;
    let view = get_memory(&state.memories, &user, &id).await?;
    Ok(Json(detail_body(view)))
}

/// `DELETE /api/memories/{id}`: the session, its cover and frames.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = MemoryId::parse(id)?;
    delete_memory(&state.memories, &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}

fn summary_body(v: MemoryView) -> MemorySummary {
    let m = v.memory;
    MemorySummary {
        id: m.id.into(),
        title: m.title,
        subject_kind: m.subject_kind.as_str().to_owned(),
        subject_name: m.subject_name,
        viewer_name: m.viewer_name,
        status: m.status.as_str().to_owned(),
        step: m.step,
        moment_count: u32::try_from(m.moments.len()).unwrap_or(u32::MAX),
        fixed_count: m.fixed_count,
        cover_url: v.cover_url,
        created_at: m.created_at,
        error: m.error,
    }
}

fn moment_body(v: MomentView) -> MemoryMoment {
    let m = v.moment;
    let people = m
        .people
        .into_iter()
        .zip(v.crop_urls)
        .map(|(p, crop_url)| MemoryPerson {
            person_id: p.person_id.map(String::from).unwrap_or_default(),
            name: p.name,
            crop_url,
        })
        .collect();
    MemoryMoment {
        index: m.index,
        clip_id: m.clip_id.into(),
        clip_title: m.clip_title,
        recorded_at: m.recorded_at,
        start_s: m.start_s,
        end_s: m.end_s,
        proxy_url: v.proxy_url,
        thumb_url: v.thumb_url,
        people,
        line: m.line,
        prompt: m.prompt,
        checked: m.checked,
        fixed_note: m.fixed_note,
    }
}

fn detail_body(v: MemoryDetailView) -> MemoryDetail {
    MemoryDetail {
        summary: summary_body(v.view),
        moments: v.moments.into_iter().map(moment_body).collect(),
    }
}
