//! The drive's chunk cache on disk, in Application Support: a `<key>/` folder per file with one
//! `<n>.chunk` file per cached 1 MiB chunk, and a `<key>.json` with which chunks it holds. One
//! file per chunk because APFS allocates the gaps of a sized file, so a sparse file would take
//! far more than the bytes read. It survives restarts; a file whose size changed starts empty.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::adapters::json_file::io;
use crate::core::drive::{CHUNK, cached_bytes, chunk_count};
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::ports::Clock;

/// What the cache knows about one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    size: u64,
    /// One character per chunk: `1` cached, `0` not.
    have: String,
    last_used_ms: u64,
}

impl Entry {
    fn empty(size: u64) -> Self {
        Self {
            size,
            have: "0".repeat(usize::try_from(chunk_count(size)).unwrap_or(0)),
            last_used_ms: 0,
        }
    }

    fn bits(&self) -> Vec<bool> {
        self.have.chars().map(|c| c == '1').collect()
    }
}

/// One cached file, for the eviction order and the status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedFile {
    /// Cache key.
    pub key: String,
    /// Bytes cached.
    pub bytes: u64,
    /// Last read or write, ms since the epoch.
    pub last_used_ms: u64,
}

/// A cached file: its cache key and full size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheFile<'a> {
    /// Cache key.
    pub key: &'a str,
    /// Full size, bytes.
    pub size: u64,
}

/// The cache.
pub struct ChunkCache {
    dir: PathBuf,
    clock: Arc<dyn Clock>,
    entries: Mutex<HashMap<String, Entry>>,
}

