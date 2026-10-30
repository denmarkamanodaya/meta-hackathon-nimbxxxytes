//! The sync engine: polls the manifest (every 30 s, on "Sync now" and on window focus), hands it
//! to the drive (which lists every clip and render without downloading them), keeps
//! `state.json` (pins, uploads) and pushes `SyncStatus` to the window.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use nimbytes_contracts::sync::SyncManifest;
use tokio::sync::Notify;

use crate::adapters::api_client::ApiClient;
use crate::adapters::json_file::JsonFile;
use crate::core::drive::{IDLE_MS, ItemRef, original_key};
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::settings::cap_bytes;
use crate::core::state::{OriginalKind, SyncState};
use crate::core::time::iso_utc;
use crate::ports::Clock;
use crate::services::drive::DriveService;
use crate::services::status::{
    Cache, ClipLocal, Counts, ItemLocal, OriginalState, ProxyState, StatusTracker, SyncPhase,
    SyncStatus, Transfer,
};

/// Poll period while nothing goes wrong.
const POLL: Duration = Duration::from_secs(30);
/// First retry delay after an error; doubles up to [`MAX_BACKOFF`].
const FIRST_BACKOFF: Duration = Duration::from_secs(5);
/// Longest retry delay.
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// Progress pushes at most this often, milliseconds.
const EMIT_EVERY_MS: u64 = 400;

/// Pushes a status snapshot to the window (`sync://status`) and the tray.
pub type Emitter = Box<dyn Fn(&SyncStatus) + Send + Sync>;

/// What the engine is built from (wired in the composition root).
pub struct SyncDeps {
    /// API client.
    pub api: Arc<ApiClient>,
    /// Wall clock.
    pub clock: Arc<dyn Clock>,
    /// `state.json`.
    pub state_file: JsonFile,
    /// Sync folder.
    pub folder: PathBuf,
    /// Auto-original budget, gigabytes.
    pub budget_gb: f64,
}

/// The manifest poll, the drive's listing and the shared state the other services use.
pub struct SyncEngine {
    pub(crate) api: Arc<ApiClient>,
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
    emitter: OnceLock<Emitter>,
    last_emit_ms: AtomicU64,
    drive: OnceLock<Arc<DriveService>>,
}

impl SyncEngine {
    /// Builds the engine and loads `state.json`.
    pub fn new(deps: SyncDeps) -> Self {
        let state = deps.state_file.load_or_default();
        Self {
            api: deps.api,
            clock: deps.clock,
            state_file: deps.state_file,
            state: Mutex::new(state),
            folder: deps.folder,
            budget_gb: Mutex::new(deps.budget_gb),
            manifest: Mutex::new(None),
            status: StatusTracker::default(),
            wake: Notify::new(),
            signed_out: AtomicBool::new(false),
            emitter: OnceLock::new(),
            last_emit_ms: AtomicU64::new(0),
            drive: OnceLock::new(),
        }
    }

    /// Sets where status pushes go (once, after the window exists).
    pub fn set_emitter(&self, emitter: Emitter) {
        let _ = self.emitter.set(emitter);
    }

    /// Connects the drive (once, in the composition root).
    pub fn set_drive(&self, drive: Arc<DriveService>) {
        let _ = self.drive.set(drive);
    }

    /// The drive, once connected.
    pub fn drive(&self) -> Option<&Arc<DriveService>> {
        self.drive.get()
    }

