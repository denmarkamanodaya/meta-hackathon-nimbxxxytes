//! [`BlobStore`] on Amazon S3. The browser PUTs part bytes straight to presigned `UploadPart`
//! URLs; this adapter only starts, presigns, completes and measures uploads.

use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use aws_sdk_s3::Client;
use aws_sdk_s3::error::ProvideErrorMetadata;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart as S3Part, Tag, Tagging};
use nimbytes_core::domain::upload::CompletedPart;
use nimbytes_core::keys::{CLASS_TAG_KEY, ObjectClass, ObjectKey};
use nimbytes_core::ports::{BlobStore, Clock, PortResult, PutFile};
use nimbytes_core::{AppError, ErrorCode};

/// S3 error codes that mean the client's parts or upload id are wrong, not that S3 is down.
const INCOMPLETE_CODES: [&str; 4] = [
    "InvalidPart",
    "InvalidPartOrder",
    "NoSuchUpload",
    "EntityTooSmall",
];

/// S3-backed store for one bucket.
#[derive(Clone)]
pub struct S3BlobStore {
    client: Client,
    bucket: String,
    presign_ttl: Duration,
    clock: Arc<dyn Clock>,
}

/// GET URLs are signed as of the start of the current hour, so every request in that hour gets
/// the same URL and the browser cache hits.
const SIGNING_BUCKET_MS: i64 = 3_600_000;

impl S3BlobStore {
    /// Uses `client` (built in the composition root with region, credentials and timeouts) for
    /// `bucket`; presigned part URLs live for `presign_ttl`; `clock` picks the signing hour.
    pub fn new(
        client: Client,
        bucket: impl Into<String>,
        presign_ttl: Duration,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            client,
            bucket: bucket.into(),
            presign_ttl,
            clock,
        }
    }

    /// Signs as of the start of the current hour, valid until `ttl` after the end of that hour:
    /// at least `ttl` left whenever it is handed out, and identical for the whole hour.
    fn hourly(&self, ttl: Duration) -> Result<PresigningConfig, AppError> {
        let now = self.clock.now_millis();
        let start = now - now.rem_euclid(SIGNING_BUCKET_MS);
        let start = u64::try_from(start).map_err(internal)?;
        let bucket = Duration::from_millis(SIGNING_BUCKET_MS.unsigned_abs());
        PresigningConfig::builder()
            .start_time(UNIX_EPOCH + Duration::from_millis(start))
            .expires_in(ttl + bucket)
            .build()
            .map_err(internal)
    }

    async fn presign(
        &self,
        key: &ObjectKey,
        upload_id: &str,
        part: u32,
    ) -> Result<String, AppError> {
        let part = i32::try_from(part)
            .map_err(|_| AppError::new(ErrorCode::ValidationFailed, "part number too large"))?;
        let config = PresigningConfig::expires_in(self.presign_ttl).map_err(internal)?;
        let request = self
            .client
            .upload_part()
            .bucket(&self.bucket)
            .key(key.as_str())
            .upload_id(upload_id)
            .part_number(part)
            .presigned(config)
            .await
            .map_err(internal)?;
        Ok(request.uri().to_owned())
    }

    async fn complete(
        &self,
        key: &ObjectKey,
        upload_id: &str,
        parts: &[CompletedPart],
    ) -> Result<(), AppError> {
        let parts = parts
            .iter()
            .map(|p| {
                let n = i32::try_from(p.n).unwrap_or(i32::MAX);
                S3Part::builder().part_number(n).e_tag(&p.etag).build()
            })
            .collect();
        let upload = CompletedMultipartUpload::builder()
            .set_parts(Some(parts))
            .build();
        self.client
            .complete_multipart_upload()
            .bucket(&self.bucket)
            .key(key.as_str())
            .upload_id(upload_id)
            .multipart_upload(upload)
            .send()
            .await
            .map_err(|err| match err.code() {
                Some(code) if INCOMPLETE_CODES.contains(&code) => AppError::new(
                    ErrorCode::UploadIncomplete,
                    format!("S3 rejected parts: {code}"),
                ),
                _ => internal(err),
            })?;
        Ok(())
    }
}

impl S3BlobStore {
    async fn put(&self, put: PutFile<'_>) -> Result<(), AppError> {
        let body = ByteStream::from_path(put.path).await.map_err(internal)?;
        let mut req = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(put.key.as_str())
            .content_type(put.content_type)
            .body(body);
        if let Some(class) = put.class {
            req = req.tagging(class.tagging());
        }
        if let Some(cache) = put.cache_control {
            req = req.cache_control(cache);
        }
        req.send().await.map_err(internal)?;
        Ok(())
    }

