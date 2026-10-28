//! [`MediaTool`] on the ffmpeg and ffprobe binaries. Every call runs as a child process with a
//! timeout and is killed when the timeout fires; failures become `MEDIA_FAILED`.

mod args;
mod parse;

use std::path::Path;
use std::time::Duration;

use nimbytes_core::domain::faces::FrameCrop;
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::{MediaTool, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use tokio::process::Command;

/// Child-process limits, set in the composition root.
#[derive(Debug, Clone, Copy)]
pub struct MediaTimeouts {
    /// ffprobe and scene-cut scans.
    pub probe: Duration,
    /// Any encode (proxy, copies, WAV, thumbnails, snippets).
    pub encode: Duration,
}

/// ffmpeg-backed media tool; binaries are looked up on `PATH`.
#[derive(Debug, Clone)]
pub struct FfmpegMediaTool {
    timeouts: MediaTimeouts,
}

impl FfmpegMediaTool {
    /// Uses `ffmpeg` / `ffprobe` from `PATH` with `timeouts`.
    pub fn new(timeouts: MediaTimeouts) -> Self {
        Self { timeouts }
    }

    async fn ffmpeg(&self, args: Vec<String>, timeout: Duration) -> Result<String, AppError> {
        run("ffmpeg", args, timeout).await
    }
}

/// Runs `bin args`, returning stdout; non-zero exit, spawn failure or timeout → `MEDIA_FAILED`.
async fn run(bin: &str, args: Vec<String>, timeout: Duration) -> Result<String, AppError> {
    let child = Command::new(bin).args(&args).kill_on_drop(true).output();
    let output = tokio::time::timeout(timeout, child)
        .await
        .map_err(|_| {
            AppError::new(
                ErrorCode::MediaFailed,
                format!("{bin} timed out after {timeout:?}"),
            )
        })?
        .map_err(|e| AppError::new(ErrorCode::MediaFailed, format!("{bin} did not start: {e}")))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail: String = stderr
        .chars()
        .rev()
        .take(500)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    Err(AppError::new(
        ErrorCode::MediaFailed,
        format!("{bin} failed ({}): {tail}", output.status),
    ))
}

impl MediaTool for FfmpegMediaTool {
    fn probe<'a>(&'a self, src: &'a Path) -> PortResult<'a, ProbeInfo> {
        Box::pin(async move {
            let json = run("ffprobe", args::probe(src), self.timeouts.probe).await?;
            parse::probe_info(&json)
        })
    }

    fn make_proxy<'a>(
        &'a self,
        src: &'a Path,
        dst: &'a Path,
        timeout: Duration,
    ) -> PortResult<'a, ()> {
        Box::pin(async move { self.ffmpeg(args::proxy(src, dst), timeout).await.map(drop) })
    }

    fn make_sam_fps1<'a>(&'a self, src: &'a Path, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.ffmpeg(args::sam_fps1(src, dst), self.timeouts.encode)
                .await
                .map(drop)
        })
    }

    fn extract_wav<'a>(&'a self, src: &'a Path, span: Span, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.ffmpeg(args::wav(src, span, dst), self.timeouts.encode)
                .await
                .map(drop)
        })
    }

    fn scene_cuts<'a>(&'a self, src: &'a Path) -> PortResult<'a, Vec<f64>> {
        Box::pin(async move {
            let out = self
                .ffmpeg(args::scene_cuts(src), self.timeouts.probe)
                .await?;
            Ok(parse::cut_times(&out))
        })
    }

    fn thumbnail<'a>(&'a self, src: &'a Path, at_s: f64, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.ffmpeg(args::thumbnail(src, at_s, dst), self.timeouts.encode)
                .await
                .map(drop)
        })
    }

    fn snippet<'a>(&'a self, src: &'a Path, span: Span, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.ffmpeg(args::snippet(src, span, dst), self.timeouts.encode)
                .await
                .map(drop)
        })
    }

    fn range_proxy<'a>(
        &'a self,
        src: &'a Path,
        (span, fps): (Span, u32),
        dst: &'a Path,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.ffmpeg(args::range_proxy(src, span, fps, dst), self.timeouts.encode)
                .await
                .map(drop)
        })
    }

    fn frame_at<'a>(&'a self, src: &'a Path, at_s: f64, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.ffmpeg(args::frame_at(src, at_s, dst), self.timeouts.encode)
                .await
                .map(drop)
        })
    }

    fn crop<'a>(&'a self, src: &'a Path, crop: FrameCrop, dst: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.ffmpeg(args::crop(src, crop, dst), self.timeouts.encode)
                .await
                .map(drop)
        })
    }
}

#[cfg(test)]
mod smoke_tests;
