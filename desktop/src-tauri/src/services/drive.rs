//! The drive's life: serve the NFS export on a free local port, mount it on the sync folder
//! (`~/nimbytes`), keep its listing in step with each manifest, keep the editor projects, and
//! unmount at quit. A real folder already on that path (copies from older versions) is moved
//! aside first, never deleted.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use nfsserve::tcp::{NFSTcp, NFSTcpListener};
use nimbytes_contracts::sync::SyncManifest;

use crate::adapters::chunk_cache::ChunkCache;
use crate::adapters::json_file::io;
use crate::adapters::nfs_drive::{Drive, DriveFs};
use crate::core::drive::{
    DriveListing, Evictable, IDLE_MS, Keep, Media, cache_budget, evictions, idle_keys, listing,
    old_copies_path, original_key,
};
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::ports::{Clock, DiskSpace, Mounter, RangeSource};

/// The export name the mount asks for.
const EXPORT: &str = "nimbytes";

/// What the service is built from.
pub struct DriveServiceDeps {
    /// The drive file system.
    pub drive: Arc<Drive>,
    /// Where streamed bytes come from (render sizes are probed here).
    pub source: Arc<dyn RangeSource>,
    /// The chunk cache.
    pub cache: Arc<ChunkCache>,
    /// Mount and unmount.
    pub mounter: Arc<dyn Mounter>,
    /// Free disk space (the cache shrinks when the disk runs short).
    pub disk: Arc<dyn DiskSpace>,
    /// Wall clock (idle files are freed).
    pub clock: Arc<dyn Clock>,
    /// Where the cache lives (the disk asked about).
    pub cache_dir: PathBuf,
    /// Where the drive mounts (the sync folder).
    pub mount_point: PathBuf,
    /// Real copies of the editor projects, so they survive a restart.
    pub projects_dir: PathBuf,
}

/// The service.
pub struct DriveService {
    deps: DriveServiceDeps,
    listing: Mutex<DriveListing>,
    render_sizes: Mutex<BTreeMap<String, u64>>,
}

impl DriveService {
    /// Builds the service; nothing is served until [`DriveService::start`].
    pub fn new(deps: DriveServiceDeps) -> Self {
        Self {
            deps,
            listing: Mutex::new(DriveListing::default()),
            render_sizes: Mutex::new(BTreeMap::new()),
        }
    }

    /// The mount point.
    pub fn mount_point(&self) -> &Path {
        &self.deps.mount_point
    }

    /// Serves the export, moves an old real folder aside and mounts the drive.
    ///
    /// # Errors
    /// `IO` when the port cannot be bound, the old folder cannot move, or the mount fails.
    pub async fn start(&self) -> DesktopResult<()> {
        self.load_projects();
        let mut listener = NFSTcpListener::bind("127.0.0.1:0", DriveFs(self.deps.drive.clone()))
            .await
            .map_err(|e| io("serve drive", &e))?;
        listener.with_export_name(EXPORT);
        let port = listener.get_listen_port();
        tokio::spawn(async move {
            if let Err(err) = listener.handle_forever().await {
                eprintln!("drive server stopped: {err}");
            }
        });
        self.prepare_mount_point()?;
        // `mount_nfs` blocks until the server above answers. Run it off this worker: a task just
        // spawned waits in this worker's LIFO slot, which no other worker steals, so a blocking
        // call here would starve the server and hang the mount for good.
        let mounter = self.deps.mounter.clone();
        let mount_point = self.deps.mount_point.clone();
        tokio::task::spawn_blocking(move || mounter.mount(port, EXPORT, &mount_point))
            .await
            .map_err(|e| DesktopError::new(ErrorCode::Io, format!("mount task: {e}")))?
    }

    /// Drops a stale mount (left by a crash) and moves a real, non-empty folder aside.
    fn prepare_mount_point(&self) -> DesktopResult<()> {
        let mount = &self.deps.mount_point;
        if self.deps.mounter.is_mounted(mount) {
            self.deps.mounter.unmount(mount, true)?;
        }
        let has_files = std::fs::read_dir(mount).is_ok_and(|mut entries| entries.next().is_some());
        if has_files {
            let aside = old_copies_path(mount, Path::exists);
            std::fs::rename(mount, &aside).map_err(|e| io("move old nimbytes folder", &e))?;
            eprintln!("moved {} to {}", mount.display(), aside.display());
        }
        std::fs::create_dir_all(mount).map_err(|e| io("create mount point", &e))
    }

