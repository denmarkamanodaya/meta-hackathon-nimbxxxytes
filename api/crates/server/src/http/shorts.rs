//! Shorts: create, read with Player props, save an edit, queue the final render, download it,
//! delete one.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::shorts::{
    AgentStep, CreateShortRequest, CreateShortResponse, DownloadResponse, RenderShortRequest,
    RenderShortResponse, SaveTimelineRequest, SaveTimelineResponse, ShortDetail, ShortListItem,
    ShortSegment, ShortSummary, ShortVersion,
};
use nimbytes_core::domain::agent::AgentBudget;
use nimbytes_core::domain::ids::{SegmentId, ShortId};
use nimbytes_core::domain::short::Step;
use nimbytes_core::usecases::shorts::{
    NewShort, SegmentCard, ShortView, VersionView, create_short, delete_short, download_url,
    list_shorts, request_render, save_timeline, short_detail,
};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `POST /api/shorts`.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<CreateShortRequest>,
) -> Result<Json<CreateShortResponse>, ApiError> {
    let segment_ids = body
        .segment_ids
        .into_iter()
        .map(SegmentId::parse)
        .collect::<Result<Vec<_>, _>>()?;
    let new = NewShort {
        prompt: body.prompt,
        segment_ids,
        aspect: body.aspect,
        target_s: body.target_s,
    };
    let id = create_short(&state.ports.short_deps(), &user, new).await?;
    Ok(Json(CreateShortResponse {
        short_id: id.to_string(),
    }))
}

/// `GET /api/shorts/{id}`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ShortDetail>, ApiError> {
    let id = ShortId::parse(id)?;
    let view = short_detail(&state.ports.short_deps(), &user, &id).await?;
    Ok(Json(detail_body(view)))
}

/// One log row as the wire shows it (also the SSE `data`).
pub(super) fn step_body(s: Step) -> AgentStep {
    AgentStep {
        seq: s.seq,
        kind: s.step.kind,
        tool: s.step.tool,
        version: s.step.version,
        summary: s.step.summary,
        at: s.step.at,
    }
}

fn version_body(v: VersionView) -> ShortVersion {
    ShortVersion {
        n: v.version.n,
        timeline: v.version.timeline,
        preview_url: v.preview_url,
        score_total: v.version.critique.as_ref().map(|c| f64::from(c.total)),
        critique: v.version.critique,
        composition_props: Some(v.props),
    }
}

fn segment_body(c: SegmentCard) -> ShortSegment {
    ShortSegment {
        segment_id: c.segment.segment_id.to_string(),
        clip_id: c.segment.clip_id.to_string(),
        start_s: c.segment.span.start_s,
        end_s: c.segment.span.end_s,
        thumb_url: Some(c.thumb_url),
        description: c.segment.description,
    }
}

fn detail_body(view: ShortView) -> ShortDetail {
    let s = view.short;
    ShortDetail {
        short: ShortSummary {
            short_id: s.id.to_string(),
            prompt: s.prompt,
            aspect: s.aspect,
            target_s: s.target_s,
            status: s.status,
            best_version: s.best_version,
            render_url: view.render_url,
        },
        versions: view.versions.into_iter().map(version_body).collect(),
        steps: view.steps.into_iter().map(step_body).collect(),
        segments: view.segments.into_iter().map(segment_body).collect(),
        max_drafts: AgentBudget::PRODUCTION.max_drafts(),
    }
}

/// `PUT /api/shorts/{id}/timeline`.
pub async fn save(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<SaveTimelineRequest>,
) -> Result<Json<SaveTimelineResponse>, ApiError> {
    let id = ShortId::parse(id)?;
    let version = save_timeline(&state.ports.short_deps(), &user, &id, body.timeline).await?;
    Ok(Json(SaveTimelineResponse { version }))
}

/// `POST /api/shorts/{id}/render`.
pub async fn render(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<RenderShortRequest>,
) -> Result<Json<RenderShortResponse>, ApiError> {
    let id = ShortId::parse(id)?;
    let job = request_render(&state.ports.short_deps(), &user, &id, body.version_n).await?;
    Ok(Json(RenderShortResponse {
        job_id: job.to_string(),
    }))
}

/// `GET /api/shorts/{id}/download`.
pub async fn download(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<DownloadResponse>, ApiError> {
    let id = ShortId::parse(id)?;
    let url = download_url(&state.ports.short_deps(), &user, &id).await?;
    Ok(Json(DownloadResponse { url }))
}

/// `DELETE /api/shorts/{id}`: removes the short, its jobs, rows and objects; never its clips.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = ShortId::parse(id)?;
    delete_short(&state.ports.short_deps(), &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/shorts`: the owner's shorts, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ShortListItem>>, ApiError> {
    let rows = list_shorts(&state.ports.short_deps(), &user).await?;
    Ok(Json(
        rows.into_iter()
            .map(|e| ShortListItem {
                short_id: e.short.id.to_string(),
                prompt: e.short.prompt,
                aspect: e.short.aspect,
                target_s: e.short.target_s,
                status: e.short.status,
                created_at: e.short.created_at,
                version_count: e.version_count,
                best_score: e.best_score,
                thumb_url: e.thumb_url,
                max_drafts: AgentBudget::PRODUCTION.max_drafts(),
            })
            .collect(),
    ))
}
