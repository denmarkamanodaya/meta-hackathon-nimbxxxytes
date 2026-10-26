//! Driven ports the core needs from outside. Each is `Send + Sync` and speaks domain types only.

/// Wall-clock instant as milliseconds since the Unix epoch (UTC).
pub type EpochMillis = i64;

/// Source of the current time; the only way core code learns "now".
pub trait Clock: Send + Sync {
    /// Returns the current instant in milliseconds since the Unix epoch (UTC).
    fn now_millis(&self) -> EpochMillis;
}

/// Source of new unique ids (UUIDv7 text in production, so ids sort by creation time).
pub trait IdGenerator: Send + Sync {
    /// Returns a new id that sorts after every id this generator returned before.
    fn new_id(&self) -> String;
}
