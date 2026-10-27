//! Shared app state handed to every command through Tauri's managed state (built once in
//! `main.rs`, the composition root).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::adapters::api_client::ApiClient;
use crate::adapters::json_file::JsonFile;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::server_url::BuildKind;
use crate::core::settings::Settings;
use crate::services::exports::ExportsService;
use crate::services::nle::NleService;
use crate::services::sync::SyncEngine;

/// Everything the commands need.
pub struct AppCtx {
    /// The nimbytes API client.
    pub api: Arc<ApiClient>,
    /// Dev or release build.
    pub build: BuildKind,
    /// `settings.json`.
    pub settings_file: JsonFile,
    /// The loaded settings.
    pub settings: Mutex<Settings>,
    /// Running SSE streams by id.
    pub streams: Mutex<HashMap<String, tokio::task::AbortHandle>>,
    /// Sync down and the shared sync state.
    pub sync: Arc<SyncEngine>,
    /// FCPXML and Finder.
    pub nle: NleService,
    /// Exports and picked-file uploads.
    pub exports: Arc<ExportsService>,
}

impl AppCtx {
    /// A copy of the current settings.
    pub fn settings(&self) -> Settings {
        self.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Changes and saves the settings.
    ///
    /// # Errors
    /// `IO` when `settings.json` cannot be written.
    pub fn update_settings(&self, change: impl FnOnce(&mut Settings)) -> DesktopResult<Settings> {
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| DesktopError::new(ErrorCode::Io, "settings lock poisoned"))?;
        change(&mut guard);
        self.settings_file.save(&*guard)?;
        Ok(guard.clone())
    }
}
