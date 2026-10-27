//! The nimbytes drive served as an NFS v3 export on 127.0.0.1 (crate `nfsserve`), which the app
//! mounts at `~/nimbytes`:
//!
//! - `Library/` every clip's original and `Shorts/` every finished render: full size, read-only,
//!   streamed through the chunk cache. Each reports as its space used only the bytes cached, so
//!   Finder shows "Zero bytes on disk" until something plays it.
//! - `Projects/` the FCPXML files the app writes for editors (kept in memory).
//! - `Exports/` the one writable folder: a view of a real staging folder in Application Support,
//!   where the exports service picks finished cuts up and uploads them.
//!
//! Finder previews read a file's head, index and a poster frame; those reads pass through in
//! memory and never reach the cache, so browsing keeps files at zero bytes.

use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use nfsserve::nfs::{
    fattr3, fileid3, filename3, ftype3, nfspath3, nfsstat3, nfstime3, sattr3, set_size3, specdata3,
};
use nfsserve::vfs::{DirEntry, NFSFileSystem, ReadDirResult, VFSCapabilities};
use tokio::sync::Notify;

use crate::adapters::chunk_cache::{CacheFile, ChunkCache};
use crate::core::drive::{
    CHUNK, DriveFile, DriveListing, FileIds, PROMOTE_WINDOW_MS, READ_AHEAD, fetch_runs,
    looks_like_playback, span, split_runs,
};
use crate::core::error::{DesktopError, ErrorCode};
use crate::ports::{Clock, RangeSource};

const ROOT: fileid3 = 1;
const LIBRARY: fileid3 = 2;
const PROJECTS: fileid3 = 3;
const SHORTS: fileid3 = 4;
const EXPORTS: fileid3 = 5;
const NEVER_INDEX: fileid3 = 6;
/// First id of a streamed file or project.
const FIRST_FILE: fileid3 = 1000;
/// First id of a file or folder inside `Exports/`.
const FIRST_EXPORT: fileid3 = 1 << 40;
/// Pass-through reads fetch this aligned window and keep the last few in memory only, so a
/// preview's many small reads cost few requests and nothing on disk.
const PREVIEW_WINDOW: u64 = 256 * 1024;
const PREVIEW_WINDOWS_KEPT: usize = 8;
/// Longest request when caching, chunks (bounds memory per request).
const MAX_RUN: u64 = 8;
/// Permission bits: read-only files and folders, a writable `Exports/`.
const MODE_RO_DIR: u32 = 0o555;
const MODE_RO_FILE: u32 = 0o444;
const MODE_RW_DIR: u32 = 0o755;
const MODE_RW_FILE: u32 = 0o644;
/// File system id reported for every item ("nimb").
const FSID: u64 = 0x6e69_6d62;

/// A streamed file with its known size.
#[derive(Debug, Clone)]
struct Stream {
    file: DriveFile,
    size: u64,
}

impl Stream {
    fn cache(&self) -> CacheFile<'_> {
        CacheFile {
            key: &self.file.key,
            size: self.size,
        }
    }
}

/// What a fixed or listed id is.
#[derive(Debug, Clone)]
enum Node {
    Dir { name: &'static str, parent: fileid3 },
    Stream(Stream),
    Blob { name: String, data: Arc<Vec<u8>> },
}

/// Type and permissions of an item.
#[derive(Debug, Clone, Copy)]
enum AttrKind {
    ReadOnlyDir,
    ReadOnlyFile,
    WritableDir,
    WritableFile,
}

impl AttrKind {
    fn ftype_mode(self) -> (ftype3, u32) {
        match self {
            Self::ReadOnlyDir => (ftype3::NF3DIR, MODE_RO_DIR),
            Self::ReadOnlyFile => (ftype3::NF3REG, MODE_RO_FILE),
            Self::WritableDir => (ftype3::NF3DIR, MODE_RW_DIR),
            Self::WritableFile => (ftype3::NF3REG, MODE_RW_FILE),
        }
    }
}

/// What the drive is built from.
pub struct DriveDeps {
    /// Where streamed bytes come from.
    pub source: Arc<dyn RangeSource>,
    /// The chunk cache.
    pub cache: Arc<ChunkCache>,
    /// Wall clock (preview promotion).
    pub clock: Arc<dyn Clock>,
    /// The real folder behind `Exports/`.
    pub exports_dir: PathBuf,
    /// Owner of every item: the user's uid and gid.
    pub owner: (u32, u32),
}

/// The listed files and their ids.
struct Tree {
    ids: FileIds,
    nodes: HashMap<fileid3, Node>,
    library: Vec<fileid3>,
    shorts: Vec<fileid3>,
    projects: Vec<fileid3>,
}

/// `Exports/` paths (relative to the staging folder) and their ids. An id follows its path
/// through a rename, so an editor writing a file keeps its handle.
struct ExportIds {
    next: fileid3,
    by_id: HashMap<fileid3, PathBuf>,
    by_path: HashMap<PathBuf, fileid3>,
}

impl ExportIds {
    fn id(&mut self, rel: &Path) -> fileid3 {
        if let Some(id) = self.by_path.get(rel) {
            return *id;
        }
        let id = self.next;
        self.next += 1;
        self.by_id.insert(id, rel.to_path_buf());
        self.by_path.insert(rel.to_path_buf(), id);
        id
    }

