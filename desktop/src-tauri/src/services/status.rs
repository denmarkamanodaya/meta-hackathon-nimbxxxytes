//! `SyncStatus`, the shape `sync_status` returns and `sync://status` pushes (desktop bridge
//! contract), plus the live tracker the services update.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::Serialize;

/// Overall state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncPhase {
    /// Up to date.
    Idle,
    /// Working.
    Syncing,
    /// The server cannot be reached.
    Offline,
    /// No session; show sign-in.
    SignedOut,
    /// Another failure; see `error`.
    Error,
}

/// Item counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
pub struct Counts {
    /// Synced proxies.
    pub clips: usize,
    /// Synced renders.
    pub shorts: usize,
    /// Originals on disk (pinned and auto).
    pub originals_offline: usize,
}

/// Auto-original cache use.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Cache {
    /// Budget, gigabytes.
    pub budget_gb: f64,
    /// Bytes used by auto originals.
    pub auto_bytes: u64,
}

/// Kind of a running transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferKind {
    /// 720p proxy, down.
    Proxy,
    /// Original, down.
    Original,
    /// Final render, down.
    Render,
    /// Exported edit, up.
    Export,
}

/// Direction of a transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// Download.
    Down,
    /// Upload.
    Up,
}

/// One running transfer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Transfer {
    /// Stable id while it runs.
    pub id: String,
    /// What moves.
    pub kind: TransferKind,
    /// File name.
    pub name: String,
    /// Bytes so far.
    pub done_bytes: u64,
    /// Total bytes (0 when unknown).
    pub total_bytes: u64,
    /// Down or up.
    pub direction: Direction,
    /// The clip it belongs to (`null` for renders).
    pub clip_id: Option<String>,
}

/// Where a clip's proxy is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyState {
    /// Fully on disk.
    Synced,
    /// Downloading now.
    Downloading,
    /// Not on disk yet.
    Missing,
}

/// Why a clip's original is wanted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginalState {
    /// "Make available offline".
    Pinned,
    /// Fetched for an NLE export (evictable).
    Auto,
    /// Not wanted.
    None,
}

/// One ready clip's local state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ClipLocal {
    /// Clip id.
    pub clip_id: String,
    /// Proxy state.
    pub proxy: ProxyState,
    /// Original state.
    pub original: OriginalState,
    /// Whether the original is fully on disk.
    pub original_on_disk: bool,
    /// Proxy bytes on disk (0 unless synced).
    pub proxy_bytes: u64,
    /// Bytes of the original cached on this Mac by the drive.
    pub cached_bytes: u64,
    /// Last read of the cached original, ISO-8601 UTC; `None` when nothing is cached.
    pub last_read_at: Option<String>,
}

/// One recording's, document's or photo's local state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ItemLocal {
    /// The web's gallery item id: `listen:<id>`, `doc:<id>` or `photo:<id>`.
    pub item: String,
    /// Bytes of its original cached on this Mac by the drive.
    pub cached_bytes: u64,
    /// Last read of the cached original, ISO-8601 UTC; `None` when nothing is cached.
    pub last_read_at: Option<String>,
    /// Kept offline ("Make available offline").
    pub pinned: bool,
    /// Whether every byte of the original is cached.
    pub on_disk: bool,
}

/// State of a file in `Exports/`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportState {
    /// Size not stable yet.
    Waiting,
    /// Uploading.
    Uploading,
    /// Already in the library; moved to `Uploaded/` without uploading.
    Duplicate,
    /// Done; moved to `Uploaded/`.
    Uploaded,
    /// Failed; see `error`.
    Failed,
}

/// One export row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportRow {
    /// File name.
    pub name: String,
    /// Its state.
    pub state: ExportState,
    /// Server or local error text.
    pub error: Option<String>,
}

/// The whole status (desktop bridge `SyncStatus`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SyncStatus {
    /// Absolute sync folder.
    pub folder: String,
    /// Last finished sync, ISO-8601 UTC.
    pub last_sync_at: Option<String>,
    /// Overall state.
    pub state: SyncPhase,
    /// Error text for `error` / `offline`.
    pub error: Option<String>,
    /// Counts.
    pub counts: Counts,
    /// Clips whose originals are pinned offline.
    pub pinned_clip_ids: Vec<String>,
    /// Recordings, documents and photos kept offline, as item ids (`listen:<id>`, …).
    pub pinned_items: Vec<String>,
    /// Cache use.
    pub cache: Cache,
    /// Running transfers.
    pub transfers: Vec<Transfer>,
    /// Exports seen this session, newest last.
    pub exports: Vec<ExportRow>,
    /// Every ready clip of the library with its local state, library order.
    pub clips: Vec<ClipLocal>,
    /// Every recording, document and photo of the library with its local state, library order.
    pub items: Vec<ItemLocal>,
    /// Bytes of all synced proxies.
    pub local_proxy_bytes: u64,
    /// Bytes of pinned originals on disk.
    pub pinned_bytes: u64,
    /// Bytes of every file in the sync folder, the real on-disk total ("On this Mac").
    pub cache_bytes: u64,
    /// Renders in `Shorts/`.
    pub renders: usize,
    /// FCPXML files in `Projects/`.
    pub projects: usize,
    /// Poll period, seconds.
    pub poll_s: u64,
    /// The cache cap ("On this Mac" meter), bytes.
    pub cache_cap_bytes: u64,
    /// Seconds after its last read a file is freed (pinned files excepted).
    pub release_after_s: u64,
}

