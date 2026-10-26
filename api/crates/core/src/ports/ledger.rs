//! Model call cache and cost log.

use crate::domain::cost::{ModelCall, ModelSpend};
use crate::ports::PortResult;

/// A response to cache under its request hash.
#[derive(Debug, Clone, Copy)]
pub struct CacheEntry<'a> {
    /// Request hash (cache key).
    pub input_hash: &'a str,
    /// Model id.
    pub model: &'a str,
    /// Raw response body.
    pub response: &'a str,
    /// Creation time (ISO-8601 UTC).
    pub created_at: &'a str,
}

/// Stores model responses by request hash (replayable demo, no duplicate spend) and one cost row
/// per call.
pub trait ModelLedger: Send + Sync {
    /// The cached response body for `input_hash`, if any.
    fn cached<'a>(&'a self, input_hash: &'a str) -> PortResult<'a, Option<String>>;

    /// Caches a successful response body.
    fn store<'a>(&'a self, entry: CacheEntry<'a>) -> PortResult<'a, ()>;

    /// Appends one call row.
    fn record<'a>(&'a self, call: &'a ModelCall) -> PortResult<'a, ()>;

    /// Calls and spend per model, most expensive first.
    fn spend(&self) -> PortResult<'_, Vec<ModelSpend>>;

    /// Dollars spent by calls made at or after `since` (ISO-8601 UTC).
    fn cost_since<'a>(&'a self, since: &'a str) -> PortResult<'a, f64>;
}