fn bad_key(key: &str) -> bool {
    key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl ChunkCache {
    /// Opens the cache in `dir` (created when missing) and loads what it holds.
    ///
    /// # Errors
    /// `IO` when the folder cannot be created or listed.
    pub fn open(dir: PathBuf, clock: Arc<dyn Clock>) -> DesktopResult<Self> {
        std::fs::create_dir_all(&dir).map_err(|e| io("create drive cache", &e))?;
        let mut entries = HashMap::new();
        for item in std::fs::read_dir(&dir).map_err(|e| io("list drive cache", &e))?.flatten() {
            let path = item.path();
            let Some(key) = path
                .extension()
                .filter(|ext| *ext == "json")
                .and_then(|_| path.file_stem())
                .and_then(|s| s.to_str())
            else {
                continue;
            };
            // Recovers: an unreadable index only costs a re-download of that file.
            let parsed = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Entry>(&bytes).ok());
            if let Some(entry) = parsed {
                entries.insert(key.to_owned(), entry);
            }
        }
        Ok(Self {
            dir,
            clock,
            entries: Mutex::new(entries),
        })
    }

    fn chunks(&self, key: &str) -> PathBuf {
        self.dir.join(key)
    }

    fn chunk(&self, key: &str, n: u64) -> PathBuf {
        self.chunks(key).join(format!("{n}.chunk"))
    }

    fn index(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.json"))
    }

    fn lock(&self) -> DesktopResult<std::sync::MutexGuard<'_, HashMap<String, Entry>>> {
        self.entries
            .lock()
            .map_err(|_| DesktopError::new(ErrorCode::Io, "drive cache lock poisoned"))
    }

    fn check(key: &str) -> DesktopResult<()> {
        if bad_key(key) {
            return Err(DesktopError::new(ErrorCode::BadPath, format!("bad cache key {key}")));
        }
        Ok(())
    }

    /// Which chunks of `key` (a file of `size` bytes) are cached. A size change forgets the old
    /// bytes.
    pub fn have(&self, key: &str, size: u64) -> Vec<bool> {
        let Ok(mut entries) = self.lock() else {
            return vec![false; usize::try_from(chunk_count(size)).unwrap_or(0)];
        };
        if entries.get(key).is_some_and(|e| e.size != size) {
            entries.remove(key);
            let _ = std::fs::remove_dir_all(self.chunks(key));
            let _ = std::fs::remove_file(self.index(key));
        }
        entries.get(key).map_or_else(|| Entry::empty(size).bits(), Entry::bits)
    }

    /// Stores `data` as the chunks of `file` starting at `first_chunk`. `data` must hold whole
    /// chunks, except that it may end at the end of the file.
    ///
    /// # Errors
    /// `BAD_PATH` for a bad key, `SIZE_MISMATCH` for a partial chunk, `IO` when a write fails.
    pub fn put(&self, file: CacheFile<'_>, first_chunk: u64, data: &[u8]) -> DesktopResult<()> {
        let CacheFile { key, size } = file;
        Self::check(key)?;
        let start = first_chunk.saturating_mul(CHUNK);
        let end = start + data.len() as u64;
        if end > size || (end != size && !(data.len() as u64).is_multiple_of(CHUNK)) {
            return Err(DesktopError::new(ErrorCode::SizeMismatch, "partial chunk"));
        }
        std::fs::create_dir_all(self.chunks(key)).map_err(|e| io("create cache folder", &e))?;
        for (i, bytes) in data.chunks(CHUNK as usize).enumerate() {
            std::fs::write(self.chunk(key, first_chunk + i as u64), bytes)
                .map_err(|e| io("write cache chunk", &e))?;
        }
        let mut entries = self.lock()?;
        let entry = entries.entry(key.to_owned()).or_insert_with(|| Entry::empty(size));
        let mut bits = entry.bits();
        for chunk in first_chunk..end.div_ceil(CHUNK) {
            if let Some(bit) = bits.get_mut(usize::try_from(chunk).unwrap_or(usize::MAX)) {
                *bit = true;
            }
        }
        entry.have = bits.iter().map(|b| if *b { '1' } else { '0' }).collect();
        entry.last_used_ms = self.clock.now_ms();
        let json = serde_json::to_vec(entry)
            .map_err(|e| DesktopError::new(ErrorCode::Io, format!("cache index: {e}")))?;
        std::fs::write(self.index(key), json).map_err(|e| io("write cache index", &e))
    }

    /// Reads `[start, start + len)` of `key`; the caller made sure the chunks are cached.
    ///
    /// # Errors
    /// `IO` when the file cannot be read.
    pub fn read(&self, key: &str, start: u64, len: u64) -> DesktopResult<Vec<u8>> {
        Self::check(key)?;
        let end = start.saturating_add(len);
        let mut buf = Vec::with_capacity(usize::try_from(len).unwrap_or(0));
        let mut pos = start;
        while pos < end {
            let n = pos / CHUNK;
            let bytes = std::fs::read(self.chunk(key, n)).map_err(|e| io("read cache chunk", &e))?;
            let from = usize::try_from(pos - n * CHUNK).unwrap_or(usize::MAX);
            let to = usize::try_from(end.min((n + 1) * CHUNK) - n * CHUNK).unwrap_or(usize::MAX);
            let part = bytes
                .get(from..to)
                .ok_or_else(|| DesktopError::new(ErrorCode::SizeMismatch, "short cache chunk"))?;
            buf.extend_from_slice(part);
            pos = (n + 1) * CHUNK;
        }
        if let Ok(mut entries) = self.lock()
            && let Some(entry) = entries.get_mut(key)
        {
            entry.last_used_ms = self.clock.now_ms();
        }
        Ok(buf)
    }

    /// Bytes cached for `key`.
    pub fn cached(&self, key: &str) -> u64 {
        self.lock()
            .ok()
            .and_then(|entries| entries.get(key).map(|e| cached_bytes(&e.bits(), e.size)))
            .unwrap_or(0)
    }

    /// Every cached file with its bytes and last use.
    pub fn files(&self) -> Vec<CachedFile> {
        let Ok(entries) = self.lock() else {
            return Vec::new();
        };
        let mut out: Vec<CachedFile> = entries
            .iter()
            .map(|(key, e)| CachedFile {
                key: key.clone(),
                bytes: cached_bytes(&e.bits(), e.size),
                last_used_ms: e.last_used_ms,
            })
            .filter(|f| f.bytes > 0)
            .collect();
        out.sort_by(|a, b| a.key.cmp(&b.key));
        out
    }

    /// Bytes the whole cache holds ("Space used on this Mac").
    pub fn total(&self) -> u64 {
        self.files().iter().map(|f| f.bytes).sum()
    }

    /// Drops every cached byte of `key`.
    ///
    /// # Errors
    /// `BAD_PATH` for a bad key.
    pub fn evict(&self, key: &str) -> DesktopResult<()> {
        Self::check(key)?;
        if let Ok(mut entries) = self.lock() {
            entries.remove(key);
        }
        // Recovers: a file that is already gone is the wanted state.
        let _ = std::fs::remove_dir_all(self.chunks(key));
        let _ = std::fs::remove_file(self.index(key));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: usize = 1024 * 1024;

    struct Clock0;
    impl Clock for Clock0 {
        fn now_ms(&self) -> u64 {
            7
        }
    }

    fn open(dir: &std::path::Path) -> ChunkCache {
        ChunkCache::open(dir.to_path_buf(), Arc::new(Clock0)).unwrap()
    }

    fn at(key: &str, size: u64) -> CacheFile<'_> {
        CacheFile { key, size }
    }

    #[test]
    fn stored_chunks_read_back_and_survive_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let size = (2 * MB + 10) as u64;
        let cache = open(dir.path());
        assert_eq!(cache.have("clip-a", size), vec![false, false, false]);

        let tail: Vec<u8> = (0..10u8).collect();
        cache.put(at("clip-a", size), 2, &tail).unwrap();
        cache.put(at("clip-a", size), 0, &vec![7u8; MB]).unwrap();

        let reopened = open(dir.path());
        assert_eq!(reopened.have("clip-a", size), vec![true, false, true]);
        assert_eq!(reopened.read("clip-a", (2 * MB) as u64 + 3, 4).unwrap(), vec![3, 4, 5, 6]);
        assert_eq!(reopened.cached("clip-a"), (MB + 10) as u64);
        assert_eq!(reopened.total(), (MB + 10) as u64);
        // Only the stored chunks take space: nothing for the missing middle chunk.
        assert!(!dir.path().join("clip-a/1.chunk").exists());
        let on_disk: u64 = std::fs::read_dir(dir.path().join("clip-a"))
            .unwrap()
            .map(|e| std::os::unix::fs::MetadataExt::blocks(&e.unwrap().metadata().unwrap()) * 512)
            .sum();
        assert!(on_disk < (MB + 64 * 1024) as u64, "{on_disk} bytes allocated");
    }

    #[test]
    fn a_partial_chunk_or_a_bad_key_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let cache = open(dir.path());
        let err = cache.put(at("clip-a", (3 * MB) as u64), 0, &[1, 2, 3]).unwrap_err();
        assert_eq!(err.code, ErrorCode::SizeMismatch);
        assert_eq!(cache.put(at("../x", 10), 0, &[0; 10]).unwrap_err().code, ErrorCode::BadPath);
    }

    #[test]
    fn a_size_change_or_an_eviction_forgets_the_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let cache = open(dir.path());
        cache.put(at("render-s-v1", 10), 0, &[1; 10]).unwrap();
        assert_eq!(cache.have("render-s-v1", 12), vec![false]);
        assert_eq!(cache.total(), 0);

        cache.put(at("clip-b", 10), 0, &[1; 10]).unwrap();
        cache.evict("clip-b").unwrap();
        assert_eq!(cache.cached("clip-b"), 0);
        assert!(!dir.path().join("clip-b").exists());
    }
}
