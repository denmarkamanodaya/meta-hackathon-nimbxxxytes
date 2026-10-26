//! Demo sign-in: one shared passcode unlocks the single demo account.

use crate::domain::ids::UserId;
use crate::error::{AppError, ErrorCode};
use crate::ports::{Catalogue, Clock, IdGenerator};
use crate::time::format_utc;

/// Ports and config the sign-in needs.
pub struct SessionDeps<'a> {
    /// Holds the demo user row.
    pub catalogue: &'a dyn Catalogue,
    /// Id for the demo user on first sign-in.
    pub ids: &'a dyn IdGenerator,
    /// Creation time of the demo user row.
    pub clock: &'a dyn Clock,
    /// The configured demo passcode (never empty; checked at start-up).
    pub passcode: &'a str,
}

/// Checks the passcode and returns the demo account's id.
///
/// # Errors
/// `UNAUTHORIZED` for a wrong passcode; catalogue errors pass through.
pub async fn log_in(deps: &SessionDeps<'_>, given: &str) -> Result<UserId, AppError> {
    if deps.passcode.is_empty() || !constant_time_eq(given.as_bytes(), deps.passcode.as_bytes()) {
        return Err(AppError::new(ErrorCode::Unauthorized, "wrong passcode"));
    }
    let new_id = UserId::parse(deps.ids.new_id())?;
    let now = format_utc(deps.clock.now_millis());
    deps.catalogue.demo_user(&new_id, &now).await
}

/// Compares two byte strings in time that depends only on their lengths.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_eq_matches_plain_equality() {
        assert!(constant_time_eq(b"open sesame", b"open sesame"));
        assert!(!constant_time_eq(b"open sesame", b"open sesamE"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }
}
