//! `sync_status`, `sync_now`, `set_offline`, `set_cache_budget`, `free_up_space`.

use tauri::State;

use crate::context::AppCtx;
use crate::core::error::DesktopResult;
use crate::services::status::SyncStatus;

/// The current status (also pushed as `sync://status`).
#[tauri::command(rename_all = "snake_case")]
pub fn sync_status(ctx: State<'_, AppCtx>) -> SyncStatus {
    ctx.sync.snapshot()
}

/// Starts a sync round now.
#[tauri::command(rename_all = "snake_case")]
pub fn sync_now(ctx: State<'_, AppCtx>) {
    ctx.sync.sync_now();
}

/// Pins (downloads) or unpins a clip's original.
///
/// # Errors
/// `IO` when `state.json` cannot be written.
#[tauri::command(rename_all = "snake_case")]
pub fn set_offline(ctx: State<'_, AppCtx>, clip_id: String, offline: bool) -> DesktopResult<()> {
    ctx.sync.set_offline(&clip_id, offline)
}

/// Sets the auto-original budget, gigabytes (saved; evicts at once).
///
/// # Errors
/// `IO` when `settings.json` cannot be written.
#[tauri::command(rename_all = "snake_case")]
pub fn set_cache_budget(ctx: State<'_, AppCtx>, gb: f64) -> DesktopResult<()> {
    let gb = if gb.is_finite() { gb.max(0.0) } else { 0.0 };
    ctx.update_settings(|s| s.cache_budget_gb = gb)?;
    ctx.sync.set_budget_gb(gb);
    Ok(())
}

/// Frees the cache now, keeping kept-offline clips and files being read. Returns bytes freed.
#[tauri::command(rename_all = "snake_case")]
pub fn free_up_space(ctx: State<'_, AppCtx>) -> u64 {
    ctx.sync.free_up_space()
}
