//! The sync engine: polls the manifest (every 30 s, on "Sync now" and on window focus), applies
//! the diff from `core::sync_plan`, keeps `state.json` and pushes `SyncStatus` to the window.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use nimbytes_contracts::sync::SyncManifest;
use tokio::sync::{Notify, Semaphore};

use crate::adapters::api_client::ApiClient;
use crate::adapters::json_file::JsonFile;
use crate::adapters::system::folder_bytes;
use crate::core::cache::auto_bytes;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::state::{OriginalKind, SyncState};
use crate::core::sync_plan::{Folder, plan};
use crate::core::time::iso_utc;
use crate::ports::{Clock, Trash};
use crate::services::status::{
    Cache, ClipLocal, Counts, OriginalState, ProxyState, StatusTracker, SyncPhase, SyncStatus,
    Transfer, TransferKind,
};

/// Poll period while nothing goes wrong.
const POLL: Duration = Duration::from_secs(30);
/// First retry delay after an error; doubles up to [`MAX_BACKOFF`].
const FIRST_BACKOFF: Duration = Duration::from_secs(5);
/// Longest retry delay.
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// Downloads at once.
const PARALLEL_DOWNLOADS: usize = 2;
/// Progress pushes at most this often, milliseconds.
const EMIT_EVERY_MS: u64 = 400;

/// Pushes a status snapshot to the window (`sync://status`) and the tray.
pub type Emitter = Box<dyn Fn(&SyncStatus) + Send + Sync>;

/// What the engine is built from (wired in the composition root).
pub struct SyncDeps {
    /// API client.
    pub api: Arc<ApiClient>,
    /// The Trash.
    pub trash: Arc<dyn Trash>,
    /// Wall clock.
    pub clock: Arc<dyn Clock>,
    /// `state.json`.
    pub state_file: JsonFile,
    /// Sync folder.
    pub folder: PathBuf,
    /// Auto-original budget, gigabytes.
    pub budget_gb: f64,
}

/// Sync down (proxies, renders, originals) and the shared state the other services use.
pub struct SyncEngine {
    pub(crate) api: Arc<ApiClient>,
    pub(crate) trash: Arc<dyn Trash>,
    pub(crate) clock: Arc<dyn Clock>,
    state_file: JsonFile,
    state: Mutex<SyncState>,
    folder: PathBuf,
    budget_gb: Mutex<f64>,
    pub(crate) manifest: Mutex<Option<SyncManifest>>,
    /// Live status.
    pub status: StatusTracker,
    wake: Notify,
    signed_out: AtomicBool,
    pub(crate) downloads: Semaphore,
    emitter: OnceLock<Emitter>,
    last_emit_ms: AtomicU64,
}

impl SyncEngine {
    /// Builds the engine and loads `state.json`.
    pub fn new(deps: SyncDeps) -> Self {
        let state = deps.state_file.load_or_default();
        Self {
            api: deps.api,
            trash: deps.trash,
            clock: deps.clock,
            state_file: deps.state_file,
            state: Mutex::new(state),
            folder: deps.folder,
            budget_gb: Mutex::new(deps.budget_gb),
            manifest: Mutex::new(None),
            status: StatusTracker::default(),
            wake: Notify::new(),
            signed_out: AtomicBool::new(false),
            downloads: Semaphore::new(PARALLEL_DOWNLOADS),
            emitter: OnceLock::new(),
            last_emit_ms: AtomicU64::new(0),
        }
    }

    /// Sets where status pushes go (once, after the window exists).
    pub fn set_emitter(&self, emitter: Emitter) {
        let _ = self.emitter.set(emitter);
    }

    /// The sync folder.
    pub fn folder(&self) -> PathBuf {
        self.folder.clone()
    }

    /// Absolute path of a file in an app-managed folder.
    pub fn path(&self, folder: Folder, file: &str) -> PathBuf {
        self.folder().join(folder.name()).join(file)
    }

