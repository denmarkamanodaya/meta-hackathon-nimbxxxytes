//! [`Clock`] backed by the operating system wall clock.

use std::time::{SystemTime, UNIX_EPOCH};

use nimbytes_core::ports::{Clock, EpochMillis};

/// Reads the system wall clock (UTC).
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_millis(&self) -> EpochMillis {
        // A clock set before 1970 reads as the epoch rather than failing; ordering stays monotone
        // enough for log and row timestamps.
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_time_after_2026() {
        // 2026-01-01T00:00:00Z
        assert!(SystemClock.now_millis() > 1_767_225_600_000);
    }
}
