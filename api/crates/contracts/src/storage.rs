//! `GET /api/storage`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// How full an account is: `warn` from 80% of the cap, `high` from 95%, `full` with no room
/// left.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
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

/// What the owner stores. The first five fields count originals only; `used_bytes` counts
/// everything the account keeps in the bucket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StorageSummary {
    /// Every original in the cloud.
    pub cloud_bytes: u64,
    /// Always 0: the app keeps no media on the phone.
    pub phone_bytes: u64,
    /// Originals opened in the last 30 days.
    pub frequent_bytes: u64,
    /// Originals not opened for 30 days or more.
    pub resting_bytes: u64,
    /// Originals counted.
    pub clip_count: u32,
    /// Everything under the account's prefix in the bucket (originals, proxies, thumbnails, face
    /// crops, renders, exports, storyboards, covers, brand files), as last measured.
    pub used_bytes: u64,
    /// The account's cap.
    pub cap_bytes: u64,
    /// How full the account is, counting uploads still in flight.
    pub level: StorageLevel,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_summary_serialises_to_the_documented_shape() {
        let s = StorageSummary {
            cloud_bytes: 1,
            phone_bytes: 0,
            frequent_bytes: 1,
            resting_bytes: 0,
            clip_count: 1,
            used_bytes: 7,
            cap_bytes: 250_000_000_000,
            level: StorageLevel::Warn,
        };
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"cloud_bytes":1,"phone_bytes":0,"frequent_bytes":1,"resting_bytes":0,"clip_count":1,"used_bytes":7,"cap_bytes":250000000000,"level":"warn"}"#
        );
        for (level, wire) in [
            (StorageLevel::Ok, "\"ok\""),
            (StorageLevel::Warn, "\"warn\""),
            (StorageLevel::High, "\"high\""),
            (StorageLevel::Full, "\"full\""),
        ] {
            assert_eq!(serde_json::to_string(&level).unwrap(), wire);
        }
    }
}
