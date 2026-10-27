//! [`RangeSource`] over HTTP Range requests: a clip's original through a presigned URL from
//! `POST /api/sync/clips/{id}/original` (asked again when it expires), a short's render through the
//! manifest's presigned URL.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nimbytes_contracts::sync::OriginalResponse;
use reqwest::{StatusCode, header};

use crate::adapters::api_client::{ApiClient, network};
use crate::core::drive::Media;
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::ports::RangeSource;

/// Presigned URLs last for the server's TTL; ask again well before it.
const URL_MAX_AGE: Duration = Duration::from_secs(30 * 60);
/// Longest wait for one range.
const RANGE_TIMEOUT: Duration = Duration::from_secs(60);

/// The adapter.
pub struct HttpRangeSource {
    api: Arc<ApiClient>,
    urls: Mutex<HashMap<String, (String, Instant)>>,
}

/// The total size in a `Content-Range: bytes 0-0/12345` header.
fn total_size(content_range: &str) -> Option<u64> {
    content_range.rsplit_once('/')?.1.trim().parse().ok()
}

impl HttpRangeSource {
    /// Builds the adapter on the app's API client.
    pub fn new(api: Arc<ApiClient>) -> Self {
        Self {
            api,
            urls: Mutex::new(HashMap::new()),
        }
    }

    async fn original_url(&self, clip_id: &str, fresh: bool) -> DesktopResult<String> {
        if !fresh
            && let Ok(urls) = self.urls.lock()
            && let Some((url, at)) = urls.get(clip_id)
            && at.elapsed() < URL_MAX_AGE
        {
            return Ok(url.clone());
        }
        let path = format!("/api/sync/clips/{clip_id}/original");
        let res: OriginalResponse = self.api.post_json(&path, &serde_json::json!({})).await?;
        if let Ok(mut urls) = self.urls.lock() {
            urls.insert(clip_id.to_owned(), (res.url.clone(), Instant::now()));
        }
        Ok(res.url)
    }

    /// One Range GET; `Ok(None)` when the URL has expired (403).
    async fn get(&self, url: &str, start: u64, len: u64) -> DesktopResult<Option<reqwest::Response>> {
        let res = self
            .api
            .http()
            .get(url)
            .header(header::RANGE, format!("bytes={}-{}", start, start + len - 1))
            .timeout(RANGE_TIMEOUT)
            .send()
            .await
            .map_err(|e| network(&e))?;
        match res.status() {
            StatusCode::PARTIAL_CONTENT => Ok(Some(res)),
            StatusCode::FORBIDDEN => Ok(None),
            status => Err(DesktopError::new(ErrorCode::BadStatus, format!("range status {status}"))),
        }
    }

    /// A Range GET of `media`, asking for a fresh original URL once when it expired.
    async fn response(&self, media: &Media, start: u64, len: u64) -> DesktopResult<reqwest::Response> {
        match media {
            Media::Original { clip_id } => {
                for fresh in [false, true] {
                    let url = self.original_url(clip_id, fresh).await?;
                    if let Some(res) = self.get(&url, start, len).await? {
                        return Ok(res);
                    }
                }
                Err(DesktopError::new(ErrorCode::UrlExpired, "original URL refused after a refresh"))
            }
            Media::Render { url, .. } => self
                .get(url, start, len)
                .await?
                .ok_or_else(|| DesktopError::new(ErrorCode::UrlExpired, "render URL expired")),
        }
    }
}

#[async_trait::async_trait]
impl RangeSource for HttpRangeSource {
    async fn range(&self, media: &Media, start: u64, len: u64) -> DesktopResult<Vec<u8>> {
        if len == 0 {
            return Ok(Vec::new());
        }
        let body = self
            .response(media, start, len)
            .await?
            .bytes()
            .await
            .map_err(|e| network(&e))?;
        if body.len() as u64 != len {
            return Err(DesktopError::new(
                ErrorCode::SizeMismatch,
                format!("range got {} of {len} bytes", body.len()),
            ));
        }
        Ok(body.to_vec())
    }

    async fn size(&self, media: &Media) -> DesktopResult<u64> {
        let res = self.response(media, 0, 1).await?;
        res.headers()
            .get(header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(total_size)
            .ok_or_else(|| DesktopError::new(ErrorCode::BadResponse, "no Content-Range total"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_total_comes_from_content_range() {
        assert_eq!(total_size("bytes 0-0/48845297"), Some(48_845_297));
        assert_eq!(total_size("bytes 0-0/*"), None);
        assert_eq!(total_size("garbage"), None);
    }
}
