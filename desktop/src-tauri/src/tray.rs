//! Menu-bar icon and menu (approved mock M5): a two-line status, Sync now, Open nimbytes folder,
//! Open window, Launch at login, Quit. The icon is the cloud silhouette as a template image.

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

use crate::context::AppCtx;
use crate::services::nle::RevealKind;
use crate::services::status::{Direction, SyncPhase, SyncStatus};

/// The cloud silhouette, black on transparent (macOS tints template images).
const ICON: &[u8] = include_bytes!("../icons/tray-template.png");

/// The two status lines, updated on every status push.
pub struct StatusItems<R: Runtime> {
    headline: MenuItem<R>,
    detail: MenuItem<R>,
}

impl<R: Runtime> StatusItems<R> {
    /// Shows `status` in the menu.
    pub fn show(&self, status: &SyncStatus) {
        let _ = self.headline.set_text(headline(status));
        let _ = self.detail.set_text(detail(status));
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// First line: `nimbytes is up to date`, `Syncing…`, …
pub fn headline(status: &SyncStatus) -> String {
    match status.state {
        SyncPhase::Idle => "nimbytes is up to date".to_owned(),
        SyncPhase::Syncing => "nimbytes is syncing…".to_owned(),
        SyncPhase::Offline => "nimbytes is offline".to_owned(),
        SyncPhase::SignedOut => "Sign in to nimbytes".to_owned(),
        SyncPhase::Error => "nimbytes has a sync problem".to_owned(),
    }
}

/// Second line: `4 clips · 1 original offline · 1 upload in progress`.
pub fn detail(status: &SyncStatus) -> String {
    let mut parts = vec![
        plural(status.counts.clips, "clip", "clips"),
        format!(
            "{} offline",
            plural(status.counts.originals_offline, "original", "originals")
        ),
    ];
    let uploads = status
        .transfers
        .iter()
        .filter(|t| t.direction == Direction::Up)
        .count();
    if uploads > 0 {
        parts.push(format!(
            "{} in progress",
            plural(uploads, "upload", "uploads")
        ));
    }
    parts.join(" · ")
}

/// Shows and focuses the main window.
pub fn show_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Builds the tray; returns the status lines so pushes can update them.
///
/// # Errors
/// Tauri errors while building the menu or the icon.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<StatusItems<R>> {
    let headline = MenuItem::with_id(app, "headline", "nimbytes", false, None::<&str>)?;
    let detail = MenuItem::with_id(app, "detail", "Starting…", false, None::<&str>)?;
    let at_login = app.autolaunch().is_enabled().unwrap_or(false);
    let login = CheckMenuItem::with_id(
        app,
        "login",
        "Launch at login",
        true,
        at_login,
        None::<&str>,
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &headline,
            &detail,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sync", "Sync now", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(
                app,
                "folder",
                "Open nimbytes folder",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &MenuItem::with_id(app, "window", "Open window", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &login,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit nimbytes", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    TrayIconBuilder::with_id("nimbytes")
        .tooltip("nimbytes")
        .icon(Image::from_bytes(ICON)?)
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(move |app, event| on_menu(app, event.id.as_ref(), &login))
        .build(app)?;
    Ok(StatusItems { headline, detail })
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str, login: &CheckMenuItem<R>) {
    let ctx = app.state::<AppCtx>();
    match id {
        "sync" => ctx.sync.sync_now(),
        "folder" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = app
                    .state::<AppCtx>()
                    .nle
                    .reveal(RevealKind::Folder, None)
                    .await;
            });
        }
        "window" => show_window(app),
        "login" => {
            let launcher = app.autolaunch();
            let on = launcher.is_enabled().unwrap_or(false);
            let changed = if on {
                launcher.disable()
            } else {
                launcher.enable()
            };
            let now_on = if changed.is_ok() { !on } else { on };
            let _ = login.set_checked(now_on);
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_template_icon_decodes() {
        let icon = Image::from_bytes(ICON).unwrap();
        assert_eq!((icon.width(), icon.height()), (44, 33));
    }
}
