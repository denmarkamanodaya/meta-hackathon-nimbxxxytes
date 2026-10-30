//! `open_in_nle`, `reveal`.

use tauri::State;

use crate::context::AppCtx;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::services::nle::{Opened, RevealKind};

/// Writes the short's FCPXML, then opens it in Final Cut Pro or reveals it in Finder.
///
/// # Errors
/// `NOT_FOUND`, an API or download error, or `IO`.
#[tauri::command(rename_all = "snake_case")]
pub async fn open_in_nle(ctx: State<'_, AppCtx>, short_id: String) -> DesktopResult<Opened> {
    ctx.nle.open_in_nle(&short_id).await
}

/// Reveals the folder, a short's FCPXML or render, a clip's original, or a recording, document or
/// photo (`item`, id `listen:<id>`, `doc:<id>` or `photo:<id>`) in Finder.
///
/// # Errors
/// `NOT_FOUND` for an unknown kind or a file not on disk, or `IO`.
#[tauri::command(rename_all = "snake_case")]
pub async fn reveal(ctx: State<'_, AppCtx>, kind: String, id: Option<String>) -> DesktopResult<()> {
    let kind = match kind.as_str() {
        "folder" => RevealKind::Folder,
        "fcpxml" => RevealKind::Fcpxml,
        "render" => RevealKind::Render,
        "original" => RevealKind::Original,
        "item" => RevealKind::Item,
        other => {
            return Err(DesktopError::new(
                ErrorCode::NotFound,
                format!("unknown kind {other}"),
            ));
        }
    };
    ctx.nle.reveal(kind, id.as_deref()).await
}
