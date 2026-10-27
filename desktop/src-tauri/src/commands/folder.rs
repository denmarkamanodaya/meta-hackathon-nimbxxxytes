//! `folder_get` (the build's fixed sync folder) and `pick_and_upload` (the native file dialog,
//! NSOpenPanel through the dialog plugin).

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::context::AppCtx;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::exports::VIDEO_EXTENSIONS;

/// The sync folder path.
#[derive(Debug, Serialize)]
pub struct FolderPath {
    path: Option<String>,
}

/// How many picked files were queued.
#[derive(Debug, Serialize)]
pub struct Queued {
    queued: usize,
}

/// Lets the asset protocol read the sync folder.
///
/// # Errors
/// Tauri's scope error, as `IO`.
pub fn allow_folder(app: &AppHandle, folder: &std::path::Path) -> DesktopResult<()> {
    app.asset_protocol_scope()
        .allow_directory(folder, true)
        .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))
}

/// The current sync folder.
#[tauri::command(rename_all = "snake_case")]
pub fn folder_get(ctx: State<'_, AppCtx>) -> FolderPath {
    FolderPath {
        path: Some(ctx.sync.folder().to_string_lossy().into_owned()),
    }
}

/// Opens the file dialog (mp4, mov, m4v) and queues each file on the upload engine; the files
/// stay where they are. Cancel queues 0.
#[tauri::command(rename_all = "snake_case")]
pub async fn pick_and_upload(app: AppHandle, ctx: State<'_, AppCtx>) -> DesktopResult<Queued> {
    let dialog = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog
            .dialog()
            .file()
            .set_title("Upload to nimbytes")
            .add_filter("Video", &VIDEO_EXTENSIONS)
            .blocking_pick_files()
    })
    .await
    .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))?
    .unwrap_or_default();
    let paths: Vec<PathBuf> = picked
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    let queued = paths.len();
    for path in paths {
        let exports = ctx.exports.clone();
        tauri::async_runtime::spawn(async move { exports.upload_picked(path).await });
    }
    Ok(Queued { queued })
}
