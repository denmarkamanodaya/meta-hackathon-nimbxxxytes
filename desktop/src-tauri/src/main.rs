//! Composition root: reads the environment once, builds the HTTP client, the Keychain store, the
//! adapters and the services, registers the commands, the tray and the window events, and runs
//! the app.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use nimbytes_desktop::adapters::api_client::ApiClient;
use nimbytes_desktop::adapters::json_file::JsonFile;
use nimbytes_desktop::adapters::keychain::KeychainSessionStore;
use nimbytes_desktop::adapters::system::{MacDesktop, MacTrash, SystemClock};
use nimbytes_desktop::commands;
use nimbytes_desktop::context::{AppCtx, sync_folder};
use nimbytes_desktop::core::server_url::BuildKind;
use nimbytes_desktop::core::settings::Settings;
use nimbytes_desktop::ports::Notifier;
use nimbytes_desktop::services::exports::ExportsService;
use nimbytes_desktop::services::nle::NleService;
use nimbytes_desktop::services::sync::{SyncDeps, SyncEngine};
use nimbytes_desktop::tray;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// Keychain service name (the bundle id).
const KEYCHAIN_SERVICE: &str = "dev.denmarkamanodaya.nimbytes";
/// Bounds every API call that is not a stream or a file transfer.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
/// Connect timeout for the API and S3.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// A stream or transfer that sends nothing for this long is dropped (SSE keep-alives come every
/// 15 s).
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// Event the window listens to for status pushes.
const STATUS_EVENT: &str = "sync://status";

fn build_kind() -> BuildKind {
    if cfg!(debug_assertions) {
        BuildKind::Dev
    } else {
        BuildKind::Release
    }
}

/// The HTTP client. Dev builds also trust the local Caddy root CA from `NIMBYTES_DEV_CA` (a PEM
/// path that `make desktop-dev` exports); release builds never read it.
fn http_client(build: BuildKind) -> Result<reqwest::Client, Box<dyn std::error::Error>> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .user_agent(concat!("nimbytes-mac/", env!("CARGO_PKG_VERSION")));
    if build == BuildKind::Dev
        && let Ok(path) = std::env::var("NIMBYTES_DEV_CA")
    {
        let pem = std::fs::read(&path)?;
        builder = builder.tls_certs_merge([reqwest::Certificate::from_pem(&pem)?]);
    }
    Ok(builder.build()?)
}

/// Loads settings and wires the adapters and services.
fn build_ctx(
    home: &Path,
    notifier: Arc<AppNotifier>,
) -> Result<AppCtx, Box<dyn std::error::Error>> {
    let build = build_kind();
    let support = home.join("Library/Application Support/nimbytes");
    let settings_file = JsonFile::new(support.join("settings.json"));
    let mut settings: Settings = settings_file.load_or_default();
    if settings.server_url.is_none() {
        settings.server_url = option_env!("NIMBYTES_SERVER_URL").map(str::to_owned);
    }
    let api = Arc::new(ApiClient::new(
        http_client(build)?,
        settings.server_url.clone(),
        Arc::new(KeychainSessionStore::new(KEYCHAIN_SERVICE)),
        CALL_TIMEOUT,
    ));
    let sync = Arc::new(SyncEngine::new(SyncDeps {
        api: api.clone(),
        trash: Arc::new(MacTrash),
        clock: Arc::new(SystemClock),
        state_file: JsonFile::new(support.join("state.json")),
        folder: sync_folder(&settings, home),
        budget_gb: settings.cache_budget_gb,
    }));
    let exports = Arc::new(ExportsService::new(sync.clone(), notifier));
    Ok(AppCtx {
        exports,
        api,
        build,
        settings_file,
        settings: Mutex::new(settings),
        streams: Mutex::new(HashMap::new()),
        nle: NleService::new(sync.clone(), Arc::new(MacDesktop)),
        sync,
    })
}

/// [`Notifier`] on the notification plugin; silent until the app handle exists.
#[derive(Default)]
struct AppNotifier(OnceLock<AppHandle>);

impl Notifier for AppNotifier {
    fn notify(&self, title: &str, body: &str) {
        if let Some(app) = self.0.get() {
            let _ = app.notification().builder().title(title).body(body).show();
        }
    }
}

/// Tray, status pushes and the two background loops.
fn start(app: &AppHandle, notifier: &AppNotifier) -> Result<(), Box<dyn std::error::Error>> {
    let _ = notifier.0.set(app.clone());
    let status_items = tray::build(app)?;
    let ctx = app.state::<AppCtx>();
    let handle = app.clone();
    ctx.sync.set_emitter(Box::new(move |status| {
        let _ = handle.emit(STATUS_EVENT, status);
        status_items.show(status);
    }));
    commands::folder::allow_folder(app, &ctx.sync.folder())?;
    tauri::async_runtime::spawn(ctx.sync.clone().run());
    tauri::async_runtime::spawn(ctx.exports.clone().run());
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let home = PathBuf::from(std::env::var("HOME")?);
    let notifier = Arc::new(AppNotifier::default());
    let ctx = build_ctx(&home, notifier.clone())?;
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ctx)
        .setup(move |app| start(app.handle(), &notifier))
        .on_window_event(|window, event| match event {
            // Closing hides the window; the app keeps syncing from the menu bar.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(true) => window.state::<AppCtx>().sync.sync_now(),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::server::server_get,
            commands::server::server_set,
            commands::server::sign_out,
            commands::api::api_request,
            commands::api::api_stream,
            commands::api::api_stream_cancel,
            commands::media::media_lookup,
            commands::sync::sync_status,
            commands::sync::sync_now,
            commands::sync::set_offline,
            commands::sync::set_cache_budget,
            commands::nle::open_in_nle,
            commands::nle::reveal,
            commands::folder::folder_get,
            commands::folder::folder_choose,
            commands::folder::folder_set,
            commands::folder::pick_and_upload,
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}
