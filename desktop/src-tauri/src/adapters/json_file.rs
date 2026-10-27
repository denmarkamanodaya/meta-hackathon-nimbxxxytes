//! JSON files in `~/Library/Application Support/nimbytes/` (settings, sync state). Writes go to a
//! temp file first and are renamed into place, so a crash never leaves half a file.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};

pub(crate) fn io(context: &str, err: &std::io::Error) -> DesktopError {
    DesktopError::new(ErrorCode::Io, format!("{context}: {err}"))
}

/// One JSON document on disk.
#[derive(Debug, Clone)]
pub struct JsonFile {
    path: PathBuf,
}

impl JsonFile {
    /// A file at `path` (its folder is created on the first save).
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Where the file lives.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Reads the document; the type's default when the file is missing or unreadable JSON
    /// (state is a cache of what the server and the disk already hold, so it can be rebuilt).
    pub fn load_or_default<T: DeserializeOwned + Default>(&self) -> T {
        std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    /// Writes the document atomically.
    ///
    /// # Errors
    /// `IO` when the folder or file cannot be written.
    pub fn save<T: Serialize>(&self, value: &T) -> DesktopResult<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| io("create app support folder", &e))?;
        }
        let bytes = serde_json::to_vec_pretty(value)
            .map_err(|e| DesktopError::new(ErrorCode::Io, e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, bytes).map_err(|e| io("write state", &e))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| io("replace state", &e))
    }
}
