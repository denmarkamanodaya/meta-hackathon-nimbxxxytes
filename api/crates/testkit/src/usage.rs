//! In-memory [`UsageStore`].

use std::collections::HashMap;
use std::sync::Mutex;

use nimbytes_core::domain::ids::UserId;
use nimbytes_core::domain::storage_cap::{PendingUpload, StorageCap};
use nimbytes_core::ports::{EpochMillis, MeasuredUsage, PortResult, UsageStore};

/// A cap nothing in a test reaches, for tests about something else.
pub const ROOMY_CAP: StorageCap = StorageCap { bytes: u64::MAX };

/// Measurements and upload rows in memory; tests add uploads with [`InMemoryUsage::add_upload`].
#[derive(Debug, Default)]
pub struct InMemoryUsage {
    /// Measurements per account.
    pub measured: Mutex<HashMap<UserId, MeasuredUsage>>,
    /// Upload rows per account.
    pub uploads: Mutex<Vec<(UserId, PendingUpload)>>,
    /// Accounts `accounts` lists.
    pub users: Mutex<Vec<UserId>>,
}

impl InMemoryUsage {
    /// Sets the account's measurement.
    pub fn set_measured(&self, user: &UserId, bytes: u64, measured_at: EpochMillis) {
        crate::lock(&self.measured).insert(user.clone(), MeasuredUsage { bytes, measured_at });
    }

    /// Adds an upload row of the account.
    pub fn add_upload(&self, user: &UserId, upload: PendingUpload) {
        crate::lock(&self.uploads).push((user.clone(), upload));
    }
}

impl UsageStore for InMemoryUsage {
    fn measured<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<MeasuredUsage>> {
        let got = crate::lock(&self.measured).get(user).copied();
        Box::pin(async move { Ok(got) })
    }

    fn record_measured<'a>(&'a self, user: &'a UserId, usage: MeasuredUsage) -> PortResult<'a, ()> {
        crate::lock(&self.measured).insert(user.clone(), usage);
        Box::pin(async { Ok(()) })
    }

    fn pending_uploads<'a>(
        &'a self,
        user: &'a UserId,
        since: EpochMillis,
    ) -> PortResult<'a, Vec<PendingUpload>> {
        let got: Vec<PendingUpload> = crate::lock(&self.uploads)
            .iter()
            .filter(|(u, p)| u == user && (p.open || p.created_at >= since))
            .map(|(_, p)| *p)
            .collect();
        Box::pin(async move { Ok(got) })
    }

    fn accounts(&self) -> PortResult<'_, Vec<UserId>> {
        let got = crate::lock(&self.users).clone();
        Box::pin(async move { Ok(got) })
    }
}
