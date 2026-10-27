//! `POST /api/search/stream`: the search of `POST /api/search` as Server-Sent Events. Event
//! `local` (the instant answer) comes first, then `ranked` (what `POST /api/search` returns) or
//! `error`, then `done`. A failure before the local answer is an ordinary error response.

use std::time::Instant;

use axum::extract::State;
use axum::response::sse::{Event, Sse};
use futures_util::{Stream, StreamExt, stream};
use nimbytes_contracts::search::{STREAM_DONE_DATA, SearchRequest, stream_event};
use nimbytes_core::domain::ids::UserId;
use nimbytes_core::usecases::search::{SearchOutcome, search_in_stages};
use nimbytes_core::{AppError, ErrorCode};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use super::error::envelope;
use super::json::ApiJson;
use super::search::wire;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// What the search task hands the stream.
enum Stage {
    Local(SearchOutcome),
    Ranked(Result<SearchOutcome, AppError>),
}

/// Two-stage search over the signed-in user's library.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<SearchRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, axum::Error>>>, ApiError> {
    let mut stages = spawn_search(state, user, body.query);
    match stages.recv().await {
        Some(Stage::Local(local)) => Ok(Sse::new(frames(local, stages))),
        Some(Stage::Ranked(Err(e))) => Err(e.into()),
        Some(Stage::Ranked(Ok(_))) | None => Err(stopped().into()),
    }
}

/// Runs the search on its own task, so it finishes (and fills the model cache) even when the
/// client leaves; logs latency as `POST /api/search` does.
fn spawn_search(state: AppState, user: UserId, query: String) -> UnboundedReceiver<Stage> {
    let (tx, rx) = unbounded_channel();
    tokio::spawn(async move {
        let started = Instant::now();
        let deps = state.ports.search_deps();
        let local_tx = tx.clone();
        let out = search_in_stages(&deps, &user, &query, move |local| {
            // A send fails only when the client has gone; nothing is left to tell.
            let _ = local_tx.send(Stage::Local(local));
        })
        .await;
        if let Ok(o) = &out {
            tracing::info!(
                latency_ms = started.elapsed().as_millis() as u64,
                results = o.results.len(),
                reranked = o.reranked,
                "search stream"
            );
        }
        let _ = tx.send(Stage::Ranked(out));
    });
    rx
}

/// `local`, then `ranked` or `error`, then `done`.
fn frames(
    local: SearchOutcome,
    mut stages: UnboundedReceiver<Stage>,
) -> impl Stream<Item = Result<Event, axum::Error>> {
    let first = Event::default()
        .event(stream_event::LOCAL)
        .json_data(wire(local));
    let second = async move {
        match stages.recv().await {
            Some(Stage::Ranked(Ok(ranked))) => Event::default()
                .event(stream_event::RANKED)
                .json_data(wire(ranked)),
            Some(Stage::Ranked(Err(e))) => error_event(e),
            Some(Stage::Local(_)) | None => error_event(stopped()),
        }
    };
    let done = Event::default()
        .event(stream_event::DONE)
        .data(STREAM_DONE_DATA);
    stream::iter([first])
        .chain(stream::once(second))
        .chain(stream::iter([Ok(done)]))
}

fn error_event(e: AppError) -> Result<Event, axum::Error> {
    Event::default()
        .event(stream_event::ERROR)
        .json_data(envelope(e))
}

/// The search task ended without its answer (it panicked).
fn stopped() -> AppError {
    AppError::new(ErrorCode::Internal, "search task stopped")
}

#[cfg(test)]
mod tests;
