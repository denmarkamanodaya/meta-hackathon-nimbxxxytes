//! Fakes for media processing, scratch space and transcription. Nothing touches disk; calls are
//! recorded as text so tests can assert the exact sequence.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use nimbytes_core::AppError;
use nimbytes_core::domain::faces::FrameCrop;
use nimbytes_core::domain::ids::{ClipId, UserId};
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::transcript::RawTurn;
use nimbytes_core::ports::{MediaTool, PortResult, Scratch, Transcriber};

/// [`MediaTool`] returning a set probe and cut list; every call is logged as `op src -> dst`.
#[derive(Debug)]
pub struct FakeMediaTool {
    probe: ProbeInfo,
    proxy_probe: Mutex<Option<ProbeInfo>>,
    cuts: Vec<f64>,
    calls: Mutex<Vec<String>>,
    disk: Option<Arc<FakeScratch>>,
}

impl FakeMediaTool {
    /// A tool that reports `probe` and `cuts`.
    pub fn new(probe: ProbeInfo, cuts: Vec<f64>) -> Self {
        Self {
            probe,
            proxy_probe: Mutex::new(None),
            cuts,
            calls: Mutex::new(Vec::new()),
            disk: None,
        }
    }

    /// Like [`FakeMediaTool::new`], but every output file "appears" in `disk`.
    pub fn writing_to(probe: ProbeInfo, cuts: Vec<f64>, disk: Arc<FakeScratch>) -> Self {
        Self {
            disk: Some(disk),
            ..Self::new(probe, cuts)
        }
    }

    /// What probing `proxy_720p.mp4` reports from now on (else the original's probe).
    pub fn set_proxy_probe(&self, probe: ProbeInfo) {
        *crate::lock(&self.proxy_probe) = Some(probe);
    }

    /// Calls so far, e.g. `proxy original.mov -> proxy_720p.mp4` (file names only).
    pub fn calls(&self) -> Vec<String> {
        crate::lock(&self.calls).clone()
    }

    /// Records one call; always `Ok`, so fake methods can return it directly.
    fn log(&self, op: &str, src: &Path, dst: Option<&Path>) -> Result<(), AppError> {
        let name = |p: &Path| {
            p.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        let line = match dst {
            Some(d) => format!("{op} {} -> {}", name(src), name(d)),
            None => format!("{op} {}", name(src)),
        };
        crate::lock(&self.calls).push(line);
        if let (Some(disk), Some(d)) = (&self.disk, dst) {
            disk.add(d);
        }
        Ok(())
    }
}

impl MediaTool for FakeMediaTool {
    fn probe<'a>(&'a self, src: &'a Path) -> PortResult<'a, ProbeInfo> {
        Box::pin(async move {
            self.log("probe", src, None)?;
            let is_proxy = src.file_name().is_some_and(|n| n == "proxy_720p.mp4");
            let proxy = crate::lock(&self.proxy_probe).clone();
            Ok(proxy
                .filter(|_| is_proxy)
                .unwrap_or_else(|| self.probe.clone()))
        })
    }

    fn make_proxy<'a>(
        &'a self,
        src: &'a Path,
        dst: &'a Path,
        _timeout: std::time::Duration,
    ) -> PortResult<'a, ()> {
        Box::pin(async move { self.log("proxy", src, Some(dst)) })
    }

    fn make_sam_fps1<'a>(&'a self, src: &'a Path, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move { self.log("fps1", src, Some(dst)) })
    }

    fn extract_wav<'a>(&'a self, src: &'a Path, span: Span, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.log(
                &format!("wav {}-{}", span.start_s, span.end_s),
                src,
                Some(dst),
            )
        })
    }

    fn scene_cuts<'a>(&'a self, src: &'a Path) -> PortResult<'a, Vec<f64>> {
        Box::pin(async move {
            self.log("cuts", src, None)?;
            Ok(self.cuts.clone())
        })
    }

    fn thumbnail<'a>(&'a self, src: &'a Path, at_s: f64, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move { self.log(&format!("thumb@{at_s}"), src, Some(dst)) })
    }

    fn snippet<'a>(&'a self, src: &'a Path, span: Span, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.log(
                &format!("snippet {}-{}", span.start_s, span.end_s),
                src,
                Some(dst),
            )
        })
    }

    fn range_proxy<'a>(
        &'a self,
        src: &'a Path,
        (span, fps): (Span, u32),
        dst: &'a Path,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.log(
                &format!("range {}-{}@{fps}", span.start_s, span.end_s),
                src,
                Some(dst),
            )
        })
    }

    fn frame_at<'a>(&'a self, src: &'a Path, at_s: f64, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move { self.log(&format!("frame@{at_s}"), src, Some(dst)) })
    }

    fn crop<'a>(&'a self, src: &'a Path, crop: FrameCrop, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            let r = crop.rect;
            self.log(
                &format!("crop@{} {}x{}+{}", crop.at_s, r.x, r.y, r.side),
                src,
                Some(dst),
            )
        })
    }
}

