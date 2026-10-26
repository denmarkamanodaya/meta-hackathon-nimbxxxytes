//! Fakes of the core ports for unit tests. Never a normal dependency of a shipping crate.

use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

use nimbytes_core::ports::{Clock, EpochMillis, IdGenerator};

/// [`Clock`] that returns a set instant until a test moves it.
#[derive(Debug, Default)]
pub struct FixedClock {
    now: AtomicI64,
}

impl FixedClock {
    /// Starts the clock at `now` milliseconds since the Unix epoch.
    pub fn at(now: EpochMillis) -> Self {
        Self {
            now: AtomicI64::new(now),
        }
    }

    /// Moves the clock forward by `millis`.
    pub fn advance(&self, millis: i64) {
        self.now.fetch_add(millis, Ordering::SeqCst);
    }
}

impl Clock for FixedClock {
    fn now_millis(&self) -> EpochMillis {
        self.now.load(Ordering::SeqCst)
    }
}

/// [`IdGenerator`] that returns `{prefix}-1`, `{prefix}-2`, … in order.
#[derive(Debug)]
pub struct SequentialIds {
    prefix: String,
    next: AtomicU64,
}

impl SequentialIds {
    /// Creates a generator whose ids start with `prefix`.
    pub fn new(prefix: impl Into<String>) -> Self {
        Self {
            prefix: prefix.into(),
            next: AtomicU64::new(1),
        }
    }
}

impl IdGenerator for SequentialIds {
    fn new_id(&self) -> String {
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        format!("{}-{n}", self.prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_clock_returns_the_set_instant_until_advanced() {
        let clock = FixedClock::at(1_000);
        assert_eq!(clock.now_millis(), 1_000);
        clock.advance(250);
        assert_eq!(clock.now_millis(), 1_250);
    }

    #[test]
    fn sequential_ids_count_up_from_one() {
        let ids = SequentialIds::new("clip");
        assert_eq!(ids.new_id(), "clip-1");
        assert_eq!(ids.new_id(), "clip-2");
    }
}
