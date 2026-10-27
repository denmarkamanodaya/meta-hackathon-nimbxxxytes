//! The sync diff: compares the server manifest with `state.json` and the disk and returns the
//! actions that make `~/nimbytes` match the cloud. One-way down: the folder may be overwritten,
//! nothing local ever flows up from here.

use nimbytes_contracts::sync::{ShortStatus, SyncClip, SyncManifest, SyncShort};

use crate::core::naming::{original_file, proxy_file, render_file};
use crate::core::state::SyncState;

/// App-managed folders inside the sync folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Folder {
    /// 720p proxies.
    Library,
    /// Full originals.
    Originals,
    /// Final renders.
    Shorts,
    /// FCPXML.
    Projects,
}

impl Folder {
    /// Folder name on disk.
    pub fn name(self) -> &'static str {
        match self {
            Self::Library => "Library",
            Self::Originals => "Originals",
            Self::Shorts => "Shorts",
            Self::Projects => "Projects",
        }
    }
}

/// One step towards the manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncAction {
    /// Fetch a proxy into `Library/`.
    DownloadProxy {
        /// Clip id.
        clip_id: String,
        /// Presigned URL.
        url: String,
        /// Target file name.
        file: String,
        /// Announced size, if the server knew it.
        size: Option<u64>,
    },
    /// Fetch a render into `Shorts/`.
    DownloadRender {
        /// Short id.
        short_id: String,
        /// Presigned URL.
        url: String,
        /// Target file name.
        file: String,
        /// Best version it belongs to.
        version: Option<u32>,
    },
    /// Fetch a wanted original into `Originals/` (its URL is asked for when the download starts).
    DownloadOriginal {
        /// Clip id.
        clip_id: String,
        /// Target file name.
        file: String,
    },
    /// The title changed: rename instead of downloading again.
    Rename {
        /// Which folder.
        folder: Folder,
        /// Clip id.
        clip_id: String,
        /// Current name.
        from: String,
        /// New name.
        to: String,
    },
    /// The clip left the cloud: its proxy and original go to the Trash.
    TrashClip {
        /// Clip id.
        clip_id: String,
        /// Files to trash, with their folders.
        files: Vec<(Folder, String)>,
    },
    /// The short left the cloud: its render and FCPXML go to the Trash.
    TrashShort {
        /// Short id.
        short_id: String,
        /// Files to trash, with their folders.
        files: Vec<(Folder, String)>,
    },
}

/// Diffs the manifest against the state. `on_disk(folder, file)` says whether a recorded file is
/// still there, so a file the owner moved away is fetched again.
pub fn plan(
    manifest: &SyncManifest,
    state: &SyncState,
    on_disk: &dyn Fn(Folder, &str) -> bool,
) -> Vec<SyncAction> {
    let mut actions = clip_actions(manifest, state, on_disk);
    actions.extend(short_actions(manifest, state, on_disk));
    actions
}

fn clip_actions(
    manifest: &SyncManifest,
    state: &SyncState,
    on_disk: &dyn Fn(Folder, &str) -> bool,
) -> Vec<SyncAction> {
    let mut actions = Vec::new();
    for clip in &manifest.clips {
        actions.extend(proxy_action(clip, state, on_disk));
        actions.extend(original_action(clip, state, on_disk));
    }
    actions.extend(removed_clips(manifest, state));
    actions
}

fn proxy_action(
    clip: &SyncClip,
    state: &SyncState,
    on_disk: &dyn Fn(Folder, &str) -> bool,
) -> Option<SyncAction> {
    let want = proxy_file(clip.recorded_at.as_deref(), &clip.title, &clip.clip_id);
    match state.clips.get(&clip.clip_id) {
        Some(local) if on_disk(Folder::Library, &local.file) => {
            (local.file != want).then(|| rename(Folder::Library, &clip.clip_id, &local.file, &want))
        }
        _ => Some(SyncAction::DownloadProxy {
            clip_id: clip.clip_id.clone(),
            url: clip.proxy_url.clone(),
            file: want,
            size: clip.proxy_size_bytes,
        }),
    }
}

fn original_action(
    clip: &SyncClip,
    state: &SyncState,
    on_disk: &dyn Fn(Folder, &str) -> bool,
) -> Option<SyncAction> {
    let original = state.originals.get(&clip.clip_id)?;
    let want = original_file(
        clip.recorded_at.as_deref(),
        &clip.title,
        &clip.clip_id,
        &clip.ext,
    );
    match &original.file {
        Some(file) if on_disk(Folder::Originals, file) => {
            (*file != want).then(|| rename(Folder::Originals, &clip.clip_id, file, &want))
        }
        _ => Some(SyncAction::DownloadOriginal {
            clip_id: clip.clip_id.clone(),
            file: want,
        }),
    }
}

