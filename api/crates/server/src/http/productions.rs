//! Productions: list, create (starts the plan), read (starts a coverage check when one is due),
//! recheck coverage, resume a failed plan, cut the story, delete; and a story short's production.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::productions::{
    ActShot, CreateProductionRequest, CreateProductionResponse, CutResponse, ProductionDetail,
    ProductionListItem, ProductionShot, ProductionSummary, ShortProduction, ShotMatch,
    StartedResponse,
};
use nimbytes_core::domain::ids::{ProductionId, ShortId};
use nimbytes_core::domain::production::{NewProduction, Production};
use nimbytes_core::usecases::productions::{
    ProductionView, ShotView, coverage_requested, create_production, delete_production,
    list_productions, production_detail, short_production,
};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// `GET /api/productions`: the owner's productions, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ProductionListItem>>, ApiError> {
    let rows = list_productions(&state.studio.deps(), &user).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                let p = r.production;
                ProductionListItem {
                    production_id: p.id.to_string(),
                    title: p.title,
                    format: p.format,
                    aspect: p.aspect,
                    target_s: p.target_s,
                    status: p.status,
                    shot_count: count(r.shot_count),
                    covered_count: count(r.covered),
                    missing_titles: r.missing,
                    cover_url: r.cover_url,
                    created_at: p.created_at,
                }
            })
            .collect(),
    ))
}

/// `POST /api/productions`: stores the production and starts planning it.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<CreateProductionRequest>,
) -> Result<Json<CreateProductionResponse>, ApiError> {
    let new = NewProduction {
        brief: body.brief,
        format: body.format,
        aspect: body.aspect,
        target_s: body.target_s,
        blur_bystanders: body.blur_bystanders,
    };
    let id = create_production(&state.studio.deps(), &user, new).await?;
    state.studio.start_plan(&id);
    Ok(Json(CreateProductionResponse {
        production_id: id.to_string(),
    }))
}

/// `GET /api/productions/{id}`: shots with signed frames and moments; starts a coverage check
/// in the background when a clip became ready since the last one.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ProductionDetail>, ApiError> {
    let id = ProductionId::parse(id)?;
    let view = production_detail(&state.studio.deps(), &user, &id).await?;
    if view.recheck {
        state.studio.start_coverage(&id);
    }
    let busy = state.studio.is_busy(&id);
    Ok(Json(detail_body(view, busy)))
}

fn summary_body(p: Production) -> ProductionSummary {
    ProductionSummary {
        production_id: p.id.to_string(),
        title: p.title,
        brief: p.brief,
        format: p.format,
        aspect: p.aspect,
        target_s: p.target_s,
        blur_bystanders: p.blur_bystanders,
        status: p.status,
        short_id: p.short_id.map(|s| s.to_string()),
        coverage_checked_at: p.coverage_checked_at,
        error: p.error,
        created_at: p.created_at,
    }
}

fn shot_body(v: ShotView) -> ProductionShot {
    let s = v.shot;
    ProductionShot {
        shot_id: s.id.to_string(),
        ord: s.ord,
        act: s.act,
        title: s.title,
        direction: s.direction,
        tips: s.tips,
        duration_s: s.duration_s,
        board_url: v.board_url,
        matched: v.matched.map(|(c, thumb_url)| ShotMatch {
            segment_id: c.segment_id.to_string(),
            clip_id: c.clip_id.to_string(),
            clip_title: c.clip_title,
            start_s: c.start_s,
            end_s: c.end_s,
            recorded_at: c.recorded_at,
            description: c.description,
            thumb_url,
        }),
        match_reason: s.match_reason,
        take_count: s.take_count,
    }
}

fn detail_body(view: ProductionView, busy: bool) -> ProductionDetail {
    ProductionDetail {
        production: summary_body(view.production),
        shots: view.shots.into_iter().map(shot_body).collect(),
        covered_count: count(view.covered),
        can_cut: view.can_cut,
        busy,
    }
}

/// `POST /api/productions/{id}/coverage`: rechecks coverage in the background, at most once a
/// minute and never while another run is in flight.
pub async fn coverage(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<StartedResponse>), ApiError> {
    let id = ProductionId::parse(id)?;
    let due = coverage_requested(&state.studio.deps(), &user, &id).await?;
    let started = due && state.studio.start_coverage(&id);
    Ok((StatusCode::ACCEPTED, Json(StartedResponse { started })))
}

/// `POST /api/productions/{id}/retry`: resumes the plan (kept shots and frames are reused).
pub async fn retry(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<StartedResponse>), ApiError> {
    let id = ProductionId::parse(id)?;
    let started = state.studio.retry(&user, &id).await?;
    Ok((StatusCode::ACCEPTED, Json(StartedResponse { started })))
}

/// `DELETE /api/productions/{id}`: the production, its shots and its storyboard frames.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = ProductionId::parse(id)?;
    delete_production(&state.studio.deps(), &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/productions/{id}/cut`: the story short, made by the existing create-short use case
/// from the covered shots in act order (the same short on a second call).
pub async fn cut(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<CutResponse>, ApiError> {
    let id = ProductionId::parse(id)?;
    let short = state.studio.cut(&user, &id).await?;
    Ok(Json(CutResponse {
        short_id: short.to_string(),
    }))
}

/// `GET /api/shorts/{id}/production`: the production a story short was cut from, with every
/// shot's act, title, planned length and moment.
pub async fn of_short(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ShortProduction>, ApiError> {
    let short = ShortId::parse(id)?;
    let (p, shots) = short_production(&state.studio.deps(), &user, &short).await?;
    Ok(Json(ShortProduction {
        production_id: p.id.to_string(),
        title: p.title,
        status: p.status,
        shots: shots
            .into_iter()
            .map(|s| ActShot {
                ord: s.ord,
                act: s.act,
                title: s.title,
                duration_s: s.duration_s,
                segment_id: s.matched_segment_id.map(String::from),
            })
            .collect(),
    }))
}
