//! The storage card: how much the owner keeps in the cloud, and the account's cap. Also the cap
//! check every write to the bucket goes through, and the measurement it relies on.

use crate::domain::ids::UserId;
use crate::domain::storage::{StorageSummary, summarize};
use crate::domain::storage_cap::{
    StorageCap, StorageLevel, has_room, reserved_bytes, storage_level,
};
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{BlobStore, Catalogue, Clock, MeasuredUsage, UsageStore};

/// What the cap check needs besides the blob store and clock every caller already has.
#[derive(Clone, Copy)]
pub struct Quota<'a> {
    /// Measurements and pending uploads.
    pub usage: &'a dyn UsageStore,
    /// The per-account cap.
    pub cap: StorageCap,
}

/// The store to measure with and the clock to stamp the measurement.
pub type Measure<'a> = (&'a dyn BlobStore, &'a dyn Clock);

/// Measures everything under the account's prefix now and keeps it.
///
/// # Errors
/// Store errors.
pub async fn measure_usage(
    usage: &dyn UsageStore,
    (blobs, clock): Measure<'_>,
    user: &UserId,
) -> Result<MeasuredUsage, AppError> {
    let measured_at = clock.now_millis();
    let bytes = blobs.used_bytes(&keys::user_prefix(user)).await?;
    let measured = MeasuredUsage { bytes, measured_at };
    usage.record_measured(user, measured).await?;
    Ok(measured)
}

/// Measures every account and returns how many were measured. One failing account does not stop
/// the others.
///
/// # Errors
/// The first store error, after every account was tried.
pub async fn measure_all(usage: &dyn UsageStore, measure: Measure<'_>) -> Result<usize, AppError> {
    let mut first_err = None;
    let mut done = 0;
    for user in usage.accounts().await? {
        match measure_usage(usage, measure, &user).await {
            Ok(_) => done += 1,
            Err(err) => {
                first_err.get_or_insert(err);
            }
        }
    }
    first_err.map_or(Ok(done), Err)
}

/// The account's measured bytes (measured now when it never was) and its reserved bytes.
async fn usage_now(
    quota: Quota<'_>,
    measure: Measure<'_>,
    user: &UserId,
) -> Result<(u64, u64), AppError> {
    let measured = match quota.usage.measured(user).await? {
        Some(m) => m,
        None => measure_usage(quota.usage, measure, user).await?,
    };
    let pending = quota
        .usage
        .pending_uploads(user, measured.measured_at)
        .await?;
    let now = measure.1.now_millis();
    Ok((
        measured.bytes,
        reserved_bytes(&pending, measured.measured_at, now),
    ))
}

/// Refuses a write of about `incoming` bytes that would take the account past its cap.
///
/// # Errors
/// `STORAGE_FULL` when it does not fit; store errors.
pub async fn ensure_room(
    quota: Quota<'_>,
    measure: Measure<'_>,
    user: &UserId,
    incoming: u64,
) -> Result<(), AppError> {
    let (measured, reserved) = usage_now(quota, measure, user).await?;
    if has_room(measured, reserved, incoming, quota.cap) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::StorageFull,
            "storage is full: delete duplicates or old clips to make room",
        ))
    }
}

/// The storage card: the originals' summary plus the account's usage against its cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageView {
    /// Originals.
    pub summary: StorageSummary,
    /// Everything the account stores, as last measured.
    pub used_bytes: u64,
    /// The cap.
    pub cap_bytes: u64,
    /// How full the account is, from `used_bytes` and the uploads in flight.
    pub level: StorageLevel,
}

/// The signed-in user's storage card now.
///
/// # Errors
/// Catalogue and store errors pass through.
pub async fn storage_summary(
    catalogue: &dyn Catalogue,
    quota: Quota<'_>,
    measure: Measure<'_>,
    user: &UserId,
) -> Result<StorageView, AppError> {
    let clips = catalogue.list_clips(user).await?;
    let summary = summarize(&clips, measure.1.now_millis());
    let (used_bytes, reserved) = usage_now(quota, measure, user).await?;
    Ok(StorageView {
        summary,
        used_bytes,
        cap_bytes: quota.cap.bytes,
        level: storage_level(used_bytes.saturating_add(reserved), quota.cap),
    })
}
