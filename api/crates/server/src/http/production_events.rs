//! `GET /api/productions/{id}/events`: Server-Sent Events, one unnamed `data: {"step","status"}`
//! event per step of the production's plan or coverage run. The first event is the current state,
//! so a late client does not wait; the stream ends after `done` or any failed step.

use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;
use nimbytes_contracts::productions::ProductionEvent;
use nimbytes_core::domain::ids::ProductionId;
use nimbytes_core::domain::production::{is_last_event, progress_snapshot};
use nimbytes_core::usecases::productions::watch_production;

use super::events::subject_stream;
use super::{ApiError, CurrentUser};
use crate::progress::StepEvent;
use crate::state::AppState;

fn production_event(e: StepEvent) -> ProductionEvent {
    ProductionEvent {
        step: e.step,
        status: e.status,
    }
}

fn is_last(e: &ProductionEvent) -> bool {
    is_last_event(&e.step, e.status)
}

/// Streams the production's steps to its owner.
pub async fn production_events(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, axum::Error>>>, ApiError> {
    let id = ProductionId::parse(id)?;
    // Subscribe before reading the snapshot, so no change between the two is lost.
    let rx = state.progress.subscribe();
    let p = watch_production(&state.studio.deps(), &user, &id).await?;
    let (step, status) = progress_snapshot(p.status, state.studio.is_busy(&id));
    let first = ProductionEvent {
        step: step.to_owned(),
        status,
    };
    let stream = subject_stream(id.to_string(), Some(first), rx, (production_event, is_last));
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
