//! The owner's choices, kept in `settings.json`: which server, where the folder lives, and how
//! much disk the auto-fetched originals may use.

use serde::{Deserialize, Serialize};

/// Default budget for auto-fetched (not pinned) originals, gigabytes.
pub const DEFAULT_CACHE_BUDGET_GB: f64 = 20.0;

fn default_budget() -> f64 {
    DEFAULT_CACHE_BUDGET_GB
}

/// Saved settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// `scheme://host[:port]`, `None` until the first-run screen saved one.
    #[serde(default)]
    pub server_url: Option<String>,
    /// Absolute sync folder; `None` = `~/nimbytes`.
    #[serde(default)]
    pub folder: Option<String>,
    /// Auto-original budget, gigabytes.
    #[serde(default = "default_budget")]
    pub cache_budget_gb: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            server_url: None,
            folder: None,
            cache_budget_gb: DEFAULT_CACHE_BUDGET_GB,
        }
    }
}
