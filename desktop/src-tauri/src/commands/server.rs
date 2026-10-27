//! `server_get`, `server_set`, `sign_out`: first-run server choice and the Keychain session.

use serde::Serialize;
use tauri::State;

use crate::context::AppCtx;
use crate::core::error::DesktopResult;
use crate::core::server_url::normalise_server_url;

/// The saved server, `null` on first run.
#[derive(Debug, Serialize)]
pub struct ServerUrl {
    url: Option<String>,
}

/// Returns the saved server URL.
#[tauri::command(rename_all = "snake_case")]
pub fn server_get(ctx: State<'_, AppCtx>) -> ServerUrl {
    ServerUrl {
        url: ctx.settings().server_url,
    }
}

/// Saves the server URL (https only; http to localhost in dev builds). A new server drops the
/// old session.
///
/// # Errors
/// `BAD_SERVER_URL`, `KEYCHAIN` or `IO`.
#[tauri::command(rename_all = "snake_case")]
pub fn server_set(ctx: State<'_, AppCtx>, url: String) -> DesktopResult<ServerUrl> {
    let url = normalise_server_url(&url, ctx.build)?;
    ctx.api.set_server(url.clone())?;
    ctx.update_settings(|s| s.server_url = Some(url.clone()))?;
    ctx.sync.signed_in();
    Ok(ServerUrl { url: Some(url) })
}

/// Clears the Keychain session and stops syncing until the next sign-in.
///
/// # Errors
/// `KEYCHAIN` when the item cannot be removed.
#[tauri::command(rename_all = "snake_case")]
pub fn sign_out(ctx: State<'_, AppCtx>) -> DesktopResult<()> {
    ctx.api.sign_out()?;
    ctx.sync.signed_out();
    Ok(())
}
