//! `folder_get` (the build's fixed sync folder) and `pick_and_upload` (the native file dialog,
//! NSOpenPanel through the dialog plugin).

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::context::AppCtx;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::exports::{VIDEO_EXTENSIONS, is_export_candidate};

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
    Ok(queue_picked(&ctx, paths))
}

/// Opens the folder dialog and queues every video inside it (sub-folders too, hidden and
/// partial files skipped); the files stay where they are. Cancel queues 0.
#[tauri::command(rename_all = "snake_case")]
pub async fn pick_folder_and_upload(
    app: AppHandle,
    ctx: State<'_, AppCtx>,
) -> DesktopResult<Queued> {
    let dialog = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog
            .dialog()
            .file()
            .set_title("Upload a folder to nimbytes")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))?;
    let Some(folder) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(Queued { queued: 0 });
    };
    let paths = tauri::async_runtime::spawn_blocking(move || videos_in(&folder, MAX_DEPTH))
        .await
        .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))?;
    Ok(queue_picked(&ctx, paths))
}

/// Stops a picked upload (`transfer_id` from the status `transfers`).
#[tauri::command(rename_all = "snake_case")]
pub fn cancel_upload(ctx: State<'_, AppCtx>, transfer_id: String) {
    ctx.exports.cancel(&transfer_id);
}

/// How deep a picked folder is searched.
const MAX_DEPTH: usize = 8;

fn queue_picked(ctx: &AppCtx, paths: Vec<PathBuf>) -> Queued {
    let queued = paths.len();
    for path in paths {
        let exports = ctx.exports.clone();
        tauri::async_runtime::spawn(async move { exports.upload_picked(path).await });
    }
    Queued { queued }
}

/// Video files under `dir`, sorted, searching `depth` folders down; hidden folders are skipped.
fn videos_in(dir: &Path, depth: usize) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if depth > 0 && !name.starts_with('.') {
                found.extend(videos_in(&path, depth - 1));
            }
        } else if is_export_candidate(&name) {
            found.push(path);
        }
    }
    found.sort();
    found
}

#[cfg(test)]
mod tests {
    use super::videos_in;

    #[test]
    fn a_picked_folder_yields_its_videos_including_sub_folders_but_not_hidden_ones() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("day2")).unwrap();
        std::fs::create_dir_all(root.join(".cache")).unwrap();
        for f in [
            "a.MP4",
            "notes.txt",
            ".b.mov",
            "~c.mov",
            "day2/d.mov",
            ".cache/e.mp4",
        ] {
            std::fs::write(root.join(f), b"x").unwrap();
        }
        let names: Vec<String> = videos_in(root, 8)
            .iter()
            .map(|p| p.strip_prefix(root).unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["a.MP4", "day2/d.mov"]);
    }

    #[test]
    fn the_search_stops_at_its_depth() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("x/y")).unwrap();
        std::fs::write(dir.path().join("x/y/deep.mp4"), b"x").unwrap();
        assert!(videos_in(dir.path(), 1).is_empty());
        assert_eq!(videos_in(dir.path(), 2).len(), 1);
    }
}
