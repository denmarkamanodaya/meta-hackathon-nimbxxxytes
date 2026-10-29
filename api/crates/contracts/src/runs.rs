//! The answer of a request that starts a background run.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `202` body of a request that starts a run in the background (exports, covers, key art,
/// keep subject in frame).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StartedResponse {
    /// Whether a run started; false when one is already in flight.
    pub started: bool,
}
