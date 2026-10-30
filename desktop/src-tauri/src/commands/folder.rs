//! `folder_get` (the build's fixed sync folder) and `pick_and_upload` (the native file dialog,
//! NSOpenPanel through the dialog plugin). The dialog offers videos and photos: videos go on the
//! upload engine as before; photos are handed back to the web layer, which reads each one once
//! through `read_picked_image` and sends it to `POST /api/photos`.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::context::AppCtx;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::exports::{
    IMAGE_EXTENSIONS, MAX_PICKED_IMAGE_BYTES, VIDEO_EXTENSIONS, image_type, is_export_candidate,
};

/// The sync folder path.
#[derive(Debug, Serialize)]
pub struct FolderPath {
    path: Option<String>,
}

/// How many picked videos were queued, and the picked photos for the web layer to send.
#[derive(Debug, Serialize)]
pub struct Queued {
    queued: usize,
    images: Vec<PickedImage>,
}

/// One picked photo.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PickedImage {
    /// Its path, the key `read_picked_image` takes.
    path: String,
    /// Its file name.
    name: String,
    /// `image/jpeg`, `image/png`, `image/webp`, `image/heic` or `image/heif`.
    content_type: &'static str,
    /// Its size, bytes.
    size_bytes: u64,
    /// Its last-modified time, ms since the epoch; `null` when unknown.
    last_modified_ms: Option<u64>,
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

/// Opens the file dialog (videos: mp4, mov, m4v; photos: jpg, jpeg, png, webp, heic, heif). Each
/// video is queued on the upload engine (the files stay where they are); each photo is handed back
/// for the web layer to send. Cancel queues 0.
#[tauri::command(rename_all = "snake_case")]
pub async fn pick_and_upload(app: AppHandle, ctx: State<'_, AppCtx>) -> DesktopResult<Queued> {
    let dialog = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        dialog
            .dialog()
            .file()
            .set_title("Upload to nimbytes")
            .add_filter("Video", &VIDEO_EXTENSIONS)
            .add_filter("Images", &IMAGE_EXTENSIONS)
            .blocking_pick_files()
    })
    .await
    .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))?
    .unwrap_or_default();
    let paths: Vec<PathBuf> = picked
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    let (images, videos) = split_picked(paths);
    let images = remember_images(&ctx, images);
    Ok(Queued {
        images,
        ..queue_picked(&ctx, videos)
    })
}

/// The picked photos apart from the videos (anything else stays with the videos, as before).
fn split_picked(paths: Vec<PathBuf>) -> (Vec<PathBuf>, Vec<PathBuf>) {
    paths.into_iter().partition(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .and_then(image_type)
            .is_some()
    })
}

/// Lets `read_picked_image` read these photos once each, and describes them for the web layer.
fn remember_images(ctx: &AppCtx, paths: Vec<PathBuf>) -> Vec<PickedImage> {
    let images: Vec<PickedImage> = paths
        .iter()
        .filter_map(|path| describe_image(path))
        .collect();
    if let Ok(mut allowed) = ctx.picked_images.lock() {
        allowed.extend(paths);
    }
    images
}

fn describe_image(path: &Path) -> Option<PickedImage> {
    let name = path.file_name()?.to_str()?.to_owned();
    let content_type = image_type(&name)?;
    let meta = std::fs::metadata(path).ok()?;
    let last_modified_ms = meta
        .modified()
        .ok()
        .and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|since| u64::try_from(since.as_millis()).ok());
    Some(PickedImage {
        path: path.to_string_lossy().into_owned(),
        name,
        content_type,
        size_bytes: meta.len(),
        last_modified_ms,
    })
}

/// The bytes of a photo picked in the file dialog, once (raw, not JSON). Any other path, a second
/// read, or a file over 50 MB is refused.
///
/// # Errors
/// `NOT_FOUND` for a path that was not picked; `BAD_BODY` for a file over 50 MB; `IO` when the
/// file cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub async fn read_picked_image(
    ctx: State<'_, AppCtx>,
    path: String,
) -> DesktopResult<tauri::ipc::Response> {
    let path = PathBuf::from(path);
    let was_picked = ctx
        .picked_images
        .lock()
        .map(|mut allowed| allowed.remove(&path))
        .unwrap_or(false);
    if !was_picked {
        return Err(DesktopError::new(ErrorCode::NotFound, "not a picked photo"));
    }
    let bytes =
        tauri::async_runtime::spawn_blocking(move || read_capped(&path, MAX_PICKED_IMAGE_BYTES))
            .await
            .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A file's bytes when it is at most `cap` bytes.
fn read_capped(path: &Path, cap: u64) -> DesktopResult<Vec<u8>> {
    let size = std::fs::metadata(path)
        .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))?
        .len();
    if size > cap {
        return Err(DesktopError::new(
            ErrorCode::BadBody,
            "the photo is over 50 MB",
        ));
    }
    std::fs::read(path).map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))
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
        return Ok(Queued {
            queued: 0,
            images: Vec::new(),
        });
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
    Queued {
        queued,
        images: Vec::new(),
    }
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
    use std::path::PathBuf;

    use super::{read_capped, split_picked, videos_in};

    #[test]
    fn picked_photos_are_split_from_the_videos() {
        let (images, videos) = split_picked(vec![
            PathBuf::from("/a/clip.MOV"),
            PathBuf::from("/a/IMG_1.HEIC"),
            PathBuf::from("/a/b.jpg"),
        ]);
        assert_eq!(
            images,
            [PathBuf::from("/a/IMG_1.HEIC"), PathBuf::from("/a/b.jpg")]
        );
        assert_eq!(videos, [PathBuf::from("/a/clip.MOV")]);
    }

    #[test]
    fn a_picked_photo_over_the_cap_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.jpg");
        std::fs::write(&path, b"12345").unwrap();
        assert_eq!(read_capped(&path, 5).unwrap(), b"12345");
        assert!(read_capped(&path, 4).is_err());
    }

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
