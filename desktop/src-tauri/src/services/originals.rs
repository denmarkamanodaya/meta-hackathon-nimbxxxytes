//! Originals on disk (pinned "Make available offline" and auto ones fetched for an NLE export,
//! evicted LRU above the budget), and local media lookups for the window.

use std::path::PathBuf;

use nimbytes_contracts::sync::{SyncClip, SyncManifest};

use crate::core::cache::{budget_bytes, evictions};
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::naming::original_file;
use crate::core::nle_project::LocalMedia;
use crate::core::state::{LocalOriginal, OriginalKind};
use crate::core::sync_plan::Folder;
use crate::services::sync::SyncEngine;

/// What `media_lookup` asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    /// A clip's proxy.
    Proxy,
    /// A clip's original.
    Original,
    /// A short's render.
    Render,
}

impl SyncEngine {
    /// The local path of a fully synced file, if there is one.
    pub fn media_path(&self, kind: MediaKind, id: &str) -> Option<PathBuf> {
        let state = self.state();
        let (folder, file) = match kind {
            MediaKind::Proxy => (Folder::Library, state.clips.get(id)?.file.clone()),
            MediaKind::Original => (Folder::Originals, state.originals.get(id)?.file.clone()?),
            MediaKind::Render => (Folder::Shorts, state.shorts.get(id)?.file.clone()),
        };
        let path = self.path(folder, &file);
        path.is_file().then_some(path)
    }

    /// Pins (downloads at the next round) or unpins an original. An unpinned original stays on
    /// disk as an auto one, so the budget decides when it goes.
    ///
    /// # Errors
    /// `IO` when `state.json` cannot be written.
    pub fn set_offline(&self, clip_id: &str, offline: bool) -> DesktopResult<()> {
        let now = self.clock.now_ms();
        self.update_state(|s| {
            if offline {
                let entry = s
                    .originals
                    .entry(clip_id.to_owned())
                    .or_insert(LocalOriginal {
                        file: None,
                        size_bytes: 0,
                        kind: OriginalKind::Pinned,
                        last_used_ms: now,
                    });
                entry.kind = OriginalKind::Pinned;
            } else if let Some(o) = s.originals.get_mut(clip_id) {
                if o.file.is_some() {
                    o.kind = OriginalKind::Auto;
                    o.last_used_ms = now;
                } else {
                    s.originals.remove(clip_id);
                }
            }
        })?;
        self.evict(&[]);
        self.sync_now();
        self.emit();
        Ok(())
    }

    /// Moves auto originals over the budget to the Trash, oldest use first; `keep` is spared.
    pub fn evict(&self, keep: &[String]) {
        let state = self.state();
        let budget = budget_bytes(self.budget_gb());
        for id in evictions(&state.originals, budget, keep) {
            let Some(file) = state.originals.get(&id).and_then(|o| o.file.clone()) else {
                continue;
            };
            if self
                .trash
                .trash(&self.path(Folder::Originals, &file))
                .is_ok()
            {
                let _ = self.update_state(|s| s.originals.remove(&id));
            }
        }
    }

    /// The best local media for each clip of an NLE export: the original (fetched now as an auto
    /// original when missing), else the proxy (fetched now when missing).
    ///
    /// # Errors
    /// The proxy download failure. Clips the manifest does not list are left out of the result.
    pub async fn media_for_export(&self, clip_ids: &[String]) -> DesktopResult<Vec<LocalMedia>> {
        let manifest = self.current_manifest().await?;
        let mut out = Vec::new();
        for id in clip_ids {
            // A clip deleted from the library has nothing to link; the cut leaves its shots out.
            let Some(clip) = manifest.clips.iter().find(|c| &c.clip_id == id) else {
                continue;
            };
            self.fetch_auto_original(clip).await;
            let now = self.clock.now_ms();
            self.update_state(|s| {
                if let Some(o) = s.originals.get_mut(id) {
                    o.last_used_ms = now;
                }
            })?;
            let (path, is_original) = match self.media_path(MediaKind::Original, id) {
                Some(p) => (p, true),
                None => (self.proxy_now(id).await?, false),
            };
            let path = path.to_string_lossy().into_owned();
            out.push(LocalMedia {
                clip: clip.clone(),
                path,
                is_original,
            });
        }
        self.evict(clip_ids);
        Ok(out)
    }

    async fn current_manifest(&self) -> DesktopResult<SyncManifest> {
        if let Some(m) = self.manifest.lock().ok().and_then(|m| m.clone()) {
            return Ok(m);
        }
        self.sync_once().await?;
        self.manifest
            .lock()
            .ok()
            .and_then(|m| m.clone())
            .ok_or_else(|| DesktopError::new(ErrorCode::NotFound, "library not synced yet"))
    }

    /// Fetches a missing original as an auto one. A failure is not fatal: the export links the
    /// proxy instead, and the auto entry is forgotten so nothing retries it.
    async fn fetch_auto_original(&self, clip: &SyncClip) {
        let id = &clip.clip_id;
        if self.media_path(MediaKind::Original, id).is_some() {
            return;
        }
        let now = self.clock.now_ms();
        let added = self.update_state(|s| {
            s.originals.entry(id.clone()).or_insert(LocalOriginal {
                file: None,
                size_bytes: 0,
                kind: OriginalKind::Auto,
                last_used_ms: now,
            });
        });
        let file = original_file(clip.recorded_at.as_deref(), &clip.title, id, &clip.ext);
        if added.is_ok() && self.download_original(id, &file).await.is_err() {
            let _ = self.update_state(|s| {
                let unfetched_auto = s
                    .originals
                    .get(id)
                    .is_some_and(|o| o.kind == OriginalKind::Auto && o.file.is_none());
                if unfetched_auto {
                    s.originals.remove(id);
                }
            });
        }
    }

    async fn proxy_now(&self, clip_id: &str) -> DesktopResult<PathBuf> {
        if let Some(path) = self.media_path(MediaKind::Proxy, clip_id) {
            return Ok(path);
        }
        self.drop_manifest();
        self.sync_once().await?;
        self.media_path(MediaKind::Proxy, clip_id).ok_or_else(|| {
            DesktopError::new(
                ErrorCode::NotFound,
                format!("proxy of {clip_id} did not download"),
            )
        })
    }
}
