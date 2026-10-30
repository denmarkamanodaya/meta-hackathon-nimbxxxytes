//! Originals on the drive: "Make available offline" pins a clip and caches every chunk of its
//! original; editor exports link the drive paths, which stream on demand. Also the drive paths
//! for Finder reveals.

use std::path::PathBuf;

use nimbytes_contracts::sync::SyncManifest;

use crate::core::drive::ItemRef;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::nle_project::LocalMedia;
use crate::core::state::{LocalOriginal, OriginalKind};
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
    /// A recording's, document's or photo's original; the id is `listen:<id>`, `doc:<id>` or
    /// `photo:<id>`.
    Item,
}

impl SyncEngine {
    /// The drive path of a clip's original, an item's original or a short's render (proxies stream from the cloud and
    /// have none).
    pub fn media_path(&self, kind: MediaKind, id: &str) -> Option<PathBuf> {
        let drive = self.drive()?;
        match kind {
            MediaKind::Proxy => None,
            MediaKind::Original => drive.original_path(id),
            MediaKind::Render => drive.render_path(id),
            MediaKind::Item => drive.item_path(&ItemRef::parse(id)?),
        }
    }

    /// Pins ("Make available offline": every chunk of the original is cached now) or unpins an
    /// original. Unpinned bytes stay cached until the cache needs the space.
    ///
    /// # Errors
    /// `IO` when `state.json` cannot be written.
    pub fn set_offline(&self, clip_id: &str, offline: bool) -> DesktopResult<()> {
        let now = self.clock.now_ms();
        self.update_state(|s| {
            if offline {
                s.originals.insert(
                    clip_id.to_owned(),
                    LocalOriginal {
                        file: None,
                        size_bytes: 0,
                        kind: OriginalKind::Pinned,
                        last_used_ms: now,
                    },
                );
            } else {
                s.originals.remove(clip_id);
            }
        })?;
        if offline && let Some(drive) = self.drive() {
            drive.prefetch_original(clip_id);
        }
        self.emit();
        Ok(())
    }

    /// Pins ("Make available offline": every chunk of the original is cached now) or unpins a
    /// recording, document or photo, named as the web names it (`listen:<id>`, `doc:<id>`,
    /// `photo:<id>`). Unpinned bytes stay cached until the cache needs the space.
    ///
    /// # Errors
    /// `NOT_FOUND` for a name that is not an item, `IO` when `state.json` cannot be written.
    pub fn set_item_offline(&self, item: &str, offline: bool) -> DesktopResult<()> {
        let item = ItemRef::parse(item)
            .ok_or_else(|| DesktopError::new(ErrorCode::NotFound, "not a library item"))?;
        let name = item.to_string();
        let now = self.clock.now_ms();
        self.update_state(|s| {
            if offline {
                s.pinned_items.insert(name, now);
            } else {
                s.pinned_items.remove(&name);
            }
        })?;
        if offline && let Some(drive) = self.drive() {
            drive.prefetch(item.key());
        }
        self.emit();
        Ok(())
    }

    /// The media an editor export links: each clip's original on the drive (it streams when the
    /// editor reads it, so nothing is downloaded first).
    ///
    /// # Errors
    /// `NOT_FOUND` before the first manifest. Clips the manifest does not list are left out.
    pub async fn media_for_export(&self, clip_ids: &[String]) -> DesktopResult<Vec<LocalMedia>> {
        let manifest = self.current_manifest().await?;
        let mut out = Vec::new();
        for id in clip_ids {
            // A clip deleted from the library has nothing to link; the cut leaves its shots out.
            let Some(clip) = manifest.clips.iter().find(|c| &c.clip_id == id) else {
                continue;
            };
            let Some(path) = self.media_path(MediaKind::Original, id) else {
                continue;
            };
            out.push(LocalMedia {
                clip: clip.clone(),
                path: path.to_string_lossy().into_owned(),
                is_original: true,
            });
        }
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
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;
    use crate::adapters::api_client::ApiClient;
    use crate::adapters::json_file::JsonFile;
    use crate::ports::{Clock, SessionStore};
    use crate::services::sync::SyncDeps;

    struct NoSession;
    impl SessionStore for NoSession {
        fn get(&self) -> DesktopResult<Option<String>> {
            Ok(None)
        }
        fn set(&self, _value: &str) -> DesktopResult<()> {
            Ok(())
        }
        fn clear(&self) -> DesktopResult<()> {
            Ok(())
        }
    }

    struct ClockAt(u64);
    impl Clock for ClockAt {
        fn now_ms(&self) -> u64 {
            self.0
        }
    }

    fn engine(state_file: &std::path::Path) -> SyncEngine {
        SyncEngine::new(SyncDeps {
            api: Arc::new(ApiClient::new(
                reqwest::Client::new(),
                None,
                Arc::new(NoSession),
                Duration::from_secs(1),
            )),
            clock: Arc::new(ClockAt(42)),
            state_file: JsonFile::new(state_file.to_path_buf()),
            folder: state_file.with_file_name("nimbytes"),
            budget_gb: 1.0,
        })
    }

    #[test]
    fn items_pin_and_unpin_by_their_web_name_and_the_pin_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("state.json");
        let sync = engine(&file);

        sync.set_item_offline("photo:p1", true).unwrap();
        sync.set_item_offline("doc:d1", true).unwrap();
        sync.set_item_offline("photo:p1", false).unwrap();

        assert_eq!(
            engine(&file).state().pinned_items,
            std::collections::BTreeMap::from([("doc:d1".to_owned(), 42)])
        );
        assert_eq!(sync.snapshot().pinned_items, ["doc:d1"]);
        assert!(sync.state().originals.is_empty(), "clip pins untouched");
        let err = sync.set_item_offline("c1", true).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }
}
