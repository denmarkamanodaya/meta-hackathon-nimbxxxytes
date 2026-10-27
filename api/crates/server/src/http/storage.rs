//! The storage card.

use axum::Json;
use axum::extract::State;
use nimbytes_contracts::storage::StorageSummary;
use nimbytes_core::usecases::storage::storage_summary;

use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `GET /api/storage`.
pub async fn summary(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<StorageSummary>, ApiError> {
    let ports = &state.ports;
    let s = storage_summary(ports.catalogue.as_ref(), ports.clock.as_ref(), &user).await?;
    Ok(Json(StorageSummary {
        cloud_bytes: s.cloud_bytes,
        phone_bytes: s.phone_bytes,
        frequent_bytes: s.frequent_bytes,
        resting_bytes: s.resting_bytes,
        clip_count: s.clip_count,
    }))
}
