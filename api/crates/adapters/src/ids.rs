//! [`IdGenerator`] producing UUIDv7 text ids: every table id is UUIDv7 text so rows sort by
//! creation time.

use nimbytes_core::ports::IdGenerator;
use uuid::Uuid;

/// Generates time-ordered UUIDv7 ids as lowercase hyphenated text.
#[derive(Debug, Default, Clone, Copy)]
pub struct UuidV7Ids;

impl IdGenerator for UuidV7Ids {
    fn new_id(&self) -> String {
        Uuid::now_v7().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_version_7_and_sort_in_creation_order() {
        let ids = UuidV7Ids;
        let first = ids.new_id();
        let second = ids.new_id();
        assert_eq!(Uuid::parse_str(&first).unwrap().get_version_num(), 7);
        assert!(first < second);
    }
}