    fn moved(&mut self, from: &Path, to: &Path) {
        if let Some(id) = self.by_path.remove(from) {
            self.by_path.insert(to.to_path_buf(), id);
            self.by_id.insert(id, to.to_path_buf());
        }
    }
}

/// Per file: recent pass-through reads, whether it caches now, and its preview windows.
#[derive(Default)]
struct ReadState {
    recent: Vec<(u64, u64)>,
    promoted: bool,
    preview: Vec<(u64, Arc<Vec<u8>>)>,
}

/// The drive.
pub struct Drive {
    tree: RwLock<Tree>,
    exports: Mutex<ExportIds>,
    exports_dir: PathBuf,
    source: Arc<dyn RangeSource>,
    cache: Arc<ChunkCache>,
    clock: Arc<dyn Clock>,
    reads: Mutex<HashMap<String, ReadState>>,
    inflight: Mutex<HashSet<(String, u64)>>,
    fetched: Notify,
    uid: u32,
    gid: u32,
    started: nfstime3,
}

fn time(at: SystemTime) -> nfstime3 {
    let d = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    nfstime3 {
        seconds: u32::try_from(d.as_secs()).unwrap_or(u32::MAX),
        nseconds: d.subsec_nanos(),
    }
}

fn io_error(context: &str, err: &DesktopError) -> nfsstat3 {
    eprintln!("drive {context}: {err}");
    nfsstat3::NFS3ERR_IO
}

fn fs_error(err: &std::io::Error) -> nfsstat3 {
    match err.kind() {
        std::io::ErrorKind::NotFound => nfsstat3::NFS3ERR_NOENT,
        std::io::ErrorKind::AlreadyExists => nfsstat3::NFS3ERR_EXIST,
        std::io::ErrorKind::PermissionDenied => nfsstat3::NFS3ERR_ACCES,
        std::io::ErrorKind::DirectoryNotEmpty => nfsstat3::NFS3ERR_NOTEMPTY,
        _ => nfsstat3::NFS3ERR_IO,
    }
}

/// A single plain file or folder name: no `/`, not `.` or `..`.
fn plain_name(name: &filename3) -> Result<PathBuf, nfsstat3> {
    let text = std::str::from_utf8(name.as_ref()).map_err(|_| nfsstat3::NFS3ERR_INVAL)?;
    let path = PathBuf::from(text);
    let mut parts = path.components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(_)), None) => Ok(path),
        _ => Err(nfsstat3::NFS3ERR_INVAL),
    }
}

/// The folders and files every drive has.
fn fixed_nodes() -> HashMap<fileid3, Node> {
    let dir = |name, parent| Node::Dir { name, parent };
    HashMap::from([
        (ROOT, dir("", ROOT)),
        (LIBRARY, dir("Library", ROOT)),
        (PROJECTS, dir("Projects", ROOT)),
        (SHORTS, dir("Shorts", ROOT)),
        // Keeps Spotlight from reading (and so downloading) every original.
        (
            NEVER_INDEX,
            Node::Blob {
                name: ".metadata_never_index".into(),
                data: Arc::new(Vec::new()),
            },
        ),
    ])
}

impl Drive {
    /// Builds an empty drive; [`Drive::set_listing`] fills it.
    pub fn new(deps: DriveDeps) -> Self {
        Self {
            tree: RwLock::new(Tree {
                ids: FileIds::new(FIRST_FILE),
                nodes: fixed_nodes(),
                library: Vec::new(),
                shorts: Vec::new(),
                projects: Vec::new(),
            }),
            exports: Mutex::new(ExportIds {
                next: FIRST_EXPORT,
                by_id: HashMap::new(),
                by_path: HashMap::new(),
            }),
            exports_dir: deps.exports_dir,
            source: deps.source,
            cache: deps.cache,
            clock: deps.clock,
            reads: Mutex::new(HashMap::new()),
            inflight: Mutex::new(HashSet::new()),
            fetched: Notify::new(),
            uid: deps.owner.0,
            gid: deps.owner.1,
            started: time(SystemTime::now()),
        }
    }