/// Live fields the services change; the snapshot adds counts from the sync state.
#[derive(Debug)]
pub struct Live {
    /// Overall state.
    pub state: SyncPhase,
    /// Error text.
    pub error: Option<String>,
    /// Last finished sync, ISO-8601 UTC.
    pub last_sync_at: Option<String>,
    /// Running transfers by id.
    pub transfers: BTreeMap<String, Transfer>,
    /// Export rows by file name.
    pub exports: BTreeMap<String, ExportRow>,
}

/// Shared live status.
pub struct StatusTracker {
    live: Mutex<Live>,
}

impl Default for StatusTracker {
    fn default() -> Self {
        Self {
            live: Mutex::new(Live {
                state: SyncPhase::Idle,
                error: None,
                last_sync_at: None,
                transfers: BTreeMap::new(),
                exports: BTreeMap::new(),
            }),
        }
    }
}

impl StatusTracker {
    /// Runs `change` on the live status.
    pub fn update(&self, change: impl FnOnce(&mut Live)) {
        if let Ok(mut live) = self.live.lock() {
            change(&mut live);
        }
    }

    /// Reads the live status.
    pub fn read<T>(&self, read: impl FnOnce(&Live) -> T) -> Option<T> {
        self.live.lock().ok().map(|live| read(&live))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_clip() -> ClipLocal {
        ClipLocal {
            clip_id: "c1".into(),
            proxy: ProxyState::Synced,
            original: OriginalState::Pinned,
            original_on_disk: false,
            proxy_bytes: 9,
            cached_bytes: 1_048_576,
            last_read_at: Some("2026-10-27T13:00:00.000Z".into()),
        }
    }

    fn sample_item() -> ItemLocal {
        ItemLocal {
            item: "doc:d1".into(),
            cached_bytes: 2_048,
            last_read_at: Some("2026-10-30T01:00:00.000Z".into()),
            pinned: true,
            on_disk: true,
        }
    }

    fn sample() -> SyncStatus {
        SyncStatus {
            folder: "/Users/me/nimbytes".into(),
            last_sync_at: None,
            state: SyncPhase::SignedOut,
            error: None,
            counts: Counts::default(),
            pinned_clip_ids: vec!["c1".into()],
            pinned_items: vec!["doc:d1".into()],
            cache: Cache {
                budget_gb: 20.0,
                auto_bytes: 0,
            },
            transfers: vec![Transfer {
                id: "t".into(),
                kind: TransferKind::Original,
                name: "a.mov".into(),
                done_bytes: 1,
                total_bytes: 2,
                direction: Direction::Down,
                clip_id: Some("c1".into()),
            }],
            exports: vec![ExportRow {
                name: "e.mp4".into(),
                state: ExportState::Uploaded,
                error: None,
            }],
            clips: vec![sample_clip()],
            items: vec![sample_item()],
            local_proxy_bytes: 9,
            pinned_bytes: 0,
            cache_bytes: 48_845_297,
            renders: 1,
            projects: 0,
            poll_s: 30,
            cache_cap_bytes: 5_000_000_000,
            release_after_s: 180,
        }
    }

    #[test]
    fn sync_status_serialises_with_the_bridge_field_names() {
        assert_eq!(
            serde_json::to_value(sample()).unwrap(),
            serde_json::json!({
                "folder": "/Users/me/nimbytes", "last_sync_at": null, "state": "signed_out", "error": null,
                "counts": { "clips": 0, "shorts": 0, "originals_offline": 0 },
                "pinned_clip_ids": ["c1"],
                "pinned_items": ["doc:d1"],
                "cache": { "budget_gb": 20.0, "auto_bytes": 0 },
                "transfers": [{ "id": "t", "kind": "original", "name": "a.mov", "done_bytes": 1,
                                "total_bytes": 2, "direction": "down", "clip_id": "c1" }],
                "exports": [{ "name": "e.mp4", "state": "uploaded", "error": null }],
                "clips": [{ "clip_id": "c1", "proxy": "synced", "original": "pinned",
                            "original_on_disk": false, "proxy_bytes": 9,
                            "cached_bytes": 1_048_576, "last_read_at": "2026-10-27T13:00:00.000Z" }],
                "items": [{ "item": "doc:d1", "cached_bytes": 2_048,
                            "last_read_at": "2026-10-30T01:00:00.000Z", "pinned": true, "on_disk": true }],
                "local_proxy_bytes": 9, "pinned_bytes": 0, "cache_bytes": 48_845_297, "renders": 1, "projects": 0, "poll_s": 30,
                "cache_cap_bytes": 5_000_000_000_u64, "release_after_s": 180
            })
        );
    }
}