    /// Unmounts the drive (at quit).
    pub fn stop(&self) {
        let mount = &self.deps.mount_point;
        if self.deps.mounter.is_mounted(mount) && self.deps.mounter.unmount(mount, false).is_err() {
            let _ = self.deps.mounter.unmount(mount, true);
        }
    }

    /// Brings the listing in step with `manifest`, probing the size of each new render.
    pub async fn refresh(&self, manifest: &SyncManifest) {
        let known = self
            .render_sizes
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default();
        for file in listing(manifest, &known)
            .shorts
            .iter()
            .filter(|f| f.size.is_none())
        {
            match self.deps.source.size(&file.media).await {
                Ok(size) => {
                    if let Ok(mut sizes) = self.render_sizes.lock() {
                        sizes.insert(file.key.clone(), size);
                    }
                }
                Err(err) => eprintln!("render size of {}: {err}", file.key),
            }
        }
        let sizes = self
            .render_sizes
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default();
        let next = listing(manifest, &sizes);
        self.deps.drive.set_listing(&next);
        if let Ok(mut slot) = self.listing.lock() {
            *slot = next;
        }
    }

    /// The drive path of a clip's original, once listed.
    pub fn original_path(&self, clip_id: &str) -> Option<PathBuf> {
        let key = original_key(clip_id);
        let listing = self.listing.lock().ok()?;
        let file = listing.library.iter().find(|f| f.key == key)?;
        Some(self.deps.mount_point.join("Library").join(&file.name))
    }

    /// The drive path of a short's render, once listed.
    pub fn render_path(&self, short_id: &str) -> Option<PathBuf> {
        let listing = self.listing.lock().ok()?;
        let file = listing.shorts.iter().find(|f| {
            matches!(&f.media, Media::Render { short_id: id, .. } if id == short_id)
                && f.size.is_some()
        })?;
        Some(self.deps.mount_point.join("Shorts").join(&file.name))
    }

    /// Saves an editor project and shows it in `Projects/`; returns its drive path.
    ///
    /// # Errors
    /// `BAD_PATH` for a name with a folder in it, `IO` when the copy cannot be written.
    pub fn put_project(&self, name: &str, xml: Vec<u8>) -> DesktopResult<PathBuf> {
        if name.contains('/') || name.starts_with('.') {
            return Err(DesktopError::new(ErrorCode::BadPath, "bad project name"));
        }
        std::fs::create_dir_all(&self.deps.projects_dir).map_err(|e| io("create projects", &e))?;
        std::fs::write(self.deps.projects_dir.join(name), &xml)
            .map_err(|e| io("write project", &e))?;
        self.deps.drive.put_project(name, xml);
        Ok(self.deps.mount_point.join("Projects").join(name))
    }

    fn load_projects(&self) {
        let Ok(entries) = std::fs::read_dir(&self.deps.projects_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Ok(xml) = std::fs::read(entry.path()) {
                self.deps.drive.put_project(&name, xml);
            }
        }
    }

    /// Caches every chunk of a clip's original in the background ("Make available offline").
    pub fn prefetch_original(self: &Arc<Self>, clip_id: &str) {
        let drive = self.deps.drive.clone();
        let key = original_key(clip_id);
        tokio::spawn(async move {
            if let Err(err) = drive.prefetch(&key).await {
                eprintln!("prefetch {key}: {err}");
            }
        });
    }

    /// Bytes of a clip's original that are cached.
    pub fn original_cached(&self, clip_id: &str) -> u64 {
        self.deps.cache.cached(&original_key(clip_id))
    }

    /// Frees cached files not read for [`IDLE_MS`], then evicts until the cache fits its budget:
    /// the `cap_bytes` cap, shrunk while the disk has less than 15% free. Pinned originals are
    /// never freed; originals linked by `late` clip ids (editor projects) and every render go
    /// last. Returns the bytes freed.
    pub fn evict(&self, cap_bytes: u64, pinned: &[String], late: &[String]) -> u64 {
        let files = self.classified(pinned, late);
        let idle = idle_keys(&files, self.deps.clock.now_ms(), IDLE_MS);
        let rest: Vec<Evictable> = files
            .iter()
            .filter(|f| !idle.contains(&f.key))
            .cloned()
            .collect();
        let used: u64 = rest.iter().map(|f| f.bytes).sum();
        let budget = match self.deps.disk.space(&self.deps.cache_dir) {
            Some((free, total)) => cache_budget(cap_bytes, used, free, total),
            None => cap_bytes,
        };
        let mut freed = 0;
        for key in idle.into_iter().chain(evictions(&rest, budget)) {
            freed += files.iter().find(|f| f.key == key).map_or(0, |f| f.bytes);
            if let Err(err) = self.deps.cache.evict(&key) {
                eprintln!("evict {key}: {err}");
            }
        }
        freed
    }

