//! Exports up: scans the top level of `Exports/` every 2 s. A video whose size held for 5 s is
//! checked for duplicates, then uploaded through the existing multipart flow (4 parts at a time,
//! presigned 16 at a time because part links expire, resumable from `state.json`), moved to
//! `Exports/Uploaded/` and announced. Picked files retry with back-off and resume at start.
//! A scan replaces a file watcher: the stability rule needs periodic size reads anyway.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream;
use nimbytes_contracts::uploads::{
    CompleteUploadRequest, CompleteUploadResponse, CreateUploadRequest, CreateUploadResponse,
    PresignPartsRequest, PresignPartsResponse, PresignedPart, UploadCheckRequest,
    UploadCheckResponse,
};
use reqwest::header::{CONTENT_LENGTH, ETAG};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::adapters::api_client::{network, ok_status};
use crate::adapters::json_file::io;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::exports::{
    PRESIGN_BATCH, SizeWatch, can_resume, completed_parts, content_type, is_export_candidate,
    is_stable, next_batch, observe, part_range, retry_delay_s,
};
use crate::core::state::UploadProgress;
use crate::ports::Notifier;
use crate::services::status::{Direction, ExportRow, ExportState, Transfer, TransferKind};
use crate::services::sync::SyncEngine;

/// Scan period.
const SCAN_EVERY: Duration = Duration::from_secs(2);
/// Parts uploaded at once.
const PARALLEL_PARTS: usize = 4;
/// Longest wait for one part PUT.
const PART_TIMEOUT: Duration = Duration::from_secs(600);
/// A failed export is tried again after this long, milliseconds (sooner if its size changes).
const RETRY_AFTER_MS: u64 = 60_000;
/// Where finished files go.
const UPLOADED: &str = "Uploaded";

/// Where an upload's file came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Origin {
    /// Dropped into `Exports/`: moved to `Uploaded/` when done.
    ExportsFolder,
    /// Chosen in the native file dialog: left where it is.
    Picked,
}

/// One file to upload.
struct Source {
    /// Key of its resume entry and transfer row (the name in `Exports/`, else the full path).
    key: String,
    /// File name sent to the server.
    name: String,
    /// Where the bytes are read from.
    path: PathBuf,
    /// Exports folder or dialog.
    origin: Origin,
}

/// The exports uploader.
pub struct ExportsService {
    sync: Arc<SyncEngine>,
    notifier: Arc<dyn Notifier>,
    dir: PathBuf,
}

impl ExportsService {
    /// Builds the uploader on the sync engine's client, state and status. `dir` is the real
    /// folder the drive shows as `Exports/`.
    pub fn new(sync: Arc<SyncEngine>, notifier: Arc<dyn Notifier>, dir: PathBuf) -> Self {
        Self {
            sync,
            notifier,
            dir,
        }
    }

    fn dir(&self) -> PathBuf {
        self.dir.clone()
    }

    /// The scan loop; runs for the life of the app.
    pub async fn run(self: Arc<Self>) {
        for path in self.unfinished_picked() {
            let me = self.clone();
            tokio::spawn(async move { me.upload_picked(path).await });
        }
        let mut watches: HashMap<String, SizeWatch> = HashMap::new();
        let mut failed: HashMap<String, (u64, u64)> = HashMap::new();
        loop {
            let _ = std::fs::create_dir_all(self.dir().join(UPLOADED));
            for (name, size) in self.candidates() {
                let now = self.sync.clock.now_ms();
                let watch = observe(watches.get(&name).copied(), size, now);
                watches.insert(name.clone(), watch);
                let retry_at = failed
                    .get(&name)
                    .filter(|(s, _)| *s == size)
                    .map(|(_, at)| at + RETRY_AFTER_MS);
                if retry_at.is_some_and(|at| now < at) {
                    continue;
                }
                if !is_stable(watch, now) {
                    self.row(&name, ExportState::Waiting, None);
                    continue;
                }
                match self.process(&self.exported(&name), size).await {
                    Ok(()) => {
                        watches.remove(&name);
                        failed.remove(&name);
                    }
                    Err(err) => {
                        eprintln!("export {name} failed: {err}");
                        self.row(&name, ExportState::Failed, Some(err.message));
                        failed.insert(name, (size, now));
                    }
                }
            }
            tokio::time::sleep(SCAN_EVERY).await;
        }
    }