    /// Replaces the listed files. Files without a known size are left out until it is known.
    pub fn set_listing(&self, listing: &DriveListing) {
        let Ok(mut tree) = self.tree.write() else {
            return;
        };
        let streams = |tree: &mut Tree, files: &[DriveFile]| -> Vec<fileid3> {
            files
                .iter()
                .filter_map(|file| {
                    let size = file.size?;
                    let id = tree.ids.id(&file.key);
                    tree.nodes.insert(
                        id,
                        Node::Stream(Stream {
                            file: file.clone(),
                            size,
                        }),
                    );
                    Some(id)
                })
                .collect()
        };
        let library = streams(&mut tree, &listing.library);
        let shorts = streams(&mut tree, &listing.shorts);
        let gone: Vec<fileid3> = tree
            .library
            .iter()
            .chain(&tree.shorts)
            .filter(|id| !library.contains(id) && !shorts.contains(id))
            .copied()
            .collect();
        for id in gone {
            tree.nodes.remove(&id);
        }
        tree.library = library;
        tree.shorts = shorts;
    }

    /// Writes (or replaces) a file in `Projects/`.
    pub fn put_project(&self, name: &str, data: Vec<u8>) {
        let Ok(mut tree) = self.tree.write() else {
            return;
        };
        let id = tree.ids.id(&format!("project-{name}"));
        tree.nodes.insert(
            id,
            Node::Blob {
                name: name.to_owned(),
                data: Arc::new(data),
            },
        );
        if !tree.projects.contains(&id) {
            tree.projects.push(id);
        }
    }

    /// Keys with chunks being fetched now (never evicted mid-read).
    pub fn busy_keys(&self) -> Vec<String> {
        self.inflight
            .lock()
            .map(|set| set.iter().map(|(key, _)| key.clone()).collect())
            .unwrap_or_default()
    }

    /// Caches every chunk of a listed file (for "Make available offline").
    ///
    /// # Errors
    /// The first failed fetch.
    pub async fn prefetch(&self, key: &str) -> Result<(), DesktopError> {
        let found = self.tree.read().ok().and_then(|tree| {
            tree.nodes.values().find_map(|node| match node {
                Node::Stream(stream) if stream.file.key == key => Some(stream.clone()),
                _ => None,
            })
        });
        match found {
            Some(stream) if stream.size > 0 => {
                let last = (stream.size - 1) / CHUNK;
                self.ensure(&stream, (0, last), 0).await
            }
            _ => Ok(()),
        }
    }

    fn node(&self, id: fileid3) -> Option<Node> {
        self.tree.read().ok()?.nodes.get(&id).cloned()
    }

    fn children(&self, dir: fileid3) -> Vec<fileid3> {
        let Ok(tree) = self.tree.read() else {
            return Vec::new();
        };
        match dir {
            ROOT => vec![LIBRARY, PROJECTS, SHORTS, EXPORTS, NEVER_INDEX],
            LIBRARY => tree.library.clone(),
            SHORTS => tree.shorts.clone(),
            PROJECTS => tree.projects.clone(),
            _ => Vec::new(),
        }
    }

    fn name_of(&self, id: fileid3) -> Option<String> {
        match self.node(id)? {
            Node::Dir { name, .. } => Some(name.to_owned()),
            Node::Stream(stream) => Some(stream.file.name),
            Node::Blob { name, .. } => Some(name),
        }
    }

    /// Attributes; `bytes` is the size and the space used.
    fn attr(&self, id: fileid3, kind: AttrKind, bytes: (u64, u64)) -> fattr3 {
        let (ftype, mode) = kind.ftype_mode();
        let (size, used) = bytes;
        fattr3 {
            ftype,
            mode,
            nlink: 1,
            uid: self.uid,
            gid: self.gid,
            size,
            used,
            rdev: specdata3::default(),
            fsid: FSID,
            fileid: id,
            atime: self.started,
            mtime: self.started,
            ctime: self.started,
        }
    }

    fn listed_attr(&self, id: fileid3) -> Result<fattr3, nfsstat3> {
        if id == EXPORTS {
            return self.export_attr(id, Path::new(""));
        }
        match self.node(id).ok_or(nfsstat3::NFS3ERR_NOENT)? {
            Node::Dir { .. } => Ok(self.attr(id, AttrKind::ReadOnlyDir, (4096, 4096))),
            Node::Blob { data, .. } => {
                let len = data.len() as u64;
                Ok(self.attr(id, AttrKind::ReadOnlyFile, (len, len)))
            }
            Node::Stream(stream) => Ok(self.attr(
                id,
                AttrKind::ReadOnlyFile,
                (stream.size, self.cache.cached(&stream.file.key)),
            )),
        }
    }

    // ---- Exports/ (a view of the staging folder) ----

