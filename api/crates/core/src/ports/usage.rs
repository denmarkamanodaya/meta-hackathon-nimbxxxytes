//! Measured storage per account and the uploads that may not be in the measurement yet.

use crate::domain::ids::UserId;
use crate::domain::storage_cap::PendingUpload;
use crate::ports::{EpochMillis, PortResult};

/// One measurement of everything an account stores.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MeasuredUsage {
    /// Total bytes under the account's key prefix.
    pub bytes: u64,
    /// When it was measured.
    pub measured_at: EpochMillis,
}

/// Where measurements are kept, next to the upload rows.
pub trait UsageStore: Send + Sync {
    /// The account's latest measurement; `None` before the first one.
    fn measured<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<MeasuredUsage>>;

    /// Replaces the account's measurement.
    fn record_measured<'a>(&'a self, user: &'a UserId, usage: MeasuredUsage) -> PortResult<'a, ()>;

    /// The account's open uploads, plus its completed uploads started at or after `since`.
    fn pending_uploads<'a>(
        &'a self,
        user: &'a UserId,
        since: EpochMillis,
    ) -> PortResult<'a, Vec<PendingUpload>>;

    /// Every account.
    fn accounts(&self) -> PortResult<'_, Vec<UserId>>;
}
