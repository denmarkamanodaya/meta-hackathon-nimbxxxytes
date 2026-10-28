//! MyWay: `POST /api/clips/{id}/guide` (202), `GET /api/guides`, `GET/DELETE /api/guides/{id}`
//! and `PATCH /api/guides/{id}/steps/{n}`.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::guides::{
    GuideResponse, GuideSummary, Highlight, StartGuideResponse, Step, StepPatch,
};
use nimbytes_core::domain::ids::{ClipId, GuideId};
use nimbytes_core::usecases::guides::{
    GuideSummaryView, GuideView, StepEdit, StepView, delete_guide, edit_step, get_guide,
    list_guides, start_guide,
};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `POST /api/clips/{id}/guide`: starts the clip's guide (or answers the one it has).
pub async fn start(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<StartGuideResponse>), ApiError> {
    let id = ClipId::parse(id)?;
    let started = start_guide(&state.guides, &user, &id).await?;
    let body = StartGuideResponse {
        guide_id: started.guide_id.as_str().to_owned(),
        status: started.status.as_str().to_owned(),
    };
    Ok((StatusCode::ACCEPTED, Json(body)))
}

/// `GET /api/guides`.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<GuideSummary>>, ApiError> {
    let rows = list_guides(&state.guides, &user).await?;
    Ok(Json(rows.into_iter().map(summary_body).collect()))
}

fn summary_body(v: GuideSummaryView) -> GuideSummary {
    let g = v.guide;
    GuideSummary {
        id: g.id.as_str().to_owned(),
        clip_id: g.clip_id.as_str().to_owned(),
        title: g.title,
        status: g.status.as_str().to_owned(),
        stage: g.stage.map(|s| s.as_str().to_owned()),
        error: g.error,
        clip_title: v.clip.title,
        clip_duration_s: v.clip.duration_s,
        step_count: v.step_count,
        cover_url: v.cover_url,
        created_at: g.created_at,
    }
}

/// `GET /api/guides/{id}`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<GuideResponse>, ApiError> {
    let id = GuideId::parse(id)?;
    let view = get_guide(&state.guides, &user, &id).await?;
    Ok(Json(guide_body(view)))
}

fn guide_body(v: GuideView) -> GuideResponse {
    let g = v.guide;
    GuideResponse {
        id: g.id.as_str().to_owned(),
        clip_id: g.clip_id.as_str().to_owned(),
        title: g.title,
        status: g.status.as_str().to_owned(),
        stage: g.stage.map(|s| s.as_str().to_owned()),
        error: g.error,
        safety: g.safety.map(|s| s.as_str().to_owned()),
        safety_reason: v.safety_reason,
        clip_title: v.clip.title,
        clip_duration_s: v.clip.duration_s,
        language: g.language,
        steps: v.steps.into_iter().map(step_body).collect(),
    }
}

fn step_body(s: StepView) -> Step {
    Step {
        n: s.n,
        title: s.title,
        instruction: s.instruction,
        start_s: s.start_s,
        end_s: s.end_s,
        key_s: s.key_s,
        image_url: s.image_url,
        audio_url: s.audio_url,
        clip_url: s.clip_url,
        highlight: s.highlight.map(|label| Highlight { label }),
    }
}

/// `PATCH /api/guides/{id}/steps/{n}`.
pub async fn patch_step(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path((id, n)): Path<(String, u32)>,
    ApiJson(body): ApiJson<StepPatch>,
) -> Result<Json<Step>, ApiError> {
    let id = GuideId::parse(id)?;
    let edit = StepEdit {
        title: body.title.as_deref(),
        instruction: body.instruction.as_deref(),
    };
    let step = edit_step(&state.guides, &user, (&id, n), edit).await?;
    state.ports.usage_refresh.poke();
    Ok(Json(step_body(step)))
}

/// `DELETE /api/guides/{id}`: 204.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = GuideId::parse(id)?;
    delete_guide(&state.guides, &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}
