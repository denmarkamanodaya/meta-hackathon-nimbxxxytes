//! The owner's one choice, kept in `settings.json`: how much disk the auto-fetched originals may
//! use. Server and folder are fixed per build (`core::profile`); older files that still hold
//! `server_url` or `folder` load fine and those fields are ignored.

use serde::{Deserialize, Serialize};

/// Default budget for auto-fetched (not pinned) originals, gigabytes.
pub const DEFAULT_CACHE_BUDGET_GB: f64 = 20.0;

fn default_budget() -> f64 {
    DEFAULT_CACHE_BUDGET_GB
}

/// Saved settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Auto-original budget, gigabytes.
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