/// [`Scratch`] over an in-memory set of "existing" paths under `/scratch/{clip}`.
#[derive(Debug, Default)]
pub struct FakeScratch {
    existing: Mutex<HashSet<PathBuf>>,
    removed: Mutex<Vec<String>>,
    hashes: Mutex<Vec<(PathBuf, String)>>,
}

impl FakeScratch {
    /// Marks a file as present (as if an earlier run left it).
    pub fn add(&self, path: impl Into<PathBuf>) {
        crate::lock(&self.existing).insert(path.into());
    }

    /// The SHA-256 `sha256` answers for `path` (otherwise `sha-of:<path>`).
    pub fn set_hash(&self, path: impl Into<PathBuf>, hash: &str) {
        crate::lock(&self.hashes).push((path.into(), hash.to_owned()));
    }

    /// Directories removed so far: clip ids, `users/{user}`, `shorts/{short}`.
    pub fn removed(&self) -> Vec<String> {
        crate::lock(&self.removed).clone()
    }
}

impl Scratch for FakeScratch {
    fn sha256<'a>(&'a self, path: &'a Path) -> PortResult<'a, String> {
        Box::pin(async move {
            let hashes = crate::lock(&self.hashes);
            let set = hashes
                .iter()
                .find(|(p, _)| p == path)
                .map(|(_, h)| h.clone());
            Ok(set.unwrap_or_else(|| format!("sha-of:{}", path.display())))
        })
    }

    fn clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, PathBuf> {
        Box::pin(async move { Ok(PathBuf::from(format!("/scratch/{clip}"))) })
    }

    fn exists<'a>(&'a self, path: &'a Path) -> PortResult<'a, bool> {
        Box::pin(async move { Ok(crate::lock(&self.existing).contains(path)) })
    }

    fn short_dir<'a>(
        &'a self,
        short: &'a nimbytes_core::domain::ids::ShortId,
    ) -> PortResult<'a, PathBuf> {
        Box::pin(async move { Ok(PathBuf::from(format!("/scratch/shorts/{short}"))) })
    }

    fn remove_clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.removed).push(clip.to_string());
            Ok(())
        })
    }

    fn user_dir<'a>(&'a self, user: &'a UserId) -> PortResult<'a, PathBuf> {
        Box::pin(async move { Ok(PathBuf::from(format!("/scratch/users/{user}"))) })
    }

    /// Recorded in `removed` as `shorts/{short}`.
    fn remove_short_dir<'a>(
        &'a self,
        short: &'a nimbytes_core::domain::ids::ShortId,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.removed).push(format!("shorts/{short}"));
            Ok(())
        })
    }

    /// Recorded in `removed` as `users/{user}`.
    fn remove_user_dir<'a>(&'a self, user: &'a UserId) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.removed).push(format!("users/{user}"));
            Ok(())
        })
    }
}

/// [`Transcriber`] returning set turns and counting calls.
#[derive(Debug, Default)]
pub struct FakeTranscriber {
    turns: Mutex<Vec<RawTurn>>,
    calls: Mutex<Vec<String>>,
    error: Mutex<Option<AppError>>,
}

impl FakeTranscriber {
    /// Turns every call returns.
    pub fn returns(&self, turns: Vec<RawTurn>) {
        *crate::lock(&self.turns) = turns;
    }

    /// Makes every call fail with `error`.
    pub fn fails_with(&self, error: AppError) {
        *crate::lock(&self.error) = Some(error);
    }

    /// File names transcribed so far.
    pub fn calls(&self) -> Vec<String> {
        crate::lock(&self.calls).clone()
    }
}

impl Transcriber for FakeTranscriber {
    fn transcribe<'a>(&'a self, wav: &'a Path) -> PortResult<'a, Vec<RawTurn>> {
        Box::pin(async move {
            let name = wav
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            crate::lock(&self.calls).push(name);
            if let Some(err) = crate::lock(&self.error).clone() {
                return Err(err);
            }
            Ok(crate::lock(&self.turns).clone())
        })
    }
}
