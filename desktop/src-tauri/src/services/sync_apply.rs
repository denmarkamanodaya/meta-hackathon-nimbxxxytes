//! Applies sync actions: renames and Trash moves first (cheap), then downloads, at most two at a
//! time across the whole app. One failed file never stops the others.

use futures_util::StreamExt;
use futures_util::stream;
use nimbytes_contracts::sync::OriginalResponse;

use crate::adapters::downloader::{DownloadJob, download};
use crate::adapters::json_file::io;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::state::{LocalClip, LocalShort};
use crate::core::sync_plan::{Folder, SyncAction};
use crate::services::status::{Direction, Transfer, TransferKind};
use crate::services::sync::SyncEngine;

/// Downloads queued at once (the engine's semaphore still allows only two to run).
const QUEUED_DOWNLOADS: usize = 4;

/// One file to fetch.
pub(crate) struct Fetch {
    pub kind: TransferKind,
    pub clip_id: Option<String>,
    pub folder: Folder,
    pub file: String,
    pub url: String,
    pub size: Option<u64>,
}

impl SyncEngine {
    /// Runs the actions; returns the failures.
    pub(crate) async fn apply(&self, actions: Vec<SyncAction>) -> Vec<DesktopError> {
        let (local, downloads): (Vec<_>, Vec<_>) = actions.into_iter().partition(|a| {
            matches!(
                a,
                SyncAction::Rename { .. }
                    | SyncAction::TrashClip { .. }
                    | SyncAction::TrashShort { .. }
            )
        });
        let mut failures: Vec<DesktopError> = local
            .into_iter()
            .filter_map(|a| self.apply_local(a).err())
            .collect();
        let results: Vec<DesktopResult<()>> = stream::iter(downloads)
            .map(|a| self.download_action(a))
            .buffer_unordered(QUEUED_DOWNLOADS)
            .collect()
            .await;
        failures.extend(results.into_iter().filter_map(Result::err));
        failures
    }

    fn apply_local(&self, action: SyncAction) -> DesktopResult<()> {
        match action {
            SyncAction::Rename { .. } => self.rename(&action),
            SyncAction::TrashClip { clip_id, files } => {
                self.trash_files(&files)?;
                self.update_state(|s| {
                    s.clips.remove(&clip_id);
                    s.originals.remove(&clip_id);
                })
            }
            SyncAction::TrashShort { short_id, files } => {
                self.trash_files(&files)?;
                self.update_state(|s| {
                    s.shorts.remove(&short_id);
                    s.projects.remove(&short_id);
                })
            }
            _ => Ok(()),
        }
    }

    fn trash_files(&self, files: &[(Folder, String)]) -> DesktopResult<()> {
        for (folder, file) in files {
            self.trash.trash(&self.path(*folder, file))?;
        }
        Ok(())
    }

    fn rename(&self, action: &SyncAction) -> DesktopResult<()> {
        let SyncAction::Rename {
            folder,
            clip_id,
            from,
            to,
        } = action
        else {
            return Ok(());
        };
        std::fs::rename(self.path(*folder, from), self.path(*folder, to))
            .map_err(|e| io("rename", &e))?;
        self.update_state(|s| {
            if *folder == Folder::Library {
                if let Some(c) = s.clips.get_mut(clip_id) {
                    c.file.clone_from(to);
                }
            } else if let Some(o) = s.originals.get_mut(clip_id) {
                o.file = Some(to.clone());
            }
        })
    }

    async fn download_action(&self, action: SyncAction) -> DesktopResult<()> {
        match action {
            SyncAction::DownloadProxy {
                clip_id,
                url,
                file,
                size,
            } => {
                let fetch = Fetch {
                    kind: TransferKind::Proxy,
                    clip_id: Some(clip_id.clone()),
                    folder: Folder::Library,
                    file: file.clone(),
                    url,
                    size,
                };
                let size_bytes = self.fetch(fetch).await?;
                self.update_state(|s| s.clips.insert(clip_id, LocalClip { file, size_bytes }))?;
                Ok(())
            }
            render @ SyncAction::DownloadRender { .. } => self.download_render(render).await,
            SyncAction::DownloadOriginal { clip_id, file } => {
                self.download_original(&clip_id, &file).await
            }
            _ => Ok(()),
        }
    }