fn removed_clips(manifest: &SyncManifest, state: &SyncState) -> Vec<SyncAction> {
    let gone = |id: &&String| !manifest.clips.iter().any(|c| &c.clip_id == *id);
    let mut removed: Vec<&String> = state
        .clips
        .keys()
        .chain(state.originals.keys())
        .filter(gone)
        .collect();
    removed.sort();
    removed.dedup();
    removed
        .into_iter()
        .map(|id| {
            let mut files = Vec::new();
            if let Some(local) = state.clips.get(id) {
                files.push((Folder::Library, local.file.clone()));
            }
            if let Some(file) = state.originals.get(id).and_then(|o| o.file.clone()) {
                files.push((Folder::Originals, file));
            }
            SyncAction::TrashClip {
                clip_id: id.clone(),
                files,
            }
        })
        .collect()
}

fn short_actions(
    manifest: &SyncManifest,
    state: &SyncState,
    on_disk: &dyn Fn(Folder, &str) -> bool,
) -> Vec<SyncAction> {
    let mut actions: Vec<SyncAction> = manifest
        .shorts
        .iter()
        .filter_map(|short| render_action(short, state, on_disk))
        .collect();
    actions.extend(removed_shorts(manifest, state));
    actions
}

fn render_action(
    short: &SyncShort,
    state: &SyncState,
    on_disk: &dyn Fn(Folder, &str) -> bool,
) -> Option<SyncAction> {
    let url = short
        .render_url
        .as_ref()
        .filter(|_| short.status == ShortStatus::Ready)?;
    let current = state.shorts.get(&short.short_id).filter(|local| {
        local.version == short.best_version && on_disk(Folder::Shorts, &local.file)
    });
    current.is_none().then(|| SyncAction::DownloadRender {
        short_id: short.short_id.clone(),
        url: url.clone(),
        file: render_file(&short.created_at, &short.prompt, &short.short_id),
        version: short.best_version,
    })
}

fn removed_shorts(manifest: &SyncManifest, state: &SyncState) -> Vec<SyncAction> {
    let gone = |id: &&String| !manifest.shorts.iter().any(|s| &s.short_id == *id);
    let mut removed: Vec<&String> = state
        .shorts
        .keys()
        .chain(state.projects.keys())
        .filter(gone)
        .collect();
    removed.sort();
    removed.dedup();
    removed
        .into_iter()
        .map(|id| {
            let mut files = Vec::new();
            if let Some(local) = state.shorts.get(id) {
                files.push((Folder::Shorts, local.file.clone()));
            }
            if let Some(project) = state.projects.get(id) {
                files.push((Folder::Projects, project.clone()));
            }
            SyncAction::TrashShort {
                short_id: id.clone(),
                files,
            }
        })
        .collect()
}