    fn export_path(&self, id: fileid3) -> Option<PathBuf> {
        if id == EXPORTS {
            return Some(PathBuf::new());
        }
        self.exports.lock().ok()?.by_id.get(&id).cloned()
    }

    fn export_id(&self, rel: &Path) -> Result<fileid3, nfsstat3> {
        if rel.as_os_str().is_empty() {
            return Ok(EXPORTS);
        }
        let mut ids = self.exports.lock().map_err(|_| nfsstat3::NFS3ERR_IO)?;
        Ok(ids.id(rel))
    }

    fn export_attr(&self, id: fileid3, rel: &Path) -> Result<fattr3, nfsstat3> {
        let meta =
            std::fs::symlink_metadata(self.exports_dir.join(rel)).map_err(|e| fs_error(&e))?;
        let kind = if meta.is_dir() {
            AttrKind::WritableDir
        } else {
            AttrKind::WritableFile
        };
        let used = std::os::unix::fs::MetadataExt::blocks(&meta) * 512;
        let mut attr = self.attr(id, kind, (meta.len(), used));
        if let Ok(modified) = meta.modified() {
            attr.mtime = time(modified);
            attr.ctime = attr.mtime;
        }
        Ok(attr)
    }

    /// Looks `name` up in the `Exports/` folder `dir` (staging path `parent`).
    fn export_lookup(
        &self,
        dir: fileid3,
        parent: &Path,
        name: &filename3,
    ) -> Result<fileid3, nfsstat3> {
        match name.as_ref() {
            b"." => Ok(dir),
            b".." => match parent.parent() {
                Some(up) if !parent.as_os_str().is_empty() => self.export_id(up),
                _ => Ok(ROOT),
            },
            _ => {
                let rel = self.export_child(dir, name)?;
                std::fs::symlink_metadata(self.exports_dir.join(&rel)).map_err(|e| fs_error(&e))?;
                self.export_id(&rel)
            }
        }
    }

    /// The ids in folder `dir`, in listing order.
    fn dir_ids(&self, dir: fileid3) -> Result<Vec<fileid3>, nfsstat3> {
        if let Some(rel) = self.export_path(dir) {
            let mut names: Vec<PathBuf> = std::fs::read_dir(self.exports_dir.join(&rel))
                .map_err(|e| fs_error(&e))?
                .flatten()
                .map(|e| rel.join(e.file_name()))
                .collect();
            names.sort();
            return names.iter().map(|p| self.export_id(p)).collect();
        }
        match self.node(dir).ok_or(nfsstat3::NFS3ERR_NOENT)? {
            Node::Dir { .. } => Ok(self.children(dir)),
            _ => Err(nfsstat3::NFS3ERR_NOTDIR),
        }
    }

    /// One listing entry.
    fn entry(&self, id: fileid3) -> Result<DirEntry, nfsstat3> {
        let (name, attr) = match self.export_path(id) {
            Some(rel) => (
                rel.file_name()
                    .map_or_else(|| "Exports".into(), |n| n.to_string_lossy().into_owned()),
                self.export_attr(id, &rel)?,
            ),
            None => (self.name_of(id).unwrap_or_default(), self.listed_attr(id)?),
        };
        Ok(DirEntry {
            fileid: id,
            name: name.into_bytes().into(),
            attr,
        })
    }

    /// The staging path of `name` in the `Exports/` folder `dir`.
    fn export_child(&self, dir: fileid3, name: &filename3) -> Result<PathBuf, nfsstat3> {
        let parent = self.export_path(dir).ok_or(nfsstat3::NFS3ERR_ROFS)?;
        Ok(parent.join(plain_name(name)?))
    }

    // ---- streamed reads ----

    async fn read_stream(
        &self,
        stream: &Stream,
        offset: u64,
        count: u32,
    ) -> Result<(Vec<u8>, bool), nfsstat3> {
        let (file, size) = (&stream.file, stream.size);
        let Some(sp) = span(offset, u64::from(count), size) else {
            return Ok((Vec::new(), true));
        };
        let eof = sp.end == size;
        let have = self.cache.have(&file.key, size);
        let all_cached =
            (sp.first..=sp.last).all(|c| have.get(c as usize).copied().unwrap_or(false));
        let now = self.clock.now_ms();
        if !all_cached && !self.is_promoted(&file.key) {
            let data = self.preview_read(stream, (sp.start, sp.end)).await?;
            self.note_preview(stream, now, sp.end - sp.start);
            return Ok((data, eof));
        }
        self.ensure(stream, (sp.first, sp.last), READ_AHEAD)
            .await
            .map_err(|e| io_error("fetch", &e))?;
        let data = self
            .cache
            .read(&file.key, sp.start, sp.end - sp.start)
            .map_err(|e| io_error("cache read", &e))?;
        Ok((data, eof))
    }