    async fn download_render(&self, action: SyncAction) -> DesktopResult<()> {
        let SyncAction::DownloadRender {
            short_id,
            url,
            file,
            version,
        } = action
        else {
            return Ok(());
        };
        let fetch = Fetch {
            kind: TransferKind::Render,
            clip_id: None,
            folder: Folder::Shorts,
            file: file.clone(),
            url,
            size: None,
        };
        self.fetch(fetch).await?;
        let local = LocalShort {
            file: file.clone(),
            version,
        };
        let old = self.update_state(|s| s.shorts.insert(short_id, local))?;
        match old.filter(|o| o.file != file) {
            Some(old) => self.trash.trash(&self.path(Folder::Shorts, &old.file)),
            None => Ok(()),
        }
    }

    /// Fetches an original with a fresh URL (asked again once if it expires mid-way).
    pub(crate) async fn download_original(&self, clip_id: &str, file: &str) -> DesktopResult<()> {
        let mut attempt = 0;
        let size_bytes = loop {
            let path = format!("/api/sync/clips/{clip_id}/original");
            let res: OriginalResponse = self.api.post_json(&path, &serde_json::json!({})).await?;
            let fetch = Fetch {
                kind: TransferKind::Original,
                clip_id: Some(clip_id.to_owned()),
                folder: Folder::Originals,
                file: file.to_owned(),
                url: res.url,
                size: None,
            };
            match self.fetch(fetch).await {
                Err(err) if err.code == ErrorCode::UrlExpired && attempt == 0 => attempt += 1,
                other => break other?,
            }
        };
        let now = self.clock.now_ms();
        self.update_state(|s| {
            if let Some(o) = s.originals.get_mut(clip_id) {
                o.file = Some(file.to_owned());
                o.size_bytes = size_bytes;
                o.last_used_ms = now;
            }
        })
    }

    /// Downloads one file with a transfer row; an expired proxy or render URL drops the cached
    /// manifest so the next round re-signs it.
    pub(crate) async fn fetch(&self, fetch: Fetch) -> DesktopResult<u64> {
        let _slot = self
            .downloads
            .acquire()
            .await
            .map_err(|_| DesktopError::new(ErrorCode::Io, "download queue closed"))?;
        let id = format!("{:?}:{}", fetch.kind, fetch.file);
        self.start_transfer(&id, &fetch);
        let progress = |done: u64, total: u64| {
            self.status.update(|s| {
                if let Some(t) = s.transfers.get_mut(&id) {
                    t.done_bytes = done;
                    t.total_bytes = total;
                }
            });
            self.emit_throttled();
        };
        let target = self.path(fetch.folder, &fetch.file);
        let job = DownloadJob {
            url: &fetch.url,
            target: &target,
            expected: fetch.size,
            progress: &progress,
        };
        let result = download(self.api.http(), job).await;
        self.status.update(|s| {
            s.transfers.remove(&id);
        });
        self.emit();
        let expired = matches!(&result, Err(e) if e.code == ErrorCode::UrlExpired);
        if expired && fetch.kind != TransferKind::Original {
            self.drop_manifest();
        }
        result
    }

    fn start_transfer(&self, id: &str, fetch: &Fetch) {
        let row = Transfer {
            id: id.to_owned(),
            kind: fetch.kind,
            name: fetch.file.clone(),
            done_bytes: 0,
            total_bytes: fetch.size.unwrap_or(0),
            direction: Direction::Down,
            clip_id: fetch.clip_id.clone(),
        };
        self.status.update(|s| {
            s.transfers.insert(id.to_owned(), row);
        });
        self.emit();
    }
}