    /// The sync folder.
    pub fn folder(&self) -> PathBuf {
        self.folder.clone()
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

    /// Changes the budget (the caller saves the setting).
    pub fn set_budget_gb(&self, gb: f64) {
        if let Ok(mut b) = self.budget_gb.lock() {
            *b = gb;
        }
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
        let items = self.item_rows(&state);
        SyncStatus {
            folder: self.folder().to_string_lossy().into_owned(),
            last_sync_at: last,
            state: phase,
            error,
            counts: self.counts(&clips),
            pinned_clip_ids: pinned(&state),
            pinned_items: state.pinned_items.keys().cloned().collect(),
            cache: Cache {
                budget_gb: self.budget_gb(),
                auto_bytes: 0,
            },
            local_proxy_bytes: 0,
            pinned_bytes: self.pinned_bytes(&state),
            cache_bytes: self.drive().map_or(0, |d| d.space_used()),
            renders: self.listed_shorts(),
            projects: state.projects.len(),
            poll_s: POLL.as_secs(),
            cache_cap_bytes: cap_bytes(self.budget_gb()),
            release_after_s: IDLE_MS / 1000,
            clips,
            items,
            transfers,
            exports,
        }
    }

    /// Local state of every recording, document and photo in the last manifest, library order.
    fn item_rows(&self, state: &SyncState) -> Vec<ItemLocal> {
        let manifest = self.manifest.lock().ok().and_then(|m| m.clone());
        let items = manifest.map(|m| m.items).unwrap_or_default();
        items
            .iter()
            .filter_map(|i| {
                let item = ItemRef::of(&i.kind, &i.id)?;
                let key = item.key();
                let cached = self.drive().map_or(0, |d| d.cached(&key));
                let last_read = self
                    .drive()
                    .and_then(|d| d.last_read_ms(&key))
                    .filter(|_| cached > 0)
                    .map(iso_utc);
                let name = item.to_string();
                Some(ItemLocal {
                    pinned: state.pinned_items.contains_key(&name),
                    on_disk: i.size_bytes > 0 && cached >= i.size_bytes,
                    item: name,
                    cached_bytes: cached,
                    last_read_at: last_read,
                })
            })
            .collect()
    }

    /// Local state of every clip in the last manifest. Proxies stream from the cloud, so none is
    /// on this Mac; an original is on this Mac once every chunk of it is cached.
    fn clip_rows(&self, state: &SyncState, _transfers: &[Transfer]) -> Vec<ClipLocal> {
        let manifest = self.manifest.lock().ok().and_then(|m| m.clone());
        let clips = manifest.map(|m| m.clips).unwrap_or_default();
        clips
            .into_iter()
            .map(|clip| {
                let pinned = state
                    .originals
                    .get(&clip.clip_id)
                    .is_some_and(|o| o.kind == OriginalKind::Pinned);
                let cached = self.drive().map_or(0, |d| d.original_cached(&clip.clip_id));
                let last_read = self
                    .drive()
                    .and_then(|d| d.original_last_read_ms(&clip.clip_id))
                    .filter(|_| cached > 0)
                    .map(iso_utc);
                ClipLocal {
                    cached_bytes: cached,
                    last_read_at: last_read,
                    proxy: ProxyState::Missing,
                    proxy_bytes: 0,
                    original: if pinned {
                        OriginalState::Pinned
                    } else {
                        OriginalState::None
                    },
                    original_on_disk: clip.size_bytes > 0 && cached >= clip.size_bytes,
                    clip_id: clip.clip_id,
                }
            })
            .collect()
    }

    /// Clips, shorts with a render, and originals fully on this Mac.
    fn counts(&self, clips: &[ClipLocal]) -> Counts {
        Counts {
            clips: clips.len(),
            shorts: self.listed_shorts(),
            originals_offline: clips.iter().filter(|c| c.original_on_disk).count(),
        }
    }

    fn listed_shorts(&self) -> usize {
        self.manifest
            .lock()
            .ok()
            .and_then(|m| {
                m.as_ref()
                    .map(|m| m.shorts.iter().filter(|s| s.render_url.is_some()).count())
            })
            .unwrap_or(0)
    }

    /// Keeps the drive's cache within the owner's cap (see [`DriveService::evict`]).
    fn evict_cache(&self, drive: &DriveService) {
        let state = self.state();
        let late: Vec<String> = state.project_clips.values().flatten().cloned().collect();
        drive.evict(cap_bytes(self.budget_gb()), &pinned_keys(&state), &late);
    }

    /// "Free up space now": frees every cached file except kept-offline clips and files being
    /// read. Returns the bytes freed.
    pub fn free_up_space(&self) -> u64 {
        let Some(drive) = self.drive() else {
            return 0;
        };
        let freed = drive.evict(0, &pinned_keys(&self.state()), &[]);
        self.emit();
        freed
    }

    /// Cached bytes of the files kept offline (clip originals, recordings, documents, photos).
    fn pinned_bytes(&self, state: &SyncState) -> u64 {
        let Some(drive) = self.drive() else {
            return 0;
        };
        pinned_keys(state).iter().map(|key| drive.cached(key)).sum()
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

    /// One round: the manifest, then the drive's listing.
    ///
    /// # Errors
    /// The first failure that stops the round (a single failed file does not).
    pub async fn sync_once(&self) -> DesktopResult<()> {
        self.status.update(|s| s.state = SyncPhase::Syncing);
        self.emit();
        let manifest = self.fetch_manifest().await?;
        if let Some(drive) = self.drive() {
            drive.refresh(&manifest).await;
            self.evict_cache(drive);
            // Pinned originals keep caching after a restart until every chunk is there.
            for clip in &manifest.clips {
                let pinned = self
                    .state()
                    .originals
                    .get(&clip.clip_id)
                    .is_some_and(|o| o.kind == OriginalKind::Pinned);
                if pinned && drive.original_cached(&clip.clip_id) < clip.size_bytes {
                    drive.prefetch_original(&clip.clip_id);
                }
            }
            let pinned_items = self.state().pinned_items;
            for item in &manifest.items {
                let Some(item_ref) = ItemRef::of(&item.kind, &item.id) else {
                    continue;
                };
                let key = item_ref.key();
                if pinned_items.contains_key(&item_ref.to_string())
                    && drive.cached(&key) < item.size_bytes
                {
                    drive.prefetch(key);
                }
            }
        }
        let now = iso_utc(self.clock.now_ms());
        self.status.update(|s| {
            s.state = SyncPhase::Idle;
            s.error = None;
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
}

fn pinned(state: &SyncState) -> Vec<String> {
    state
        .originals
        .iter()
        .filter(|(_, o)| o.kind == OriginalKind::Pinned)
        .map(|(id, _)| id.clone())
        .collect()
}

/// Cache keys of every file kept offline: pinned clip originals, then pinned items.
fn pinned_keys(state: &SyncState) -> Vec<String> {
    pinned(state)
        .iter()
        .map(|id| original_key(id))
        .chain(
            state
                .pinned_items
                .keys()
                .filter_map(|name| ItemRef::parse(name))
                .map(|item| item.key()),
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::state::LocalOriginal;

    #[test]
    fn kept_offline_keys_cover_clip_originals_and_items() {
        let mut state = SyncState::default();
        for (id, kind) in [("c1", OriginalKind::Pinned), ("c2", OriginalKind::Auto)] {
            state.originals.insert(
                id.into(),
                LocalOriginal {
                    file: None,
                    size_bytes: 0,
                    kind,
                    last_used_ms: 0,
                },
            );
        }
        state.pinned_items.insert("listen:l1".into(), 1);
        state.pinned_items.insert("bogus".into(), 1);

        assert_eq!(pinned_keys(&state), ["clip-c1", "listen-l1"]);
    }
}
