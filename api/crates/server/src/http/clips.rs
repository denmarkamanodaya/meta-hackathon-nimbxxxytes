//! `GET /api/clips`.

use axum::Json;
use axum::extract::State;
use nimbytes_contracts::clips::ClipSummary;
use nimbytes_core::domain::clip::Clip;
use nimbytes_core::usecases::clips::list_clips;

use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// The signed-in user's clips, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ClipSummary>>, ApiError> {
    let clips = list_clips(state.ports.catalogue.as_ref(), &user).await?;
    Ok(Json(clips.into_iter().map(summary).collect()))
}

/// Thumbnails, segments and people arrive with later pipeline steps; until then they are empty.
fn summary(clip: Clip) -> ClipSummary {
    ClipSummary {
        clip_id: clip.id.to_string(),
        duration_s: clip.probe.as_ref().map(|p| p.duration_s),
        recorded_at: clip.recorded_at().map(str::to_owned),
        filename: clip.filename,
        status: clip.status,
        thumb_url: None,
        segment_count: 0,
        people: Vec::new(),
    }
}