    /// A copy of the sync state.
    pub fn state(&self) -> SyncState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Changes the sync state and saves `state.json`.
    ///
    /// # Errors
    /// `IO` when the file cannot be written.
    pub fn update_state<T>(&self, change: impl FnOnce(&mut SyncState) -> T) -> DesktopResult<T> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| DesktopError::new(ErrorCode::Io, "state lock poisoned"))?;
        let out = change(&mut guard);
        self.state_file.save(&*guard)?;
        Ok(out)
    }

    /// The budget for auto originals, gigabytes.
    pub fn budget_gb(&self) -> f64 {
        self.budget_gb.lock().map(|b| *b).unwrap_or(0.0)
    }

    /// Changes the budget (the caller saves the setting); evicts at once.
    pub fn set_budget_gb(&self, gb: f64) {
        if let Ok(mut b) = self.budget_gb.lock() {
            *b = gb;
        }
        self.evict(&[]);
        self.emit();
    }

    /// Asks for a sync now ("Sync now", window focus, a pin change).
    pub fn sync_now(&self) {
        self.wake.notify_one();
    }

    /// A session exists again: resume polling at once.
    pub fn signed_in(&self) {
        self.signed_out.store(false, Ordering::SeqCst);
        self.sync_now();
    }

    /// The server said 401 or the owner signed out: stop until the next sign-in.
    pub fn signed_out(&self) {
        self.signed_out.store(true, Ordering::SeqCst);
        self.status.update(|s| {
            s.state = SyncPhase::SignedOut;
            s.error = None;
        });
        self.emit();
    }

    /// The status as the bridge returns it.
    pub fn snapshot(&self) -> SyncStatus {
        let state = self.state();
        let (phase, error, last, transfers, exports) = self
            .status
            .read(|l| {
                (
                    l.state,
                    l.error.clone(),
                    l.last_sync_at.clone(),
                    l.transfers.values().cloned().collect::<Vec<_>>(),
                    l.exports.values().cloned().collect(),
                )
            })
            .unwrap_or((SyncPhase::Error, None, None, Vec::new(), Vec::new()));
        let clips = self.clip_rows(&state, &transfers);
        SyncStatus {
            folder: self.folder().to_string_lossy().into_owned(),
            last_sync_at: last,
            state: phase,
            error,
            counts: counts(&state),
            pinned_clip_ids: pinned(&state),
            cache: Cache {
                budget_gb: self.budget_gb(),
                auto_bytes: auto_bytes(state.originals.values()),
            },
            local_proxy_bytes: clips.iter().map(|c| c.proxy_bytes).sum(),
            pinned_bytes: pinned_bytes(&state),
            cache_bytes: folder_bytes(&self.folder()),
            renders: state.shorts.len(),
            projects: state.projects.len(),
            poll_s: POLL.as_secs(),
            clips,
            transfers,
            exports,
        }
    }

    /// Local state of every clip in the last manifest.
    fn clip_rows(&self, state: &SyncState, transfers: &[Transfer]) -> Vec<ClipLocal> {
        let manifest = self.manifest.lock().ok().and_then(|m| m.clone());
        let ids = manifest.map(|m| m.clips.into_iter().map(|c| c.clip_id).collect::<Vec<_>>());
        ids.unwrap_or_default()
            .into_iter()
            .map(|id| {
                let local = state
                    .clips
                    .get(&id)
                    .filter(|c| self.path(Folder::Library, &c.file).is_file());
                let downloading = transfers.iter().any(|t| {
                    t.kind == TransferKind::Proxy && t.clip_id.as_deref() == Some(id.as_str())
                });
                let proxy = match (local, downloading) {
                    (Some(_), _) => ProxyState::Synced,
                    (None, true) => ProxyState::Downloading,
                    (None, false) => ProxyState::Missing,
                };
                let original = state.originals.get(&id);
                ClipLocal {
                    proxy,
                    proxy_bytes: local.map_or(0, |c| c.size_bytes),
                    original: match original.map(|o| o.kind) {
                        Some(OriginalKind::Pinned) => OriginalState::Pinned,
                        Some(OriginalKind::Auto) => OriginalState::Auto,
                        None => OriginalState::None,
                    },
                    original_on_disk: original.is_some_and(|o| o.file.is_some()),
                    clip_id: id,
                }
            })
            .collect()
    }

    /// Pushes the status now.
    pub fn emit(&self) {
        self.last_emit_ms
            .store(self.clock.now_ms(), Ordering::Relaxed);
        if let Some(emit) = self.emitter.get() {
            emit(&self.snapshot());
        }
    }

    /// Pushes the status unless a push went out in the last [`EMIT_EVERY_MS`].
    pub fn emit_throttled(&self) {
        let now = self.clock.now_ms();
        if now.saturating_sub(self.last_emit_ms.load(Ordering::Relaxed)) >= EMIT_EVERY_MS {
            self.emit();
        }
    }

    /// The poll loop; runs for the life of the app.
    pub async fn run(self: Arc<Self>) {
        let mut backoff = FIRST_BACKOFF;
        loop {
            if self.signed_out.load(Ordering::SeqCst) || self.api.server().is_err() {
                self.wake.notified().await;
                continue;
            }
            let wait = match self.sync_once().await {
                Ok(()) => {
                    backoff = FIRST_BACKOFF;
                    POLL
                }
                Err(err) => {
                    self.failed(&err);
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                    backoff / 2
                }
            };
            tokio::select! {
                () = tokio::time::sleep(wait) => {}
                () = self.wake.notified() => {}
            }
        }
    }

    fn failed(&self, err: &DesktopError) {
        eprintln!("sync round failed: {err}");
        if err.code == ErrorCode::NotSignedIn {
            self.signed_out();
            return;
        }
        let phase = if err.code == ErrorCode::Network {
            SyncPhase::Offline
        } else {
            SyncPhase::Error
        };
        self.status.update(|s| {
            s.state = phase;
            s.error = Some(err.message.clone());
        });
        self.emit();
    }

    /// One round: manifest, diff, apply, evict.
    ///
    /// # Errors
    /// The first failure that stops the round (a single failed file does not).
    pub async fn sync_once(&self) -> DesktopResult<()> {
        self.status.update(|s| s.state = SyncPhase::Syncing);
        self.emit();
        let manifest = self.fetch_manifest().await?;
        let state = self.state();
        let on_disk = |folder: Folder, file: &str| self.path(folder, file).is_file();
        let actions = plan(&manifest, &state, &on_disk);
        let failures = self.apply(actions).await;
        self.evict(&[]);
        let now = iso_utc(self.clock.now_ms());
        self.status.update(|s| {
            s.state = if failures.is_empty() {
                SyncPhase::Idle
            } else {
                SyncPhase::Error
            };
            s.error = failures.first().map(|e| e.message.clone());
            s.last_sync_at = Some(now);
        });
        self.emit();
        Ok(())
    }

    /// The manifest: re-fetched on a change, else the last one (same etag) from memory.
    async fn fetch_manifest(&self) -> DesktopResult<SyncManifest> {
        let cached = self.manifest.lock().ok().and_then(|m| m.clone());
        let etag = cached.as_ref().map(|m| format!("\"{}\"", m.etag));
        let fresh: Option<SyncManifest> = self
            .api
            .get_json("/api/sync/manifest", etag.as_deref())
            .await?;
        let manifest = match (fresh, cached) {
            (Some(m), _) | (None, Some(m)) => m,
            (None, None) => {
                return Err(DesktopError::new(
                    ErrorCode::BadResponse,
                    "304 without a manifest",
                ));
            }
        };
        self.update_state(|s| s.etag = Some(manifest.etag.clone()))?;
        if let Ok(mut slot) = self.manifest.lock() {
            *slot = Some(manifest.clone());
        }
        Ok(manifest)
    }

    /// Forgets the cached manifest, so the next round gets fresh URLs.
    pub(crate) fn drop_manifest(&self) {
        if let Ok(mut slot) = self.manifest.lock() {
            *slot = None;
        }
    }
}

fn counts(state: &SyncState) -> Counts {
    Counts {
        clips: state.clips.len(),
        shorts: state.shorts.len(),
        originals_offline: state
            .originals
            .values()
            .filter(|o| o.file.is_some())
            .count(),
    }
}

fn pinned_bytes(state: &SyncState) -> u64 {
    state
        .originals
        .values()
        .filter(|o| o.kind == OriginalKind::Pinned && o.file.is_some())
        .map(|o| o.size_bytes)
        .sum()
}

fn pinned(state: &SyncState) -> Vec<String> {
    state
        .originals
        .iter()
        .filter(|(_, o)| o.kind == OriginalKind::Pinned)
        .map(|(id, _)| id.clone())
        .collect()
}
