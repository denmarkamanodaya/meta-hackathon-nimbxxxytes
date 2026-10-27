//! What is on disk, as `state.json` records it: synced proxies, renders, originals and upload
//! progress for resume. File names are relative to their folder (`Library/`, `Shorts/`, …).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A synced proxy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalClip {
    /// File name in `Library/`.
    pub file: String,
    /// Size on disk, bytes.
    pub size_bytes: u64,
}

/// A synced final render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalShort {
    /// File name in `Shorts/`.
    pub file: String,
    /// The best version the render belongs to; a new best version is downloaded again.
    pub version: Option<u32>,
}

/// Why an original is on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OriginalKind {
    /// "Make available offline": never evicted.
    Pinned,
    /// Fetched for an NLE export; evicted least-recently-used above the budget.
    Auto,
}

/// An original wanted or held on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalOriginal {
    /// File name in `Originals/`; `None` until the download finished.
    pub file: Option<String>,
    /// Size on disk, bytes (0 until downloaded).
    pub size_bytes: u64,
    /// Pinned or auto.
    pub kind: OriginalKind,
    /// Last time an export used it, ms since the epoch (the LRU key).
    pub last_used_ms: u64,
}

/// A multipart upload of a file in `Exports/`, kept so a quit or crash resumes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadProgress {
    /// Server upload id.
    pub upload_id: String,
    /// The clip being created.
    pub clip_id: String,
    /// Bytes per part.
    pub part_size: u64,
    /// File size when the upload started; a different size restarts it.
    pub size_bytes: u64,
    /// Finished parts: number → `ETag` (quotes included).
    pub done: BTreeMap<u32, String>,
}

/// The whole `state.json`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SyncState {
    /// Last manifest `ETag` header, sent back as `If-None-Match`.
    #[serde(default)]
    pub etag: Option<String>,
    /// Synced proxies by clip id.
    #[serde(default)]
    pub clips: BTreeMap<String, LocalClip>,
    /// Synced renders by short id.
    #[serde(default)]
    pub shorts: BTreeMap<String, LocalShort>,
    /// Originals by clip id.
    #[serde(default)]
    pub originals: BTreeMap<String, LocalOriginal>,
    /// FCPXML files written to `Projects/`, by short id.
    #[serde(default)]
    pub projects: BTreeMap<String, String>,
    /// Clips each editor project links, by short id (their cached originals are kept longest).
    #[serde(default)]
    pub project_clips: BTreeMap<String, Vec<String>>,
    /// Uploads in progress by export file name.
    #[serde(default)]
    pub uploads: BTreeMap<String, UploadProgress>,
}
