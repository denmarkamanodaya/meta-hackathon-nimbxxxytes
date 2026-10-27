//! The owner's one choice, kept in `settings.json`: how much disk the drive's cache may use. Server and folder are fixed per build (`core::profile`); older files that still hold
//! `server_url` or `folder` load fine and those fields are ignored.

use serde::{Deserialize, Serialize};

/// Default cap of the drive's cache, gigabytes (owner ruling 2026-10-27: 5 GB).
pub const DEFAULT_CACHE_BUDGET_GB: f64 = 5.0;

/// Bytes per gigabyte for the cap setting (decimal, as Finder shows sizes).
const BYTES_PER_GB: f64 = 1_000_000_000.0;

/// The cap in bytes (negative or NaN = 0).
pub fn cap_bytes(gb: f64) -> u64 {
    if gb.is_finite() && gb > 0.0 {
        // Saturates at u64::MAX, which no disk reaches.
        (gb * BYTES_PER_GB) as u64
    } else {
        0
    }
}

fn default_budget() -> f64 {
    DEFAULT_CACHE_BUDGET_GB
}

/// Saved settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Cap of the drive's cache, gigabytes.
    #[serde(default = "default_budget")]
    pub cache_budget_gb: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            cache_budget_gb: DEFAULT_CACHE_BUDGET_GB,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cap_converts_to_decimal_bytes() {
        assert_eq!(cap_bytes(5.0), 5_000_000_000);
        assert_eq!(cap_bytes(-1.0), 0);
        assert_eq!(cap_bytes(f64::NAN), 0);
    }

    #[test]
    fn a_saved_server_or_folder_from_an_older_file_is_ignored() {
        let old = r#"{"server_url":"https://localhost","folder":"/x","cache_budget_gb":5.0}"#;
        let settings: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(
            settings,
            Settings {
                cache_budget_gb: 5.0
            }
        );
        assert_eq!(
            serde_json::to_string(&settings).unwrap(),
            r#"{"cache_budget_gb":5.0}"#
        );
    }
}
