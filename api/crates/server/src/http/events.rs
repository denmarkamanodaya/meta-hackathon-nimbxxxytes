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

struct Cursor {
    clip: String,
    pending: Option<ClipEvent>,
    rx: Receiver<StepEvent>,
    finished: bool,
}

/// `ready done` and any `failed` end the stream.
fn is_terminal(e: &ClipEvent) -> bool {
    e.status == StepStatus::Failed || (e.step == "ready" && e.status == StepStatus::Done)
}

/// Emits `first` (if any), then every event for `clip` from `rx`, until a terminal event or the
/// channel closes. A lagging receiver skips what it missed; the next event carries the state.
pub(crate) fn clip_stream(
    clip: String,
    first: Option<ClipEvent>,
    rx: Receiver<StepEvent>,
) -> impl Stream<Item = Result<Event, axum::Error>> {
    let cursor = Cursor {
        clip,
        pending: first,
        rx,
        finished: false,
    };
    stream::unfold(cursor, |mut c| async move {
        if c.finished {
            return None;
        }
        let event = match c.pending.take() {
            Some(e) => e,
            None => next_for_clip(&c.clip, &mut c.rx).await?,
        };
        c.finished = is_terminal(&event);
        Some((Event::default().json_data(&event), c))
    })
}

async fn next_for_clip(clip: &str, rx: &mut Receiver<StepEvent>) -> Option<ClipEvent> {
    loop {
        match rx.recv().await {
            Ok(e) if e.subject_id == clip => {
                return Some(ClipEvent {
                    step: e.step,
                    status: e.status,
                });
            }
            Ok(_) | Err(RecvError::Lagged(_)) => {}
            Err(RecvError::Closed) => return None,
        }
    }
}

#[cfg(test)]
mod tests;