    /// Records a pass-through read and promotes the file once reads look like playback.
    fn note_preview(&self, stream: &Stream, now: u64, bytes: u64) {
        if let Ok(mut reads) = self.reads.lock() {
            let state = reads.entry(stream.file.key.clone()).or_default();
            state.recent.push((now, bytes));
            state
                .recent
                .retain(|(at, _)| now.saturating_sub(*at) <= PROMOTE_WINDOW_MS);
            state.promoted = looks_like_playback(&state.recent, now, stream.size);
        }
    }

    fn is_promoted(&self, key: &str) -> bool {
        self.reads
            .lock()
            .ok()
            .and_then(|r| r.get(key).map(|s| s.promoted))
            .unwrap_or(false)
    }

    /// Serves `[start, end)` from in-memory preview windows, fetching missing aligned windows.
    async fn preview_read(&self, stream: &Stream, bytes: (u64, u64)) -> Result<Vec<u8>, nfsstat3> {
        let (start, end) = bytes;
        let mut out = Vec::with_capacity(usize::try_from(end - start).unwrap_or(0));
        let mut pos = start;
        while pos < end {
            let window_start = pos / PREVIEW_WINDOW * PREVIEW_WINDOW;
            let window = self.preview_window(stream, window_start).await?;
            let to = end.min(window_start + window.len() as u64);
            let from = usize::try_from(pos - window_start).unwrap_or(usize::MAX);
            let upto = usize::try_from(to - window_start).unwrap_or(usize::MAX);
            out.extend_from_slice(window.get(from..upto).ok_or(nfsstat3::NFS3ERR_IO)?);
            pos = to;
        }
        Ok(out)
    }

    /// The in-memory preview window starting at `start`, fetched when not held.
    async fn preview_window(&self, stream: &Stream, start: u64) -> Result<Arc<Vec<u8>>, nfsstat3> {
        let key = &stream.file.key;
        let held = self.reads.lock().ok().and_then(|r| {
            r.get(key)?
                .preview
                .iter()
                .find(|(s, _)| *s == start)
                .map(|(_, d)| d.clone())
        });
        if let Some(data) = held {
            return Ok(data);
        }
        let len = PREVIEW_WINDOW.min(stream.size - start);
        let data = Arc::new(
            self.source
                .range(&stream.file.media, start, len)
                .await
                .map_err(|e| io_error("preview fetch", &e))?,
        );
        if let Ok(mut reads) = self.reads.lock() {
            let state = reads.entry(key.clone()).or_default();
            if state.preview.len() >= PREVIEW_WINDOWS_KEPT {
                state.preview.remove(0);
            }
            state.preview.push((start, data.clone()));
        }
        Ok(data)
    }

    /// Makes chunks `first..=last` cached, fetching what is missing (plus `read_ahead`). Readers
    /// of the same chunk share one fetch: a chunk another reader is fetching is waited for.
    async fn ensure(
        &self,
        stream: &Stream,
        chunks: (u64, u64),
        read_ahead: u64,
    ) -> Result<(), DesktopError> {
        let key = &stream.file.key;
        loop {
            let have = self.cache.have(key, stream.size);
            let runs = split_runs(&fetch_runs(&have, chunks.0, chunks.1, read_ahead), MAX_RUN);
            if runs.is_empty() {
                return Ok(());
            }
            let fetched = self.fetched.notified();
            tokio::pin!(fetched);
            fetched.as_mut().enable();
            let mine = self.claim(key, runs)?;
            if mine.is_empty() {
                fetched.await;
                continue;
            }
            let mut result = Ok(());
            for run in mine {
                if result.is_ok() {
                    result = self.fetch_run(stream, run).await;
                }
                if let Ok(mut inflight) = self.inflight.lock() {
                    for c in run.0..run.1 {
                        inflight.remove(&(key.clone(), c));
                    }
                }
                self.fetched.notify_waiters();
            }
            result?;
        }
    }

    /// Marks the runs no other reader is fetching as in flight and returns them.
    fn claim(&self, key: &str, runs: Vec<(u64, u64)>) -> Result<Vec<(u64, u64)>, DesktopError> {
        let mut inflight = self
            .inflight
            .lock()
            .map_err(|_| DesktopError::new(ErrorCode::Io, "inflight lock poisoned"))?;
        let mut mine = Vec::new();
        for (from, to) in runs {
            if (from..to).all(|c| !inflight.contains(&(key.to_owned(), c))) {
                for c in from..to {
                    inflight.insert((key.to_owned(), c));
                }
                mine.push((from, to));
            }
        }
        Ok(mine)
    }