    /// Every cached file with its eviction tier.
    fn classified(&self, pinned: &[String], late: &[String]) -> Vec<Evictable> {
        let busy = self.deps.drive.busy_keys();
        let pinned: Vec<String> = pinned.iter().map(|id| original_key(id)).collect();
        let late: Vec<String> = late.iter().map(|id| original_key(id)).collect();
        self.deps
            .cache
            .files()
            .into_iter()
            .map(|f| {
                let keep = if pinned.contains(&f.key) || busy.contains(&f.key) {
                    Keep::Always
                } else if late.contains(&f.key) || f.key.starts_with("render-") {
                    Keep::Late
                } else {
                    Keep::Normal
                };
                Evictable {
                    key: f.key,
                    bytes: f.bytes,
                    last_used_ms: f.last_used_ms,
                    keep,
                }
            })
            .collect()
    }

    /// Bytes the cache holds ("Space used on this Mac").
    pub fn space_used(&self) -> u64 {
        self.deps.cache.total()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;
    use crate::adapters::nfs_drive::DriveDeps;
    use crate::ports::Clock;

    struct NoSource;
    #[async_trait::async_trait]
    impl RangeSource for NoSource {
        async fn range(&self, _m: &Media, _s: u64, _l: u64) -> DesktopResult<Vec<u8>> {
            Err(DesktopError::new(ErrorCode::Network, "offline"))
        }
        async fn size(&self, _m: &Media) -> DesktopResult<u64> {
            Ok(5_000)
        }
    }

    struct Clock0;
    impl Clock for Clock0 {
        fn now_ms(&self) -> u64 {
            0
        }
    }

    struct Disk(Option<(u64, u64)>);
    impl DiskSpace for Disk {
        fn space(&self, _path: &Path) -> Option<(u64, u64)> {
            self.0
        }
    }

    #[derive(Default)]
    struct FakeMounter {
        mounted: AtomicBool,
        stale: AtomicBool,
        mounted_at: Mutex<Option<(u16, PathBuf)>>,
    }

    impl Mounter for FakeMounter {
        fn is_mounted(&self, _path: &Path) -> bool {
            self.mounted.load(Ordering::SeqCst) || self.stale.load(Ordering::SeqCst)
        }
        fn mount(&self, port: u16, export: &str, path: &Path) -> DesktopResult<()> {
            assert_eq!(export, "nimbytes");
            assert!(
                path.is_dir() && std::fs::read_dir(path).unwrap().next().is_none(),
                "mounts on an empty folder"
            );
            self.mounted.store(true, Ordering::SeqCst);
            *self.mounted_at.lock().unwrap() = Some((port, path.to_path_buf()));
            Ok(())
        }
        fn unmount(&self, _path: &Path, _force: bool) -> DesktopResult<()> {
            self.stale.store(false, Ordering::SeqCst);
            self.mounted.store(false, Ordering::SeqCst);
            Ok(())
        }
    }

    struct ClockAt(u64);
    impl Clock for ClockAt {
        fn now_ms(&self) -> u64 {
            self.0
        }
    }

    fn service(dir: &Path, mounter: Arc<FakeMounter>) -> DriveService {
        service_at(dir, mounter, 0)
    }

    /// The service with its clock at `now_ms` (the cache stamps reads at 0).
    fn service_at(dir: &Path, mounter: Arc<FakeMounter>, now_ms: u64) -> DriveService {
        let clock: Arc<dyn Clock> = Arc::new(Clock0);
        let cache = Arc::new(ChunkCache::open(dir.join("cache"), clock.clone()).unwrap());
        let source: Arc<dyn RangeSource> = Arc::new(NoSource);
        let drive = Arc::new(Drive::new(DriveDeps {
            source: source.clone(),
            cache: cache.clone(),
            clock,
            exports_dir: dir.join("exports"),
            owner: (501, 20),
        }));
        DriveService::new(DriveServiceDeps {
            drive,
            source,
            cache,
            mounter,
            disk: Arc::new(Disk(None)),
            clock: Arc::new(ClockAt(now_ms)),
            cache_dir: dir.join("cache"),
            mount_point: dir.join("nimbytes"),
            projects_dir: dir.join("projects"),
        })
    }

    #[tokio::test]
    async fn start_moves_old_copies_aside_drops_a_stale_mount_and_mounts() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("nimbytes/Originals")).unwrap();
        std::fs::write(dir.path().join("nimbytes/Originals/a.mov"), b"x").unwrap();
        let mounter = Arc::new(FakeMounter::default());
        mounter.stale.store(true, Ordering::SeqCst);

