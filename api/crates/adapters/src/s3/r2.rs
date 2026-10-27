//! Cloudflare R2 through its S3 API: the endpoint, region and addressing R2 expects. The store is
//! the same [`super::S3BlobStore`], built with [`super::S3BlobStore::without_object_tags`] because R2
//! has no object tagging.

use aws_sdk_s3::config::{Builder, Region};
use nimbytes_core::{AppError, ErrorCode};

/// The region R2 requests are signed for.
pub const REGION: &str = "auto";

/// The account's S3 API endpoint, `https://{account_id}.r2.cloudflarestorage.com`.
///
/// # Errors
/// `VALIDATION_FAILED` unless `account_id` is 1 to 64 ASCII letters and digits, so it can never
/// change the host.
pub fn endpoint(account_id: &str) -> Result<String, AppError> {
    let valid = (1..=64).contains(&account_id.len())
        && account_id.chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "R2 account id must be 1 to 64 letters and digits",
        ));
    }
    Ok(format!("https://{account_id}.r2.cloudflarestorage.com"))
}

/// [`super::configure`] plus R2's endpoint, region and path-style addressing
/// (`{endpoint}/{bucket}/{key}`), on top of the credentials and timeouts already set.
pub fn configure(builder: Builder, endpoint: &str) -> Builder {
    super::configure(builder)
        .endpoint_url(endpoint)
        .region(Region::new(REGION))
        .force_path_style(true)
}
