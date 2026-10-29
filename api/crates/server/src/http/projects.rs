//! Projects: list, create, rename or recolour, delete, add and remove clips, and draw new key
//! art. A project that reaches 3 clips gets its first key art on its own.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::projects::{
    AddProjectClipsRequest, ArtSource, CreateProjectRequest, Project, UpdateProjectRequest,
};
use nimbytes_contracts::runs::StartedResponse;
use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ClipId, ProjectId};
use nimbytes_core::usecases::projects::{
    NewProject, ProjectEdit, ProjectView, add_project_clips, create_project, delete_project,
    list_projects, remove_project_clip, update_project,
};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

fn wire(v: ProjectView, state: &AppState) -> Project {
    let (s, p) = (v.summary.clone(), v.summary.project);
    Project {
        art_drawing: state.art.is_drawing(&p.id),
        project_id: p.id.to_string(),
        name: p.name,
        color: p.color.as_str().to_owned(),
        clip_count: s.clip_count,
        duration_s: s.duration_s,
        size_bytes: s.size_bytes,
        created_at: p.created_at,
        art_url: v.art_url,
        art_sources: v
            .art_sources
            .into_iter()
            .map(|(a, thumb_url)| ArtSource {
                clip_id: a.clip_id.to_string(),
                clip_title: a.clip_title,
                title: a.title,
                start_s: a.start_s,
                thumb_url,
            })
            .collect(),
    }
}

fn clip_ids(raw: Vec<String>) -> Result<Vec<ClipId>, AppError> {
    raw.into_iter().map(ClipId::parse).collect()
}

/// `GET /api/projects`: the owner's projects, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<Project>>, ApiError> {
    let rows = list_projects(&state.ports.project_deps(), &user).await?;
    Ok(Json(rows.into_iter().map(|v| wire(v, &state)).collect()))
}

/// `POST /api/projects`.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<CreateProjectRequest>,
) -> Result<Json<Project>, ApiError> {
    let new = NewProject {
        name: body.name,
        color: body.color,
        clip_ids: clip_ids(body.clip_ids)?,
    };
    let created = create_project(&state.ports.project_deps(), &user, new).await?;
    state.art.auto_draw(&created.summary.project.id).await;
    Ok(Json(wire(created, &state)))
}

/// `PATCH /api/projects/{id}`.
pub async fn update(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<UpdateProjectRequest>,
) -> Result<Json<Project>, ApiError> {
    let id = ProjectId::parse(id)?;
    let edit = ProjectEdit {
        name: body.name,
        color: body.color,
    };
    let updated = update_project(&state.ports.project_deps(), &user, &id, edit).await?;
    Ok(Json(wire(updated, &state)))
}

/// `DELETE /api/projects/{id}`: the clips stay.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = ProjectId::parse(id)?;
    delete_project(&state.ports.project_deps(), &user, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/projects/{id}/clips`.
pub async fn add_clips(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<AddProjectClipsRequest>,
) -> Result<Json<Project>, ApiError> {
    let id = ProjectId::parse(id)?;
    let clips = clip_ids(body.clip_ids)?;
    let added = add_project_clips(&state.ports.project_deps(), &user, &id, &clips).await?;
    state.art.auto_draw(&id).await;
    Ok(Json(wire(added, &state)))
}

/// `DELETE /api/projects/{id}/clips/{clip_id}`.
pub async fn remove_clip(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, clip)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let (id, clip) = (ProjectId::parse(id)?, ClipId::parse(clip)?);
    remove_project_clip(&state.ports.project_deps(), &user, &id, &clip).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/projects/{id}/art`: draws new key art in the background (`started` is false while
/// art is already being drawn).
pub async fn art(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<StartedResponse>), ApiError> {
    let id = ProjectId::parse(id)?;
    let started = state.art.redraw(&user, &id).await?;
    Ok((StatusCode::ACCEPTED, Json(StartedResponse { started })))
}
