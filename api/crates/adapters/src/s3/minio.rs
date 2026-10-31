//! A local MinIO through its S3 API, for running nimbytes on one machine with no cloud account. The
//! store is the same [`super::S3BlobStore`]: one client on the host this server reaches (the MinIO
//! container) and, through [`super::S3BlobStore::presigning_with`], one that signs URLs for the host
//! the browser and the renderer reach (the local web server, which passes the bucket path through).

use aws_sdk_s3::config::Builder;
use nimbytes_core::{AppError, ErrorCode};

/// The region MinIO signs for unless told otherwise.
pub const REGION: &str = "us-east-1";

/// `url` when it is an `http://` or `https://` origin with no path (`http://minio:9000`), so the
/// bucket path is the whole path a presigned URL carries.
///
/// # Errors
/// `VALIDATION_FAILED` naming `name` otherwise.
pub fn origin(name: &str, url: &str) -> Result<String, AppError> {
    let url = url.trim().trim_end_matches('/');
    let host = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"));
    match host {
        Some(h) if !h.is_empty() && !h.contains('/') => Ok(url.to_owned()),
        _ => Err(AppError::new(
            ErrorCode::ValidationFailed,
            format!("env {name} must be an http:// or https:// origin with no path"),
        )),
    }
}

/// [`super::configure`] plus `endpoint`, MinIO's region and path-style addressing.
pub fn configure(builder: Builder, endpoint: &str) -> Builder {
    super::configure_endpoint(builder, endpoint, REGION)
}
