//! `GET /api/shorts/{id}/events`: Server-Sent Events, one unnamed `data: AgentStep` event per
//! step-log row, oldest first. A late client gets every row written so far, then new rows as the
//! agent writes them; the stream ends after a `final` row.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;
use futures_util::stream;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::short::{Step, StepKind};
use nimbytes_core::ports::ShortStore;
use nimbytes_core::usecases::shorts::short_steps;

use super::shorts::step_body;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// How often the log is read for new rows; the agent writes a few rows per second at most.
pub const POLL: Duration = Duration::from_millis(500);

/// Streams the short's step log to its owner.
pub async fn short_events(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, axum::Error>>>, ApiError> {
    let id = ShortId::parse(id)?;
    let first = short_steps(state.ports.shorts.as_ref(), &user, &id).await?;
    let stream = step_stream(state.ports.shorts.clone(), id, first, POLL);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

struct Cursor {
    store: Arc<dyn ShortStore>,
    id: ShortId,
    pending: VecDeque<Step>,
    next_seq: u32,
    poll: Duration,
    finished: bool,
}

/// Emits `first`, then every newer row read every `poll`, until a `final` row has been sent or
/// the store fails.
pub(crate) fn step_stream(
    store: Arc<dyn ShortStore>,
    id: ShortId,
    first: Vec<Step>,
    poll: Duration,
) -> impl Stream<Item = Result<Event, axum::Error>> {
    let next_seq = first.last().map_or(0, |s| s.seq + 1);
    let cursor = Cursor {
        store,
        id,
        pending: first.into(),
        next_seq,
        poll,
        finished: false,
    };
    stream::unfold(cursor, |mut c| async move {
        if c.finished {
            return None;
        }
        while c.pending.is_empty() {
            tokio::time::sleep(c.poll).await;
            let rows = c.store.steps(&c.id).await.ok()?;
            c.pending = rows.into_iter().filter(|s| s.seq >= c.next_seq).collect();
            if let Some(last) = c.pending.back() {
                c.next_seq = last.seq + 1;
            }
        }
        let step = c.pending.pop_front()?;
        c.finished = step.step.kind == StepKind::Final;
        Some((Event::default().json_data(step_body(step)), c))
    })
}

#[cfg(test)]
mod tests;
