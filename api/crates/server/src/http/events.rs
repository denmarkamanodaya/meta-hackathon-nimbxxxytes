//! `GET /api/clips/{id}/events`: Server-Sent Events, one unnamed `data: {"step","status"}` event
//! per pipeline step change of the clip. The first event is the current state, so a client that
//! connects late does not wait; the stream ends after `ready done` or any `failed`.

use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;
use futures_util::stream;
use nimbytes_contracts::clips::ClipEvent;
use nimbytes_core::domain::ids::ClipId;
use nimbytes_core::domain::job::StepStatus;
use nimbytes_core::usecases::clips::watch_clip;
use serde::Serialize;
use tokio::sync::broadcast::{Receiver, error::RecvError};

use super::{ApiError, CurrentUser};
use crate::progress::StepEvent;
use crate::state::AppState;

/// Streams the clip's step events to its owner.
pub async fn clip_events(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, axum::Error>>>, ApiError> {
    let clip = ClipId::parse(id)?;
    // Subscribe before reading the snapshot, so no change between the two is lost.
    let rx = state.progress.subscribe();
    let ports = &state.ports;
    let first = watch_clip(ports.catalogue.as_ref(), ports.jobs.as_ref(), &user, &clip).await?;
    let first = first.map(|(step, status)| ClipEvent {
        step: step.to_owned(),
        status,
    });
    Ok(Sse::new(clip_stream(clip.to_string(), first, rx)).keep_alive(KeepAlive::default()))
}

/// `ready done` and any `failed` end the stream.
fn is_terminal(e: &ClipEvent) -> bool {
    e.status == StepStatus::Failed || (e.step == "ready" && e.status == StepStatus::Done)
}

fn clip_event(e: StepEvent) -> ClipEvent {
    ClipEvent {
        step: e.step,
        status: e.status,
    }
}

/// Emits `first` (if any), then every event for `clip` from `rx`, until a terminal event or the
/// channel closes. A lagging receiver skips what it missed; the next event carries the state.
pub(crate) fn clip_stream(
    clip: String,
    first: Option<ClipEvent>,
    rx: Receiver<StepEvent>,
) -> impl Stream<Item = Result<Event, axum::Error>> {
    subject_stream(clip, first, rx, (clip_event, is_terminal))
}

/// How a stream shapes a step event for the wire, and which shaped event is its last.
pub(crate) type EventShape<T> = (fn(StepEvent) -> T, fn(&T) -> bool);

struct Cursor<T> {
    subject: String,
    pending: Option<T>,
    rx: Receiver<StepEvent>,
    finished: bool,
    wire: fn(StepEvent) -> T,
    last: fn(&T) -> bool,
}

/// Emits `first` (if any), then every event for `subject` from `rx` as `wire` shapes it, until
/// `last` says so or the channel closes. A lagging receiver skips what it missed; the next event
/// carries the state.
pub(crate) fn subject_stream<T: Serialize + Send + 'static>(
    subject: String,
    first: Option<T>,
    rx: Receiver<StepEvent>,
    (wire, last): EventShape<T>,
) -> impl Stream<Item = Result<Event, axum::Error>> {
    let cursor = Cursor {
        subject,
        pending: first,
        rx,
        finished: false,
        wire,
        last,
    };
    stream::unfold(cursor, |mut c| async move {
        if c.finished {
            return None;
        }
        let event = match c.pending.take() {
            Some(e) => e,
            None => (c.wire)(next_for(&c.subject, &mut c.rx).await?),
        };
        c.finished = (c.last)(&event);
        Some((Event::default().json_data(&event), c))
    })
}

async fn next_for(subject: &str, rx: &mut Receiver<StepEvent>) -> Option<StepEvent> {
    loop {
        match rx.recv().await {
            Ok(e) if e.subject_id == subject => return Some(e),
            Ok(_) | Err(RecvError::Lagged(_)) => {}
            Err(RecvError::Closed) => return None,
        }
    }
}

#[cfg(test)]
mod tests;
