//! `media_lookup`: always no local path. The window streams proxies and renders from the cloud,
//! so playing in the window never fills the drive's cache; the web layer falls back to the cloud
//! URL when the path is null.

use serde::Serialize;

/// A local file path, always `null` (see the module doc).
#[derive(Debug, Serialize)]
pub struct MediaPath {
    path: Option<String>,
}

/// Answers null for every kind and id: the window plays from the cloud.
#[tauri::command(rename_all = "snake_case")]
pub fn media_lookup(kind: String, id: String) -> MediaPath {
    let _ = (kind, id);
    MediaPath { path: None }
}