    async fn fetch_run(&self, stream: &Stream, run: (u64, u64)) -> Result<(), DesktopError> {
        let start = run.0 * CHUNK;
        let len = (run.1 * CHUNK).min(stream.size) - start;
        let data = self.source.range(&stream.file.media, start, len).await?;
        self.cache.put(stream.cache(), run.0, &data)
    }
}

/// The drive as `nfsserve` serves it (it takes ownership; the app keeps the shared [`Drive`]).
pub struct DriveFs(pub Arc<Drive>);

#[async_trait]
impl NFSFileSystem for DriveFs {
    fn capabilities(&self) -> VFSCapabilities {
        VFSCapabilities::ReadWrite
    }

    fn root_dir(&self) -> fileid3 {
        ROOT
    }

    async fn lookup(&self, dirid: fileid3, filename: &filename3) -> Result<fileid3, nfsstat3> {
        let d = &self.0;
        if let Some(parent) = d.export_path(dirid) {
            return d.export_lookup(dirid, &parent, filename);
        }
        let parent = match d.node(dirid).ok_or(nfsstat3::NFS3ERR_NOENT)? {
            Node::Dir { parent, .. } => parent,
            _ => return Err(nfsstat3::NFS3ERR_NOTDIR),
        };
        match filename.as_ref() {
            b"." => return Ok(dirid),
            b".." => return Ok(parent),
            _ => {}
        }
        d.children(dirid)
            .into_iter()
            .find(|id| {
                if *id == EXPORTS {
                    return filename.as_ref() == b"Exports";
                }
                d.name_of(*id)
                    .is_some_and(|n| n.as_bytes() == filename.as_ref())
            })
            .ok_or(nfsstat3::NFS3ERR_NOENT)
    }

    async fn getattr(&self, id: fileid3) -> Result<fattr3, nfsstat3> {
        match self.0.export_path(id) {
            Some(rel) => self.0.export_attr(id, &rel),
            None => self.0.listed_attr(id),
        }
    }

    async fn setattr(&self, id: fileid3, setattr: sattr3) -> Result<fattr3, nfsstat3> {
        let rel = self.0.export_path(id).ok_or(nfsstat3::NFS3ERR_ROFS)?;
        if let set_size3::size(size) = setattr.size {
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(self.0.exports_dir.join(&rel))
                .map_err(|e| fs_error(&e))?;
            file.set_len(size).map_err(|e| fs_error(&e))?;
        }
        self.0.export_attr(id, &rel)
    }

    async fn read(
        &self,
        id: fileid3,
        offset: u64,
        count: u32,
    ) -> Result<(Vec<u8>, bool), nfsstat3> {
        if let Some(rel) = self.0.export_path(id) {
            let file =
                std::fs::File::open(self.0.exports_dir.join(rel)).map_err(|e| fs_error(&e))?;
            let size = file.metadata().map_err(|e| fs_error(&e))?.len();
            let Some(sp) = span(offset, u64::from(count), size) else {
                return Ok((Vec::new(), true));
            };
            let mut buf = vec![0; usize::try_from(sp.end - sp.start).unwrap_or(0)];
            std::os::unix::fs::FileExt::read_exact_at(&file, &mut buf, sp.start)
                .map_err(|e| fs_error(&e))?;
            return Ok((buf, sp.end == size));
        }
        match self.0.node(id).ok_or(nfsstat3::NFS3ERR_NOENT)? {
            Node::Dir { .. } => Err(nfsstat3::NFS3ERR_ISDIR),
            Node::Blob { data, .. } => {
                let start = usize::try_from(offset)
                    .unwrap_or(usize::MAX)
                    .min(data.len());
                let end = start.saturating_add(count as usize).min(data.len());
                Ok((data[start..end].to_vec(), end == data.len()))
            }
            Node::Stream(stream) => self.0.read_stream(&stream, offset, count).await,
        }
    }

    async fn write(&self, id: fileid3, offset: u64, data: &[u8]) -> Result<fattr3, nfsstat3> {
        let rel = self.0.export_path(id).ok_or(nfsstat3::NFS3ERR_ROFS)?;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(self.0.exports_dir.join(&rel))
            .map_err(|e| fs_error(&e))?;
        std::os::unix::fs::FileExt::write_all_at(&file, data, offset).map_err(|e| fs_error(&e))?;
        self.0.export_attr(id, &rel)
    }

    async fn create(
        &self,
        dirid: fileid3,
        filename: &filename3,
        _attr: sattr3,
    ) -> Result<(fileid3, fattr3), nfsstat3> {
        let rel = self.0.export_child(dirid, filename)?;
        std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(self.0.exports_dir.join(&rel))
            .map_err(|e| fs_error(&e))?;
        let id = self.0.export_id(&rel)?;
        Ok((id, self.0.export_attr(id, &rel)?))
    }

