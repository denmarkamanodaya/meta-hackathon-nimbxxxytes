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
    reason = "the bridge contract fixes flat arguments: method, path, body, body_base64, content_type"
)]
#[tauri::command(rename_all = "snake_case")]
pub async fn api_request(
    ctx: State<'_, AppCtx>,
    method: String,
    path: String,
    body: Option<String>,
    body_base64: Option<String>,
    content_type: Option<String>,
) -> DesktopResult<RawResponse> {
    let call = ApiCall {
        method,
        path: path.clone(),
        body: request_body(body, body_base64)?,
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

/// The body to send: the decoded `body_base64` (a binary body such as a voice note), else the text.
fn request_body(text: Option<String>, base64: Option<String>) -> DesktopResult<Option<Vec<u8>>> {
    match base64 {
        Some(encoded) => crate::core::base64::decode(&encoded)
            .map(Some)
            .ok_or_else(|| DesktopError::new(ErrorCode::BadBody, "body_base64 is not base64")),
        None => Ok(text.map(String::into_bytes)),
    }
}

/// The id of a started stream.
#[derive(Debug, serde::Serialize)]
pub struct StreamStarted {
    stream_id: String,
}

/// Opens an SSE stream (GET unless `method` says POST, with an optional body); each event goes
/// down `on_event`, then a final `{ event: "__end" }` whose `data` is empty after a normal close
/// or holds the error text.
///
/// # Errors
/// `BAD_PATH`, `SERVER_NOT_SET` or `KEYCHAIN` before the stream starts.
#[allow(
    clippy::too_many_arguments,
    reason = "the bridge contract fixes flat arguments: path, method, body, content_type, on_event"
)]
#[tauri::command(rename_all = "snake_case")]
pub async fn api_stream(
    ctx: State<'_, AppCtx>,
    path: String,
    method: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
    on_event: Channel<SseEvent>,
) -> DesktopResult<StreamStarted> {
    crate::core::server_url::check_api_path(&path)?;
    let call = ApiCall {
        method: method.unwrap_or_else(|| "GET".to_owned()),
        path,
        body: body.map(String::into_bytes),
        content_type,
    };
    let api = ctx.api.clone();
    let stream_id = uuid::Uuid::now_v7().to_string();
    let task = tauri::async_runtime::spawn(async move {
        let end = match pump(&api, &call, &on_event).await {
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
    call: &ApiCall,
    out: &Channel<SseEvent>,
) -> DesktopResult<()> {
    let res = api.open_stream(call).await?;
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

#[cfg(test)]
mod tests {
    use super::request_body;
    use crate::core::error::ErrorCode;

    #[test]
    fn a_base64_body_is_sent_as_its_bytes_and_text_as_utf8() {
        assert_eq!(
            request_body(None, Some("AAH/".to_owned())).unwrap(),
            Some(vec![0, 1, 255])
        );
        assert_eq!(
            request_body(Some("{}".to_owned()), None).unwrap(),
            Some(b"{}".to_vec())
        );
        assert_eq!(request_body(None, None).unwrap(), None);
        assert_eq!(
            request_body(None, Some("%%".to_owned())).unwrap_err().code,
            ErrorCode::BadBody
        );
    }
}
