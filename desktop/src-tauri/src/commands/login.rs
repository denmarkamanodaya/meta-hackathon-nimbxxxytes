//! `login_get`, `login_set`: open the app at login (the same switch as the menu-bar item).

use tauri::{AppHandle, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};

/// Whether the app opens at login.
#[tauri::command(rename_all = "snake_case")]
pub fn login_get<R: Runtime>(app: AppHandle<R>) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turns opening at login on or off.
///
/// # Errors
/// `IO` when macOS refuses the login item change.
#[tauri::command(rename_all = "snake_case")]
pub fn login_set<R: Runtime>(app: AppHandle<R>, enabled: bool) -> DesktopResult<()> {
    let launcher = app.autolaunch();
    let changed = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    changed.map_err(|err| DesktopError::new(ErrorCode::Io, err.to_string()))
}