    /// Top-level export files and their sizes.
    fn candidates(&self) -> Vec<(String, u64)> {
        let Ok(entries) = std::fs::read_dir(self.dir()) else {
            return Vec::new();
        };
        entries
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| {
                let name = e.file_name().to_str()?.to_owned();
                let size = e.metadata().ok()?.len();
                is_export_candidate(&name).then_some((name, size))
            })
            .collect()
    }

    fn row(&self, name: &str, state: ExportState, error: Option<String>) {
        let changed = self.sync.status.read(|l| {
            l.exports.get(name).map(|r| (r.state, r.error.clone())) != Some((state, error.clone()))
        });
        if changed == Some(true) {
            self.sync.status.update(|l| {
                l.exports.insert(
                    name.to_owned(),
                    ExportRow {
                        name: name.to_owned(),
                        state,
                        error,
                    },
                );
            });
            self.sync.emit();
        }
    }

    /// Uploads a file picked in the native dialog (`pick_and_upload`). The file stays where it is;
    /// only `Exports/` files are moved afterwards. A failure is retried with back-off (the upload
    /// resumes from its finished parts), except when signed out.
    pub async fn upload_picked(&self, path: PathBuf) {
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_owned) else {
            return;
        };
        let source = Source {
            key: path.to_string_lossy().into_owned(),
            name,
            path,
            origin: Origin::Picked,
        };
        let mut attempt = 0;
        loop {
            let size = std::fs::metadata(&source.path)
                .map(|m| m.len())
                .unwrap_or(0);
            let Err(err) = self.process(&source, size).await else {
                return;
            };
            eprintln!("upload {} failed: {err}", source.name);
            self.row(&source.name, ExportState::Failed, Some(err.message.clone()));
            attempt += 1;
            match retry_delay_s(attempt) {
                Some(wait) if err.code != ErrorCode::NotSignedIn => {
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                }
                _ => return,
            }
        }
    }

    /// Picked files whose upload did not finish before the app quit: resumed at start.
    fn unfinished_picked(&self) -> Vec<PathBuf> {
        self.sync
            .state()
            .uploads
            .keys()
            .map(PathBuf::from)
            .filter(|p| p.is_absolute() && p.is_file())
            .collect()
    }

    fn exported(&self, name: &str) -> Source {
        Source {
            key: name.to_owned(),
            name: name.to_owned(),
            path: self.dir().join(name),
            origin: Origin::ExportsFolder,
        }
    }

    async fn process(&self, src: &Source, size: u64) -> DesktopResult<()> {
        let saved = self.sync.state().uploads.get(&src.key).cloned();
        let progress = match saved.filter(|p| can_resume(p, size)) {
            Some(p) => p,
            None if self.is_duplicate(src, size).await? => return Ok(()),
            None => self.start(src, size).await?,
        };
        self.row(&src.name, ExportState::Uploading, None);
        if let Err(err) = self.upload(src, progress).await {
            if err.code == ErrorCode::NotFound {
                // The server forgot the upload: start over on the next try.
                self.save(&src.key, None)?;
            }
            return Err(err);
        }
        self.settle(src)?;
        self.row(&src.name, ExportState::Uploaded, None);
        self.notifier.notify(
            "Uploaded to nimbytes",
            &format!("{} will appear in your library shortly", src.name),
        );
        Ok(())
    }

    /// Asks the server; a duplicate is settled without uploading.
    async fn is_duplicate(&self, src: &Source, size: u64) -> DesktopResult<bool> {
        let check = UploadCheckRequest {
            filename: src.name.clone(),
            size_bytes: size,
        };
        let answer: UploadCheckResponse = self
            .sync
            .api
            .post_json("/api/uploads/check", &check)
            .await?;
        let Some(existing) = answer.duplicate_of else {
            return Ok(false);
        };
        self.settle(src)?;
        self.row(&src.name, ExportState::Duplicate, None);
        self.notifier.notify(
            "Already in nimbytes",
            &format!("{} matches “{}”", src.name, existing.title),
        );
        Ok(true)
    }

    async fn start(&self, src: &Source, size: u64) -> DesktopResult<UploadProgress> {
        let body = CreateUploadRequest {
            filename: src.name.clone(),
            size_bytes: size,
            content_type: content_type(&src.name).to_owned(),
        };
        let created: CreateUploadResponse = self.sync.api.post_json("/api/uploads", &body).await?;
        let progress = UploadProgress {
            upload_id: created.upload_id,
            clip_id: created.clip_id,
            part_size: created.part_size,
            size_bytes: size,
            done: BTreeMap::new(),
        };
        self.save(&src.key, Some(progress.clone()))?;
        Ok(progress)
    }

    fn save(&self, key: &str, progress: Option<UploadProgress>) -> DesktopResult<()> {
        self.sync.update_state(|s| match progress {
            Some(p) => {
                s.uploads.insert(key.to_owned(), p);
            }
            None => {
                s.uploads.remove(key);
            }
        })
    }

    /// Uploads the missing parts and completes; returns the clip id.
    async fn upload(&self, src: &Source, progress: UploadProgress) -> DesktopResult<String> {
        let id = transfer_id(src);
        self.transfer(&id, &src.name, &progress);
        let result = self.upload_parts(src, progress).await;
        self.sync.status.update(|l| {
            l.transfers.remove(&id);
        });
        self.sync.emit();
        result
    }

    async fn presign(&self, upload_id: &str, parts: Vec<u32>) -> DesktopResult<Vec<PresignedPart>> {
        let req = PresignPartsRequest {
            part_numbers: parts,
        };
        let path = format!("/api/uploads/{upload_id}/parts");
        let res: PresignPartsResponse = self.sync.api.post_json(&path, &req).await?;
        Ok(res.parts)
    }

    async fn upload_parts(
        &self,
        src: &Source,
        mut progress: UploadProgress,
    ) -> DesktopResult<String> {
        let upload = progress.upload_id.clone();
        loop {
            let batch = next_batch(&progress, PRESIGN_BATCH);
            if batch.is_empty() {
                break;
            }
            let urls = self.presign(&upload, batch).await?;
            let finished = progress.done.len();
            let expired = self.put_batch(src, &mut progress, urls).await?;
            if expired && progress.done.len() == finished {
                return Err(DesktopError::new(
                    ErrorCode::UrlExpired,
                    "part links expired before any part finished",
                ));
            }
        }
        let body = CompleteUploadRequest {
            parts: completed_parts(&progress.done),
        };
        let res: CompleteUploadResponse = self
            .sync
            .api
            .post_json(&format!("/api/uploads/{upload}/complete"), &body)
            .await?;
        self.save(&src.key, None)?;
        Ok(res.clip_id)
    }

    /// PUTs one presigned batch, saving each finished part. Returns whether a link expired (those
    /// parts are presigned again with the next batch); any other failure stops the upload.
    async fn put_batch(
        &self,
        src: &Source,
        progress: &mut UploadProgress,
        urls: Vec<PresignedPart>,
    ) -> DesktopResult<bool> {
        let id = &transfer_id(src);
        let (part_size, size, path) = (progress.part_size, progress.size_bytes, &src.path);
        let mut puts = stream::iter(urls)
            .map(|p| async move {
                let range = part_range(p.n, part_size, size);
                put_part(self.sync.api.http(), path, &p.url, range)
                    .await
                    .map(|etag| (p.n, etag))
            })
            .buffer_unordered(PARALLEL_PARTS);
        let mut expired = false;
        while let Some(done) = puts.next().await {
            match done {
                Ok((n, etag)) => {
                    progress.done.insert(n, etag);
                    self.save(&src.key, Some(progress.clone()))?;
                    self.transfer(id, &src.name, progress);
                }
                Err(err) if err.code == ErrorCode::UrlExpired => expired = true,
                Err(err) => return Err(err),
            }
        }
        Ok(expired)
    }

    fn transfer(&self, id: &str, name: &str, progress: &UploadProgress) {
        let done: u64 = progress
            .done
            .keys()
            .map(|n| part_range(*n, progress.part_size, progress.size_bytes).1)
            .sum();
        let row = Transfer {
            id: id.to_owned(),
            kind: TransferKind::Export,
            name: name.to_owned(),
            done_bytes: done,
            total_bytes: progress.size_bytes,
            direction: Direction::Up,
            clip_id: Some(progress.clip_id.clone()),
        };
        self.sync.status.update(|l| {
            l.transfers.insert(id.to_owned(), row);
        });
        self.sync.emit_throttled();
    }

    /// After an upload or a duplicate: an `Exports/` file moves to `Uploaded/`; a picked file is
    /// the owner's and stays put.
    fn settle(&self, src: &Source) -> DesktopResult<()> {
        match src.origin {
            Origin::ExportsFolder => self.finish(&src.name),
            Origin::Picked => Ok(()),
        }
    }

    /// Moves the file to `Exports/Uploaded/`, never over another file.
    fn finish(&self, name: &str) -> DesktopResult<()> {
        let dir = self.dir().join(UPLOADED);
        std::fs::create_dir_all(&dir).map_err(|e| io("create Uploaded", &e))?;
        let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
        let mut target = dir.join(name);
        let mut n = 2;
        while target.exists() {
            target = dir.join(format!("{stem} ({n}).{ext}"));
            n += 1;
        }
        std::fs::rename(self.dir().join(name), target).map_err(|e| io("move to Uploaded", &e))
    }
}

/// The transfer row id of an upload.
fn transfer_id(src: &Source) -> String {
    format!("Export:{}", src.key)
}

/// PUTs one part's bytes to its presigned URL; returns the `ETag` header.
async fn put_part(
    http: &reqwest::Client,
    path: &Path,
    url: &str,
    (offset, len): (u64, u64),
) -> DesktopResult<String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| io("open export", &e))?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| io("seek export", &e))?;
    let mut bytes = vec![0; usize::try_from(len).unwrap_or(0)];
    file.read_exact(&mut bytes)
        .await
        .map_err(|e| io("read export", &e))?;
    let res = http
        .put(url)
        .header(CONTENT_LENGTH, len)
        .timeout(PART_TIMEOUT)
        .body(bytes)
        .send()
        .await
        .map_err(|e| network(&e))?;
    // Storage refuses an expired presigned link with 403.
    if res.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(DesktopError::new(
            ErrorCode::UrlExpired,
            "part link expired",
        ));
    }
    let res = ok_status(res).await?;
    res.headers()
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| DesktopError::new(ErrorCode::BadResponse, "storage sent no ETag"))
}
