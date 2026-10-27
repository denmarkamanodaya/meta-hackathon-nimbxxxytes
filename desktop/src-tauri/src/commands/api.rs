//! `api_request`, `api_stream`, `api_stream_cancel`: the web layer's transport in the Mac app.
//! Rust attaches the Keychain session, so the cookie never touches JavaScript.

use futures_util::StreamExt;
use tauri::State;
use tauri::ipc::Channel;

use crate::adapters::api_client::{ApiCall, RawResponse};
use crate::context::AppCtx;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::sse::{END_EVENT, SseEvent, SseParser};

/// One API call; every HTTP status comes back as data, transport failures as an error.
///
/// # Errors
/// `BAD_PATH`, `SERVER_NOT_SET`, `KEYCHAIN` or `NETWORK`.
#[allow(
    clippy::too_many_arguments,
    reason = "the bridge contract fixes four flat arguments; State is the fifth"
)]
#[tauri::command(rename_all = "snake_case")]
pub async fn api_request(
    ctx: State<'_, AppCtx>,
    method: String,
    path: String,
    body: Option<String>,
    content_type: Option<String>,
) -> DesktopResult<RawResponse> {
    let call = ApiCall {
        method,
        path: path.clone(),
        body,
        content_type,
    };
    let res = ctx.api.request(call).await?;
    if res.status == 401 {
        ctx.sync.signed_out();
    } else if path == "/api/session" && res.status == 200 {
        ctx.sync.signed_in();
    }
    Ok(res)
}

/// The id of a started stream.
#[derive(Debug, serde::Serialize)]
pub struct StreamStarted {
    stream_id: String,
}

/// Opens an SSE stream; each event goes down `on_event`, then a final `{ event: "__end" }` whose
/// `data` is empty after a normal close or holds the error text.
///
/// # Errors
/// `BAD_PATH`, `SERVER_NOT_SET` or `KEYCHAIN` before the stream starts.
#[tauri::command(rename_all = "snake_case")]
pub async fn api_stream(
    ctx: State<'_, AppCtx>,
    path: String,
    on_event: Channel<SseEvent>,
) -> DesktopResult<StreamStarted> {
    crate::core::server_url::check_api_path(&path)?;
    let api = ctx.api.clone();
    let stream_id = uuid::Uuid::now_v7().to_string();
    let task = tauri::async_runtime::spawn(async move {
        let end = match pump(&api, &path, &on_event).await {
            Ok(()) => String::new(),
            Err(err) => err.message,
        };
        let _ = on_event.send(SseEvent {
            event: Some(END_EVENT.to_owned()),
            data: end,
        });
    });
    if let Ok(mut streams) = ctx.streams.lock() {
        streams.retain(|_, handle| !handle.is_finished());
        streams.insert(stream_id.clone(), task.inner().abort_handle());
    }
    Ok(StreamStarted { stream_id })
}

async fn pump(
    api: &crate::adapters::api_client::ApiClient,
    path: &str,
    out: &Channel<SseEvent>,
) -> DesktopResult<()> {
    let res = api.open_stream(path).await?;
    let mut body = res.bytes_stream();
    let mut parser = SseParser::default();
    let mut pending = Vec::new();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| crate::adapters::api_client::network(&e))?;
        pending.extend_from_slice(&chunk);
        // Keep a split multi-byte character for the next chunk.
        let valid = match std::str::from_utf8(&pending) {
            Ok(text) => text.len(),
            Err(err) => err.valid_up_to(),
        };
        let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
        pending.drain(..valid);
        for event in parser.push(&text) {
            out.send(event)
                .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))?;
        }
    }
    Ok(())
}

/// Stops a stream; no `__end` is sent after a cancel.
///
/// # Errors
/// `UNKNOWN_STREAM` for an id that is not running.
#[tauri::command(rename_all = "snake_case")]
pub fn api_stream_cancel(ctx: State<'_, AppCtx>, stream_id: String) -> DesktopResult<()> {
    let handle = ctx
        .streams
        .lock()
        .ok()
        .and_then(|mut s| s.remove(&stream_id));
    match handle {
        Some(handle) => {
            handle.abort();
            Ok(())
        }
        None => Err(DesktopError::new(ErrorCode::UnknownStream, stream_id)),
    }
}
