//! [`RangeSource`] over HTTP Range requests: a clip's original through a presigned URL from
//! `POST /api/sync/clips/{id}/original`, a recording's, document's or photo's original from
//! `POST /api/sync/items/{kind}/{id}/original` (both asked again when they expire), a short's
//! render through the manifest's presigned URL.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use nimbytes_contracts::sync::OriginalResponse;
use reqwest::{StatusCode, header};

use crate::adapters::api_client::{ApiClient, network};
use crate::core::drive::{ItemRef, Media, original_key};
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

/// The endpoint that signs an item's original.
fn item_original_path(item: &ItemRef) -> String {
    format!(
        "/api/sync/items/{}/{}/original",
        item.kind.as_str(),
        item.id
    )
}

impl HttpRangeSource {
    /// Builds the adapter on the app's API client.
    pub fn new(api: Arc<ApiClient>) -> Self {
        Self {
            api,
            urls: Mutex::new(HashMap::new()),
        }
    }

    /// A presigned URL of an original, cached by its cache key until [`URL_MAX_AGE`].
    async fn signed_url(&self, key: &str, path: &str, fresh: bool) -> DesktopResult<String> {
        if !fresh
            && let Ok(urls) = self.urls.lock()
            && let Some((url, at)) = urls.get(key)
            && at.elapsed() < URL_MAX_AGE
        {
            return Ok(url.clone());
        }
        let res: OriginalResponse = self.api.post_json(path, &serde_json::json!({})).await?;
        if let Ok(mut urls) = self.urls.lock() {
            urls.insert(key.to_owned(), (res.url.clone(), Instant::now()));
        }
        Ok(res.url)
    }

    /// One Range GET; `Ok(None)` when the URL has expired (403).
    async fn get(
        &self,
        url: &str,
        start: u64,
        len: u64,
    ) -> DesktopResult<Option<reqwest::Response>> {
        let res = self
            .api
            .http()
            .get(url)
            .header(
                header::RANGE,
                format!("bytes={}-{}", start, start + len - 1),
            )
            .timeout(RANGE_TIMEOUT)
            .send()
            .await
            .map_err(|e| network(&e))?;
        match res.status() {
            StatusCode::PARTIAL_CONTENT => Ok(Some(res)),
            StatusCode::FORBIDDEN => Ok(None),
            status => Err(DesktopError::new(
                ErrorCode::BadStatus,
                format!("range status {status}"),
            )),
        }
    }

    /// A Range GET through an original's presigned URL, asking for a fresh URL once when it
    /// expired.
    /// `original` is the URL cache key and the signing endpoint.
    async fn signed_get(
        &self,
        original: (&str, &str),
        start: u64,
        len: u64,
    ) -> DesktopResult<reqwest::Response> {
        let (key, path) = original;
        for fresh in [false, true] {
            let url = self.signed_url(key, path, fresh).await?;
            if let Some(res) = self.get(&url, start, len).await? {
                return Ok(res);
            }
        }
        Err(DesktopError::new(
            ErrorCode::UrlExpired,
            "original URL refused after a refresh",
        ))
    }

    /// A Range GET of `media`, asking for a fresh original URL once when it expired.
    async fn response(
        &self,
        media: &Media,
        start: u64,
        len: u64,
    ) -> DesktopResult<reqwest::Response> {
        match media {
            Media::Original { clip_id } => {
                let path = format!("/api/sync/clips/{clip_id}/original");
                self.signed_get((&original_key(clip_id), &path), start, len)
                    .await
            }
            Media::Item(item) => {
                self.signed_get((&item.key(), &item_original_path(item)), start, len)
                    .await
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

    #[test]
    fn items_sign_through_the_item_endpoint_with_the_manifest_kind() {
        let doc = ItemRef::parse("doc:d1").unwrap();
        assert_eq!(
            item_original_path(&doc),
            "/api/sync/items/document/d1/original"
        );
        let listen = ItemRef::parse("listen:l1").unwrap();
        assert_eq!(
            item_original_path(&listen),
            "/api/sync/items/listen/l1/original"
        );
        let photo = ItemRef::parse("photo:p1").unwrap();
        assert_eq!(
            item_original_path(&photo),
            "/api/sync/items/photo/p1/original"
        );
    }
}
