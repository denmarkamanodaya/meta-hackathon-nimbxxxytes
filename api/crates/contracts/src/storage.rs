//! `GET /api/storage`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// What the owner stores and where. Bytes are the originals' sizes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StorageSummary {
    /// Every original in the cloud.
    pub cloud_bytes: u64,
    /// Always 0: the app keeps no media on the phone.
    pub phone_bytes: u64,
    /// Originals accessed in the last 30 days.
    pub frequent_bytes: u64,
    /// Originals not accessed for 30 days or more.
    pub resting_bytes: u64,
    /// Originals counted.
    pub clip_count: u32,
}
