//! Smart cache for originals: pinned ones stay; auto ones (fetched for an NLE export) are evicted
//! least-recently-used first while their total is above the budget.

use crate::core::state::{LocalOriginal, OriginalKind};

/// Bytes per gigabyte for the budget setting (decimal, as Finder shows sizes).
pub const BYTES_PER_GB: f64 = 1_000_000_000.0;

/// Converts the budget setting to bytes (negative or NaN = 0).
pub fn budget_bytes(gb: f64) -> u64 {
    if gb.is_finite() && gb > 0.0 {
        // Saturates at u64::MAX, which no disk reaches.
        (gb * BYTES_PER_GB) as u64
    } else {
        0
    }
}

/// Total size of the downloaded auto originals.
pub fn auto_bytes<'a>(originals: impl IntoIterator<Item = &'a LocalOriginal>) -> u64 {
    originals
        .into_iter()
        .filter(|o| o.kind == OriginalKind::Auto && o.file.is_some())
        .map(|o| o.size_bytes)
        .sum()
}

/// Clip ids whose auto originals to evict, oldest use first, so the rest fit in `budget`.
/// `keep` names clips the current export needs; they are never evicted.
pub fn evictions<'a>(
    originals: impl IntoIterator<Item = (&'a String, &'a LocalOriginal)>,
    budget: u64,
    keep: &[String],
) -> Vec<String> {
    let mut auto: Vec<(&String, &LocalOriginal)> = originals
        .into_iter()
        .filter(|(_, o)| o.kind == OriginalKind::Auto && o.file.is_some())
        .collect();
    let mut total: u64 = auto.iter().map(|(_, o)| o.size_bytes).sum();
    auto.sort_by_key(|(id, o)| (o.last_used_ms, (*id).clone()));
    let mut out = Vec::new();
    for (id, original) in auto {
        if total <= budget {
            break;
        }
        if keep.contains(id) {
            continue;
        }
        total = total.saturating_sub(original.size_bytes);
        out.push(id.clone());
    }
    out
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn original(kind: OriginalKind, size: u64, used: u64) -> LocalOriginal {
        LocalOriginal {
            file: Some("f".into()),
            size_bytes: size,
            kind,
            last_used_ms: used,
        }
    }

    #[test]
    fn the_least_recently_used_auto_originals_go_first_until_the_rest_fit() {
        let mut map = BTreeMap::new();
        map.insert("old".to_owned(), original(OriginalKind::Auto, 6, 1));
        map.insert("mid".to_owned(), original(OriginalKind::Auto, 6, 2));
        map.insert("new".to_owned(), original(OriginalKind::Auto, 6, 3));
        map.insert("pin".to_owned(), original(OriginalKind::Pinned, 100, 0));
        assert_eq!(evictions(&map, 12, &[]), vec!["old".to_owned()]);
        assert_eq!(evictions(&map, 5, &[]), vec!["old", "mid", "new"]);
        assert!(evictions(&map, 18, &[]).is_empty());
    }

    #[test]
    fn pinned_and_needed_originals_are_never_evicted() {
        let mut map = BTreeMap::new();
        map.insert("old".to_owned(), original(OriginalKind::Auto, 6, 1));
        map.insert("new".to_owned(), original(OriginalKind::Auto, 6, 3));
        map.insert("pin".to_owned(), original(OriginalKind::Pinned, 100, 0));
        assert_eq!(
            evictions(&map, 0, &["old".to_owned()]),
            vec!["new".to_owned()]
        );
        assert_eq!(auto_bytes(map.values()), 12);
    }

    #[test]
    fn the_budget_converts_from_decimal_gigabytes() {
        assert_eq!(budget_bytes(20.0), 20_000_000_000);
        assert_eq!(budget_bytes(-1.0), 0);
        assert_eq!(budget_bytes(f64::NAN), 0);
    }
}