    async fn create_exclusive(
        &self,
        dirid: fileid3,
        filename: &filename3,
    ) -> Result<fileid3, nfsstat3> {
        let rel = self.0.export_child(dirid, filename)?;
        std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(self.0.exports_dir.join(&rel))
            .map_err(|e| fs_error(&e))?;
        self.0.export_id(&rel)
    }

    async fn mkdir(
        &self,
        dirid: fileid3,
        dirname: &filename3,
    ) -> Result<(fileid3, fattr3), nfsstat3> {
        let rel = self.0.export_child(dirid, dirname)?;
        std::fs::create_dir(self.0.exports_dir.join(&rel)).map_err(|e| fs_error(&e))?;
        let id = self.0.export_id(&rel)?;
        Ok((id, self.0.export_attr(id, &rel)?))
    }

    async fn remove(&self, dirid: fileid3, filename: &filename3) -> Result<(), nfsstat3> {
        let rel = self.0.export_child(dirid, filename)?;
        let path = self.0.exports_dir.join(&rel);
        let meta = std::fs::symlink_metadata(&path).map_err(|e| fs_error(&e))?;
        if meta.is_dir() {
            std::fs::remove_dir(&path).map_err(|e| fs_error(&e))
        } else {
            std::fs::remove_file(&path).map_err(|e| fs_error(&e))
        }
    }

    async fn rename(
        &self,
        from_dir: fileid3,
        from: &filename3,
        to_dir: fileid3,
        to: &filename3,
    ) -> Result<(), nfsstat3> {
        let from_rel = self.0.export_child(from_dir, from)?;
        let to_rel = self.0.export_child(to_dir, to)?;
        std::fs::rename(
            self.0.exports_dir.join(&from_rel),
            self.0.exports_dir.join(&to_rel),
        )
        .map_err(|e| fs_error(&e))?;
        if let Ok(mut ids) = self.0.exports.lock() {
            ids.moved(&from_rel, &to_rel);
        }
        Ok(())
    }

    async fn readdir(
        &self,
        dirid: fileid3,
        start_after: fileid3,
        max_entries: usize,
    ) -> Result<ReadDirResult, nfsstat3> {
        let ids = self.0.dir_ids(dirid)?;
        let skip = if start_after == 0 {
            0
        } else {
            ids.iter()
                .position(|id| *id == start_after)
                .map_or(ids.len(), |p| p + 1)
        };
        let entries = ids
            .iter()
            .skip(skip)
            .take(max_entries)
            .map(|id| self.0.entry(*id))
            .collect::<Result<Vec<_>, _>>()?;
        let end = skip + entries.len() >= ids.len();
        Ok(ReadDirResult { entries, end })
    }

    async fn symlink(
        &self,
        _d: fileid3,
        _l: &filename3,
        _s: &nfspath3,
        _a: &sattr3,
    ) -> Result<(fileid3, fattr3), nfsstat3> {
        Err(nfsstat3::NFS3ERR_NOTSUPP)
    }