        service(dir.path(), mounter.clone()).start().await.unwrap();

        assert!(
            dir.path()
                .join("nimbytes (old copies)/Originals/a.mov")
                .is_file(),
            "old copies kept"
        );
        let (port, path) = mounter.mounted_at.lock().unwrap().clone().unwrap();
        assert!(port > 0);
        assert_eq!(path, dir.path().join("nimbytes"));
    }

    #[test]
    fn eviction_frees_plain_footage_first_and_shrinks_when_the_disk_is_full() {
        use crate::adapters::chunk_cache::CacheFile;
        let dir = tempfile::tempdir().unwrap();
        let mut svc = service(dir.path(), Arc::new(FakeMounter::default()));
        for key in ["clip-pinned", "clip-project", "clip-plain"] {
            svc.deps
                .cache
                .put(CacheFile { key, size: 10 }, 0, &[1; 10])
                .unwrap();
        }
        let pinned = vec!["pinned".to_owned()];
        let late = vec!["project".to_owned()];

        assert_eq!(svc.evict(30, &pinned, &late), 0);
        assert_eq!(svc.evict(25, &pinned, &late), 10);
        assert_eq!(svc.deps.cache.cached("clip-plain"), 0);
        assert_eq!(svc.deps.cache.cached("clip-project"), 10);

        // A full disk (10% free of 1000) shrinks the 1000-byte cap below what is cached.
        svc.deps.disk = Arc::new(Disk(Some((100, 1000))));
        assert_eq!(svc.evict(1000, &pinned, &late), 10);
        assert_eq!(svc.deps.cache.cached("clip-pinned"), 10, "pinned stays");
    }

    #[test]
    fn files_idle_for_three_minutes_are_freed_but_pinned_stay() {
        use crate::adapters::chunk_cache::CacheFile;
        use crate::core::drive::IDLE_MS;
        let dir = tempfile::tempdir().unwrap();
        let svc = service_at(dir.path(), Arc::new(FakeMounter::default()), IDLE_MS + 1);
        for key in ["clip-pinned", "clip-watched"] {
            svc.deps
                .cache
                .put(CacheFile { key, size: 10 }, 0, &[1; 10])
                .unwrap();
        }
        assert_eq!(svc.evict(1_000_000, &["pinned".to_owned()], &[]), 10);
        assert_eq!(svc.deps.cache.cached("clip-watched"), 0);
        assert_eq!(svc.deps.cache.cached("clip-pinned"), 10);
    }

    #[tokio::test]
    async fn refresh_lists_renders_with_their_probed_size_and_projects_persist() {
        use nimbytes_contracts::shorts::{Aspect, ShortStatus};
        use nimbytes_contracts::sync::SyncShort;
        let dir = tempfile::tempdir().unwrap();
        let svc = service(dir.path(), Arc::new(FakeMounter::default()));
        let manifest = SyncManifest {
            etag: "e".into(),
            clips: vec![],
            shorts: vec![SyncShort {
                short_id: "s1".into(),
                prompt: "beach day".into(),
                aspect: Aspect::Portrait,
                status: ShortStatus::Ready,
                best_version: Some(1),
                render_url: Some("https://cdn/r".into()),
                created_at: "2026-10-27T01:00:00Z".into(),
            }],
        };
        svc.refresh(&manifest).await;
        let render = svc.render_path("s1").unwrap();
        assert!(render.starts_with(dir.path().join("nimbytes/Shorts")));

        let path = svc
            .put_project("beach.fcpxml", b"<fcpxml/>".to_vec())
            .unwrap();
        assert_eq!(path, dir.path().join("nimbytes/Projects/beach.fcpxml"));
        assert_eq!(
            std::fs::read(dir.path().join("projects/beach.fcpxml")).unwrap(),
            b"<fcpxml/>"
        );
        assert!(svc.put_project("../x", Vec::new()).is_err());
    }
}
