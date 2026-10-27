//! `server_get` (the build's fixed server) and `sign_out` (clears the Keychain session).

use serde::Serialize;
use tauri::State;

use crate::context::AppCtx;
use crate::core::error::DesktopResult;

/// The build's fixed server (read-only, for display).
#[derive(Debug, Serialize)]
pub struct ServerUrl {
    url: Option<String>,
}

/// Returns the server this build talks to.
#[tauri::command(rename_all = "snake_case")]
pub fn server_get(ctx: State<'_, AppCtx>) -> ServerUrl {
    ServerUrl {
        url: ctx.api.server().ok(),
    }
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