    async fn readlink(&self, _id: fileid3) -> Result<nfspath3, nfsstat3> {
        Err(nfsstat3::NFS3ERR_NOTSUPP)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;
    use crate::core::drive::{DriveListing, Media};
    use crate::core::error::DesktopResult;

    const MB: u64 = 1024 * 1024;

    /// Serves bytes `i % 251` and counts requested bytes.
    struct FakeSource {
        requested: AtomicU64,
        requests: AtomicU64,
    }

    #[async_trait]
    impl RangeSource for FakeSource {
        async fn range(&self, _media: &Media, start: u64, len: u64) -> DesktopResult<Vec<u8>> {
            self.requested.fetch_add(len, Ordering::SeqCst);
            self.requests.fetch_add(1, Ordering::SeqCst);
            Ok((start..start + len).map(|i| (i % 251) as u8).collect())
        }

        async fn size(&self, _media: &Media) -> DesktopResult<u64> {
            Ok(0)
        }
    }

    struct FixedClock(AtomicU64);
    impl Clock for FixedClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    fn drive(dir: &Path, size: u64) -> (Arc<Drive>, Arc<FakeSource>, Arc<ChunkCache>) {
        let source = Arc::new(FakeSource {
            requested: 0.into(),
            requests: 0.into(),
        });
        let clock: Arc<dyn Clock> = Arc::new(FixedClock(1_000_000.into()));
        let cache = Arc::new(ChunkCache::open(dir.join("cache"), clock.clone()).unwrap());
        std::fs::create_dir_all(dir.join("exports")).unwrap();
        let d = Arc::new(Drive::new(DriveDeps {
            source: source.clone(),
            cache: cache.clone(),
            clock,
            exports_dir: dir.join("exports"),
            owner: (501, 20),
        }));
        d.set_listing(&DriveListing {
            library: vec![DriveFile {
                key: "clip-a".into(),
                name: "A.mov".into(),
                size: Some(size),
                media: Media::Original {
                    clip_id: "a".into(),
                },
            }],
            shorts: vec![],
        });
        (d, source, cache)
    }

    fn name(text: &str) -> filename3 {
        text.as_bytes().to_vec().into()
    }

    #[tokio::test]
    async fn a_listed_clip_is_full_size_with_zero_bytes_used_until_played() {
        let dir = tempfile::tempdir().unwrap();
        let (d, source, _) = drive(dir.path(), 40 * MB);
        let fs = DriveFs(d);
        let library = fs.lookup(ROOT, &name("Library")).await.unwrap();
        let clip = fs.lookup(library, &name("A.mov")).await.unwrap();
        let attr = fs.getattr(clip).await.unwrap();
        assert_eq!((attr.size, attr.used), (40 * MB, 0));

        // A preview-sized read passes through: right bytes, nothing cached.
        let (head, eof) = fs.read(clip, 10, 4).await.unwrap();
        assert_eq!((head, eof), (vec![10, 11, 12, 13], false));
        assert_eq!(fs.getattr(clip).await.unwrap().used, 0);

        // Reads like playback (here 8 MiB plus the 4 bytes above) promote the clip; later reads
        // cache only the chunks they touch.
        for i in 0..8 {
            fs.read(clip, i * MB, MB as u32).await.unwrap();
        }
        let (data, _) = fs.read(clip, 20 * MB + 5, 3).await.unwrap();
        assert_eq!(
            data,
            ((20 * MB + 5)..(20 * MB + 8))
                .map(|i| (i % 251) as u8)
                .collect::<Vec<_>>()
        );
        let used = fs.getattr(clip).await.unwrap().used;
        assert_eq!(
            used,
            (1 + READ_AHEAD) * MB,
            "the read chunk plus read-ahead, not the file"
        );
        assert!(source.requested.load(Ordering::SeqCst) < 20 * MB);
    }

    #[tokio::test]
    async fn the_read_only_folders_refuse_writes_and_exports_accepts_them() {
        let dir = tempfile::tempdir().unwrap();
        let (d, _, _) = drive(dir.path(), MB);
        let fs = DriveFs(d);
        let library = fs.lookup(ROOT, &name("Library")).await.unwrap();
        assert!(matches!(
            fs.create(library, &name("x.mov"), sattr3::default()).await,
            Err(nfsstat3::NFS3ERR_ROFS)
        ));

        let exports = fs.lookup(ROOT, &name("Exports")).await.unwrap();
        let (cut, _) = fs
            .create(exports, &name("cut.mp4"), sattr3::default())
            .await
            .unwrap();
        fs.write(cut, 0, b"hello").await.unwrap();
        fs.rename(exports, &name("cut.mp4"), exports, &name("final.mp4"))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(dir.path().join("exports/final.mp4")).unwrap(),
            b"hello"
        );
        assert_eq!(
            fs.lookup(exports, &name("final.mp4")).await.unwrap(),
            cut,
            "the id follows the rename"
        );
        assert!(matches!(
            fs.lookup(exports, &name("../x")).await,
            Err(nfsstat3::NFS3ERR_INVAL)
        ));
        let listed = fs.readdir(exports, 0, 10).await.unwrap();
        assert_eq!(listed.entries.len(), 1);
    }

    #[tokio::test]
    async fn prefetch_caches_the_whole_file_and_projects_are_listed() {
        let dir = tempfile::tempdir().unwrap();
        let (d, _, cache) = drive(dir.path(), 3 * MB + 7);
        d.prefetch("clip-a").await.unwrap();
        assert_eq!(cache.cached("clip-a"), 3 * MB + 7);

        d.put_project("beach.fcpxml", b"<fcpxml/>".to_vec());
        let fs = DriveFs(d);
        let projects = fs.lookup(ROOT, &name("Projects")).await.unwrap();
        let file = fs.lookup(projects, &name("beach.fcpxml")).await.unwrap();
        assert_eq!(fs.read(file, 0, 100).await.unwrap().0, b"<fcpxml/>");
    }

    #[tokio::test]
    async fn a_clip_gone_from_the_manifest_leaves_the_drive() {
        let dir = tempfile::tempdir().unwrap();
        let (d, _, _) = drive(dir.path(), MB);
        d.set_listing(&DriveListing::default());
        let fs = DriveFs(d);
        let library = fs.lookup(ROOT, &name("Library")).await.unwrap();
        assert!(matches!(
            fs.lookup(library, &name("A.mov")).await,
            Err(nfsstat3::NFS3ERR_NOENT)
        ));
        assert!(fs.readdir(library, 0, 10).await.unwrap().entries.is_empty());
    }
}
