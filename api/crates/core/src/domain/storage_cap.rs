//! The storage cap per account: whether a write still fits, and how full the account is.
//!
//! The bucket itself has no size limit, so the API enforces the cap. Usage is measured by summing
//! every object under the account's key prefix (originals, proxies, thumbnails, face crops,
//! renders, exports, covers, key art, brand files). Between measurements, uploads that may not
//! be in the measurement yet are held as reservations.

use crate::domain::export::COVERS_PER_BATCH;
use crate::error::{AppError, ErrorCode};
use crate::ports::EpochMillis;

/// Bytes in one GB as the cap is written (decimal, as storage is billed).
pub const BYTES_PER_GB: u64 = 1_000_000_000;

/// Percent of an original reserved on top of its size for the files ingest derives from it
/// (720p and 1 fps proxies, audio, per-moment snippets and thumbnails, face crops).
pub const DERIVED_ALLOWANCE_PERCENT: u64 = 25;

/// An open upload stops counting as a reservation after this long: it was abandoned, and its
/// parts never show up in a measurement.
pub const RESERVATION_TTL_MS: i64 = 24 * 60 * 60 * 1000;

/// Size estimate of one rendered video (a preview or final render, or a 9:16 export).
pub const RENDER_ESTIMATE_BYTES: u64 = 150_000_000;

/// Size estimate of one generated image (a cover or key art).
pub const IMAGE_ESTIMATE_BYTES: u64 = 2_000_000;

/// Size estimate of `n` generated images.
pub fn images_estimate(n: usize) -> u64 {
    IMAGE_ESTIMATE_BYTES.saturating_mul(n as u64)
}

/// Size estimate of exports to `platforms` platforms: the one shared render plus a batch of
/// covers each.
pub fn export_estimate(platforms: usize) -> u64 {
    let covers = images_estimate(platforms).saturating_mul(u64::from(COVERS_PER_BATCH));
    RENDER_ESTIMATE_BYTES.saturating_add(covers)
}

/// The most one account may store, in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageCap {
    /// The cap in bytes.
    pub bytes: u64,
}

impl StorageCap {
    /// The cap of `gb` decimal gigabytes.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` for 0 or a value too large to count in bytes.
    pub fn from_gb(gb: u64) -> Result<Self, AppError> {
        match gb.checked_mul(BYTES_PER_GB) {
            Some(bytes) if bytes > 0 => Ok(Self { bytes }),
            _ => Err(AppError::new(
                ErrorCode::ValidationFailed,
                "account_cap_gb must be a positive number of GB",
            )),
        }
    }
}

/// How full an account is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageLevel {
    /// Below 80%.
    Ok,
    /// 80% or more.
    Warn,
    /// 95% or more.
    High,
    /// No room left.
    Full,
}

/// Whether `used` is at least `percent` of `cap` (exact integer maths).
fn at_least(used: u64, cap: StorageCap, percent: u64) -> bool {
    u128::from(used) * 100 >= u128::from(cap.bytes) * u128::from(percent)
}

/// The level of an account storing `used` bytes under `cap`.
pub fn storage_level(used: u64, cap: StorageCap) -> StorageLevel {
    if used >= cap.bytes {
        StorageLevel::Full
    } else if at_least(used, cap, 95) {
        StorageLevel::High
    } else if at_least(used, cap, 80) {
        StorageLevel::Warn
    } else {
        StorageLevel::Ok
    }
}

/// An upload row as the cap sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingUpload {
    /// Declared size of the original.
    pub size_bytes: u64,
    /// When the upload started.
    pub created_at: EpochMillis,
    /// Still open (not completed).
    pub open: bool,
}

/// What an upload of `size_bytes` holds while it may be missing from the measurement: the
/// original plus [`DERIVED_ALLOWANCE_PERCENT`] for the files made from it.
pub fn upload_reservation(size_bytes: u64) -> u64 {
    size_bytes.saturating_add(size_bytes / 100 * DERIVED_ALLOWANCE_PERCENT)
}

/// Bytes reserved at `now` by `uploads` against a measurement taken at `measured_at`:
/// - an open upload counts until [`RESERVATION_TTL_MS`] after it started (completing it or
///   removing its clip releases it);
/// - a completed upload counts when it started at or after the measurement, which therefore
///   cannot hold it yet.
pub fn reserved_bytes(
    uploads: &[PendingUpload],
    measured_at: EpochMillis,
    now: EpochMillis,
) -> u64 {
    uploads
        .iter()
        .filter(|u| {
            if u.open {
                now - u.created_at < RESERVATION_TTL_MS
            } else {
                u.created_at >= measured_at
            }
        })
        .fold(0u64, |sum, u| {
            sum.saturating_add(upload_reservation(u.size_bytes))
        })
}

/// Whether `incoming` more bytes fit: measured plus reserved plus incoming must not pass the cap.
/// Exactly at the cap still fits.
pub fn has_room(measured: u64, reserved: u64, incoming: u64, cap: StorageCap) -> bool {
    measured.saturating_add(reserved).saturating_add(incoming) <= cap.bytes
}

#[cfg(test)]
mod tests;
