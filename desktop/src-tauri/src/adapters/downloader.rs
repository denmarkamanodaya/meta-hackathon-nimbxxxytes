//! Presigned S3 downloads into the sync folder: stream to `<name>.part`, resume with `Range`,
//! check the size, rename into place atomically and make the file read-only (app-managed).
//! No cookie is ever sent here.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use reqwest::StatusCode;
use reqwest::header::{CONTENT_LENGTH, RANGE};
use tokio::io::AsyncWriteExt;

use crate::adapters::api_client::network;
use crate::adapters::json_file::io;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};

/// Mode of app-managed files: read-only for everyone.
const READ_ONLY: u32 = 0o444;

/// Reports bytes done and total while a transfer runs.
pub type Progress<'a> = &'a (dyn Fn(u64, u64) + Send + Sync);

/// One download.
pub struct DownloadJob<'a> {
    /// Presigned URL.
    pub url: &'a str,
    /// Final path.
    pub target: &'a Path,
    /// Size the server announced, if any (else `Content-Length`).
    pub expected: Option<u64>,
    /// Progress callback.
    pub progress: Progress<'a>,
}

fn part_path(target: &Path) -> PathBuf {
    let ext = target.extension().and_then(|e| e.to_str()).unwrap_or("bin");
    target.with_extension(format!("{ext}.part"))
}

/// Downloads to `job.target`; returns the final size.
///
/// # Errors
/// `URL_EXPIRED` on 403 (ask for a fresh URL and call again: the `.part` is kept), `SIZE_MISMATCH`,
/// `BAD_STATUS`, `NETWORK` or `IO`.
pub async fn download(http: &reqwest::Client, job: DownloadJob<'_>) -> DesktopResult<u64> {
    let part = part_path(job.target);
    if let Some(dir) = job.target.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| io("create folder", &e))?;
    }
    let have = tokio::fs::metadata(&part)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let mut req = http.get(job.url);
    if have > 0 {
        req = req.header(RANGE, format!("bytes={have}-"));
    }
    let res = req.send().await.map_err(|e| network(&e))?;
    let (mut file, mut done, total) = open_part(&res, &part, have).await?;
    let total = job.expected.or(total).unwrap_or(0);
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| network(&e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| io("write part", &e))?;
        done += chunk.len() as u64;
        (job.progress)(done, total);
    }
    file.flush().await.map_err(|e| io("flush part", &e))?;
    drop(file);
    finish(&part, job.target, total).await
}

/// Opens the `.part` for the answer: append on 206, restart on 200, already whole on 416.
async fn open_part(
    res: &reqwest::Response,
    part: &Path,
    have: u64,
) -> DesktopResult<(tokio::fs::File, u64, Option<u64>)> {
    match res.status() {
        StatusCode::PARTIAL_CONTENT => {
            let file = append(part).await.map_err(|e| io("open part", &e))?;
            Ok((file, have, content_length(res).map(|r| r + have)))
        }
        StatusCode::OK => {
            let file = tokio::fs::File::create(part)
                .await
                .map_err(|e| io("create part", &e))?;
            Ok((file, 0, content_length(res)))
        }
        StatusCode::RANGE_NOT_SATISFIABLE => {
            let file = append(part).await.map_err(|e| io("open part", &e))?;
            Ok((file, have, Some(have)))
        }
        StatusCode::FORBIDDEN => Err(DesktopError::new(
            ErrorCode::UrlExpired,
            "download link expired",
        )),
        other => Err(DesktopError::new(
            ErrorCode::BadStatus,
            format!("storage answered {other}"),
        )),
    }
}

/// Checks the size, makes the file read-only and renames it into place.
async fn finish(part: &Path, target: &Path, total: u64) -> DesktopResult<u64> {
    let size = tokio::fs::metadata(part)
        .await
        .map_err(|e| io("stat part", &e))?
        .len();
    if total > 0 && size != total {
        // A wrong size is never resumed: start over next time.
        let _ = tokio::fs::remove_file(part).await;
        return Err(DesktopError::new(
            ErrorCode::SizeMismatch,
            format!("got {size} bytes, expected {total}"),
        ));
    }
    tokio::fs::set_permissions(part, std::fs::Permissions::from_mode(READ_ONLY))
        .await
        .map_err(|e| io("make read-only", &e))?;
    tokio::fs::rename(part, target)
        .await
        .map_err(|e| io("move into place", &e))?;
    Ok(size)
}

fn content_length(res: &reqwest::Response) -> Option<u64> {
    res.headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
}

async fn append(part: &Path) -> std::io::Result<tokio::fs::File> {
    tokio::fs::OpenOptions::new().append(true).open(part).await
}