fn rename(folder: Folder, clip_id: &str, from: &str, to: &str) -> SyncAction {
    SyncAction::Rename {
        folder,
        clip_id: clip_id.to_owned(),
        from: from.to_owned(),
        to: to.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use nimbytes_contracts::sync::Aspect;

    use super::*;
    use crate::core::state::{LocalClip, LocalOriginal, LocalShort, OriginalKind};

    const A: &str = "019a0000-0000-7000-8000-00000000aaaa";
    const B: &str = "019a0000-0000-7000-8000-00000000bbbb";
    const S: &str = "019a0000-0000-7000-8000-00000000cccc";

    fn clip(id: &str, title: &str) -> SyncClip {
        SyncClip {
            clip_id: id.into(),
            title: title.into(),
            filename: "x.mov".into(),
            ext: "mov".into(),
            size_bytes: 10,
            duration_s: Some(5.0),
            fps: Some(30.0),
            width: Some(1440),
            height: Some(1920),
            recorded_at: Some("2026-10-27T01:00:00Z".into()),
            proxy_url: format!("https://s3/{id}"),
            proxy_size_bytes: Some(4),
        }
    }

    fn short(status: ShortStatus, version: Option<u32>, url: Option<&str>) -> SyncShort {
        SyncShort {
            short_id: S.into(),
            prompt: "Beach day".into(),
            aspect: Aspect::Portrait,
            status,
            best_version: version,
            render_url: url.map(str::to_owned),
            created_at: "2026-10-27T02:00:00Z".into(),
        }
    }

    fn manifest(clips: Vec<SyncClip>, shorts: Vec<SyncShort>) -> SyncManifest {
        SyncManifest {
            etag: "e".into(),
            clips,
            shorts,
        }
    }

    fn all_on_disk(_: Folder, _: &str) -> bool {
        true
    }

    #[test]
    fn a_new_clip_downloads_its_proxy() {
        let m = manifest(vec![clip(A, "Walk")], vec![]);
        let actions = plan(&m, &SyncState::default(), &all_on_disk);
        assert_eq!(
            actions,
            vec![SyncAction::DownloadProxy {
                clip_id: A.into(),
                url: format!("https://s3/{A}"),
                file: "2026-10-27 Walk [0000aaaa].mp4".into(),
                size: Some(4),
            }]
        );
    }

    #[test]
    fn a_synced_clip_with_the_same_title_needs_nothing_and_a_new_title_renames() {
        let mut state = SyncState::default();
        state.clips.insert(
            A.into(),
            LocalClip {
                file: "2026-10-27 Walk [0000aaaa].mp4".into(),
                size_bytes: 4,
            },
        );
        assert!(
            plan(
                &manifest(vec![clip(A, "Walk")], vec![]),
                &state,
                &all_on_disk
            )
            .is_empty()
        );
        let actions = plan(
            &manifest(vec![clip(A, "Run")], vec![]),
            &state,
            &all_on_disk,
        );
        assert_eq!(
            actions,
            vec![SyncAction::Rename {
                folder: Folder::Library,
                clip_id: A.into(),
                from: "2026-10-27 Walk [0000aaaa].mp4".into(),
                to: "2026-10-27 Run [0000aaaa].mp4".into(),
            }]
        );
    }

    #[test]
    fn a_proxy_missing_from_disk_is_fetched_again() {
        let mut state = SyncState::default();
        state.clips.insert(
            A.into(),
            LocalClip {
                file: "2026-10-27 Walk [0000aaaa].mp4".into(),
                size_bytes: 4,
            },
        );
        let actions = plan(&manifest(vec![clip(A, "Walk")], vec![]), &state, &|_, _| {
            false
        });
        assert!(matches!(
            actions.as_slice(),
            [SyncAction::DownloadProxy { .. }]
        ));
    }

    #[test]
    fn a_clip_gone_from_the_cloud_sends_proxy_and_original_to_the_trash() {
        let mut state = SyncState::default();
        state.clips.insert(
            B.into(),
            LocalClip {
                file: "b.mp4".into(),
                size_bytes: 4,
            },
        );
        state.originals.insert(
            B.into(),
            LocalOriginal {
                file: Some("b.mov".into()),
                size_bytes: 10,
                kind: OriginalKind::Pinned,
                last_used_ms: 0,
            },
        );
        let actions = plan(&manifest(vec![], vec![]), &state, &all_on_disk);
        assert_eq!(
            actions,
            vec![SyncAction::TrashClip {
                clip_id: B.into(),
                files: vec![
                    (Folder::Library, "b.mp4".into()),
                    (Folder::Originals, "b.mov".into())
                ],
            }]
        );
    }

    #[test]
    fn a_wanted_original_not_on_disk_is_downloaded() {
        let mut state = SyncState::default();
        state.clips.insert(
            A.into(),
            LocalClip {
                file: "2026-10-27 Walk [0000aaaa].mp4".into(),
                size_bytes: 4,
            },
        );
        state.originals.insert(
            A.into(),
            LocalOriginal {
                file: None,
                size_bytes: 0,
                kind: OriginalKind::Pinned,
                last_used_ms: 0,
            },
        );
        let actions = plan(
            &manifest(vec![clip(A, "Walk")], vec![]),
            &state,
            &all_on_disk,
        );
        assert_eq!(
            actions,
            vec![SyncAction::DownloadOriginal {
                clip_id: A.into(),
                file: "2026-10-27 Walk [0000aaaa].mov".into(),
            }]
        );
    }

    #[test]
    fn renders_sync_when_ready_and_again_when_the_best_version_changes() {
        let none = plan(
            &manifest(vec![], vec![short(ShortStatus::Rendering, Some(1), None)]),
            &SyncState::default(),
            &all_on_disk,
        );
        assert!(none.is_empty());
        let mut state = SyncState::default();
        state.shorts.insert(
            S.into(),
            LocalShort {
                file: "r.mp4".into(),
                version: Some(1),
            },
        );
        let same = manifest(vec![], vec![short(ShortStatus::Ready, Some(1), Some("u"))]);
        assert!(plan(&same, &state, &all_on_disk).is_empty());
        let newer = manifest(vec![], vec![short(ShortStatus::Ready, Some(2), Some("u"))]);
        assert_eq!(
            plan(&newer, &state, &all_on_disk),
            vec![SyncAction::DownloadRender {
                short_id: S.into(),
                url: "u".into(),
                file: "2026-10-27 beach-day [0000cccc].mp4".into(),
                version: Some(2),
            }]
        );
    }

    #[test]
    fn a_deleted_short_trashes_its_render_and_fcpxml() {
        let mut state = SyncState::default();
        state.shorts.insert(
            S.into(),
            LocalShort {
                file: "r.mp4".into(),
                version: Some(1),
            },
        );
        state.projects.insert(S.into(), "p.fcpxml".into());
        assert_eq!(
            plan(&manifest(vec![], vec![]), &state, &all_on_disk),
            vec![SyncAction::TrashShort {
                short_id: S.into(),
                files: vec![
                    (Folder::Shorts, "r.mp4".into()),
                    (Folder::Projects, "p.fcpxml".into())
                ],
            }]
        );
    }
}
