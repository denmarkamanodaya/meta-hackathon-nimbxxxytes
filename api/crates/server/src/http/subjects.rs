//! SAM features: keep subject in frame (`POST/GET /api/shorts/{id}/reframe`), Find this
//! (`POST /api/clips/{id}/find`) and Cut out (`POST /api/clips/{id}/cutout`).

use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::runs::StartedResponse;
use nimbytes_contracts::subjects::{
    CutoutResponse, FindHitBody, FindResponse, InView, OutlineBody, ReframeResponse, ReframeShot,
    TapRequest,
};
use nimbytes_core::domain::ids::{ClipId, ShortId};
use nimbytes_core::usecases::subjects::{FindView, ReframeView, Tap, cut_out, find_this};
use nimbytes_core::{AppError, ErrorCode};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

fn tap(b: TapRequest) -> Tap {
    Tap {
        t_s: b.t_s,
        x: b.x,
        y: b.y,
    }
}

/// `work` within `limit` (the one deadline of a Find this or Cut out request); past it
/// `MODEL_UNAVAILABLE`.
async fn capped<T>(
    limit: Duration,
    work: impl Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    tokio::time::timeout(limit, work).await.map_err(|_| {
        AppError::new(
            ErrorCode::ModelUnavailable,
            "finding it took too long, try again",
        )
    })?
}

/// `POST /api/shorts/{id}/reframe`: tracks each shot's subject in the background.
pub async fn start(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<StartedResponse>), ApiError> {
    let id = ShortId::parse(id)?;
    let started = state.publisher.reframe(&user, &id).await?;
    Ok((StatusCode::ACCEPTED, Json(StartedResponse { started })))
}

/// `GET /api/shorts/{id}/reframe`.
pub async fn status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ReframeResponse>, ApiError> {
    let id = ShortId::parse(id)?;
    let view = state.publisher.reframe_status(&user, &id).await?;
    Ok(Json(reframe_body(view)))
}

fn reframe_body(v: ReframeView) -> ReframeResponse {
    ReframeResponse {
        status: v.status,
        shots: v
            .shots
            .into_iter()
            .map(|s| ReframeShot {
                segment_id: s.segment_id.as_str().to_owned(),
                subject: s.subject,
                frames_tracked: s.frames_tracked,
                frames_total: s.frames_total,
                lost_s: s.lost_s,
            })
            .collect(),
    }
}

/// `POST /api/clips/{id}/find`: Find this.
pub async fn find(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<TapRequest>,
) -> Result<Json<FindResponse>, ApiError> {
    let id = ClipId::parse(id)?;
    let deps = state.ports.find_deps();
    let view = capped(
        state.ports.tap_timeout,
        find_this(&deps, &user, &id, tap(body)),
    )
    .await?;
    Ok(Json(find_body(view)))
}

fn find_body(v: FindView) -> FindResponse {
    FindResponse {
        label: v.label,
        in_view: InView {
            start_s: v.in_view.start_s,
            end_s: v.in_view.end_s,
        },
        outline: v.outline.map(|o| OutlineBody {
            path: o.path,
            frame_w: o.frame_w,
            frame_h: o.frame_h,
        }),
        hits: v
            .hits
            .into_iter()
            .map(|h| FindHitBody {
                clip_id: h.clip_id.as_str().to_owned(),
                clip_title: h.clip_title,
                recorded_at: h.recorded_at,
                segment_id: h.segment_id.as_str().to_owned(),
                start_s: h.start_s,
                end_s: h.end_s,
                thumb_url: h.thumb_url,
                score: h.score,
            })
            .collect(),
    }
}

/// `POST /api/clips/{id}/cutout`: Cut out.
pub async fn cutout(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<TapRequest>,
) -> Result<Json<CutoutResponse>, ApiError> {
    let id = ClipId::parse(id)?;
    let deps = state.ports.find_deps();
    let v = capped(
        state.ports.tap_timeout,
        cut_out(&deps, &user, &id, tap(body)),
    )
    .await?;
    state.ports.usage_refresh.poke();
    Ok(Json(CutoutResponse {
        label: v.label,
        png_url: v.png_url,
        sticker_url: v.sticker_url,
    }))
}