    async fn presign_get_url(&self, key: &ObjectKey, ttl: Duration) -> Result<String, AppError> {
        let config = self.hourly(ttl)?;
        let req = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key.as_str())
            .presigned(config)
            .await
            .map_err(internal)?;
        Ok(req.uri().to_owned())
    }

    async fn presign_put_url(&self, key: &ObjectKey, ttl: Duration) -> Result<String, AppError> {
        let config = PresigningConfig::expires_in(ttl).map_err(internal)?;
        let req = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key.as_str())
            .presigned(config)
            .await
            .map_err(internal)?;
        Ok(req.uri().to_owned())
    }

    async fn put_tag(&self, key: &ObjectKey, class: ObjectClass) -> Result<(), AppError> {
        let tag = Tag::builder()
            .key(CLASS_TAG_KEY)
            .value(class.tag_value())
            .build()
            .map_err(internal)?;
        let tagging = Tagging::builder().tag_set(tag).build().map_err(internal)?;
        self.client
            .put_object_tagging()
            .bucket(&self.bucket)
            .key(key.as_str())
            .tagging(tagging)
            .send()
            .await
            .map_err(internal)?;
        Ok(())
    }

    async fn presign_download_url(
        &self,
        key: &ObjectKey,
        ttl: Duration,
        filename: &str,
    ) -> Result<String, AppError> {
        let config = self.hourly(ttl)?;
        let safe: String = filename
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
            .collect();
        let req = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key.as_str())
            .response_content_disposition(format!("attachment; filename=\"{safe}\""))
            .presigned(config)
            .await
            .map_err(internal)?;
        Ok(req.uri().to_owned())
    }

    async fn get(&self, key: &ObjectKey, path: &std::path::Path) -> Result<(), AppError> {
        let out = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key.as_str())
            .send()
            .await
            .map_err(|err| {
                if err.as_service_error().is_some_and(|e| e.is_no_such_key()) {
                    AppError::new(ErrorCode::NotFound, "no such object")
                } else {
                    internal(err)
                }
            })?;
        let mut reader = out.body.into_async_read();
        let mut file = tokio::fs::File::create(path).await.map_err(internal)?;
        tokio::io::copy(&mut reader, &mut file)
            .await
            .map_err(internal)?;
        Ok(())
    }
}

/// Applies the settings every S3 client here needs on top of region and credentials.
///
/// Checksums only when an operation requires them: otherwise presigned `UploadPart` URLs would
/// sign `x-amz-checksum-*` values the browser cannot send, and every part PUT would fail.
pub fn configure(builder: aws_sdk_s3::config::Builder) -> aws_sdk_s3::config::Builder {
    builder
        .request_checksum_calculation(aws_sdk_s3::config::RequestChecksumCalculation::WhenRequired)
}

/// Maps any SDK failure to `INTERNAL`; the detail goes to logs only.
fn internal(err: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::Internal, format!("s3: {err}"))
}

impl BlobStore for S3BlobStore {
    fn create_multipart<'a>(
        &'a self,
        key: &'a ObjectKey,
        content_type: &'a str,
        class: ObjectClass,
    ) -> PortResult<'a, String> {
        Box::pin(async move {
            let out = self
                .client
                .create_multipart_upload()
                .bucket(&self.bucket)
                .key(key.as_str())
                .content_type(content_type)
                // Lifecycle rules filter on this tag (x-amz-tagging header).
                .tagging(class.tagging())
                .send()
                .await
                .map_err(internal)?;
            out.upload_id
                .ok_or_else(|| AppError::new(ErrorCode::Internal, "s3: no UploadId in response"))
        })
    }

    fn presign_upload_part<'a>(
        &'a self,
        key: &'a ObjectKey,
        store_upload_id: &'a str,
        part: u32,
    ) -> PortResult<'a, String> {
        Box::pin(self.presign(key, store_upload_id, part))
    }

    fn complete_multipart<'a>(
        &'a self,
        key: &'a ObjectKey,
        store_upload_id: &'a str,
        parts: &'a [CompletedPart],
    ) -> PortResult<'a, ()> {
        Box::pin(self.complete(key, store_upload_id, parts))
    }

    fn object_size<'a>(&'a self, key: &'a ObjectKey) -> PortResult<'a, u64> {
        Box::pin(async move {
            let out = self
                .client
                .head_object()
                .bucket(&self.bucket)
                .key(key.as_str())
                .send()
                .await
                .map_err(|err| {
                    if err.as_service_error().is_some_and(|e| e.is_not_found()) {
                        AppError::new(ErrorCode::NotFound, "no such object")
                    } else {
                        internal(err)
                    }
                })?;
            let len = out.content_length.unwrap_or(-1);
            u64::try_from(len).map_err(|_| internal("HeadObject without Content-Length"))
        })
    }

    fn put_file<'a>(&'a self, put: PutFile<'a>) -> PortResult<'a, ()> {
        Box::pin(self.put(put))
    }

    fn get_to_file<'a>(
        &'a self,
        key: &'a ObjectKey,
        path: &'a std::path::Path,
    ) -> PortResult<'a, ()> {
        Box::pin(self.get(key, path))
    }

    fn presign_get<'a>(&'a self, key: &'a ObjectKey, ttl: Duration) -> PortResult<'a, String> {
        Box::pin(self.presign_get_url(key, ttl))
    }

    fn presign_put<'a>(&'a self, key: &'a ObjectKey, ttl: Duration) -> PortResult<'a, String> {
        Box::pin(self.presign_put_url(key, ttl))
    }

    fn tag<'a>(&'a self, key: &'a ObjectKey, class: ObjectClass) -> PortResult<'a, ()> {
        Box::pin(self.put_tag(key, class))
    }

    fn presign_download<'a>(
        &'a self,
        key: &'a ObjectKey,
        ttl: Duration,
        filename: &'a str,
    ) -> PortResult<'a, String> {
        Box::pin(self.presign_download_url(key, ttl, filename))
    }
}

#[cfg(test)]
mod tests;
