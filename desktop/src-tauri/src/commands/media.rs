//! `media_lookup`: the local path of a fully synced file, for `convertFileSrc` in the web layer.

use serde::Serialize;
use tauri::State;

use crate::context::AppCtx;
use crate::services::originals::MediaKind;

/// A local file path, or `null` when not synced.
#[derive(Debug, Serialize)]
pub struct MediaPath {
    path: Option<String>,
}

/// Looks up a proxy or original (by clip id) or a render (by short id). Unknown kinds answer null.
#[tauri::command(rename_all = "snake_case")]
pub fn media_lookup(ctx: State<'_, AppCtx>, kind: String, id: String) -> MediaPath {
    let kind = match kind.as_str() {
        "proxy" => Some(MediaKind::Proxy),
        "original" => Some(MediaKind::Original),
        "render" => Some(MediaKind::Render),
        _ => None,
    };
    MediaPath {
        path: kind
            .and_then(|k| ctx.sync.media_path(k, &id))
            .map(|p| p.to_string_lossy().into_owned()),
    }
}
