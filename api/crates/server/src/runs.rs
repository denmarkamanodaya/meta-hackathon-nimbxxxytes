//! Background runs in flight: at most one per subject (a production, a short's exports). A claim
//! is released when its guard drops, even when the run panics.

use std::collections::HashSet;
use std::hash::Hash;
use std::sync::{Arc, Mutex};

/// Subjects with a run in flight.
#[derive(Debug)]
pub struct Runs<K> {
    inflight: Mutex<HashSet<K>>,
}

impl<K> Default for Runs<K> {
    fn default() -> Self {
        Self {
            inflight: Mutex::new(HashSet::new()),
        }
    }
}

/// Holds one subject's claim; dropping it frees the subject.
pub struct Claim<K: Eq + Hash> {
    runs: Arc<Runs<K>>,
    key: K,
}

impl<K: Eq + Hash> Claim<K> {
    /// The claimed subject.
    pub fn key(&self) -> &K {
        &self.key
    }
}

impl<K: Eq + Hash> Drop for Claim<K> {
    fn drop(&mut self) {
        if let Ok(mut set) = self.runs.inflight.lock() {
            set.remove(&self.key);
        }
    }
}

impl<K: Eq + Hash + Clone> Runs<K> {
    /// Whether a run of `key` is in flight.
    pub fn is_busy(&self, key: &K) -> bool {
        self.inflight.lock().is_ok_and(|set| set.contains(key))
    }

    /// Claims `key`; `None` when a run of it is already in flight.
    pub fn claim(self: &Arc<Self>, key: &K) -> Option<Claim<K>> {
        let mut set = self.inflight.lock().ok()?;
        set.insert(key.clone()).then(|| Claim {
            runs: self.clone(),
            key: key.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_run_per_subject_until_its_claim_drops() {
        let runs: Arc<Runs<String>> = Arc::default();
        let a = runs.claim(&"a".to_owned()).unwrap();
        assert!(runs.claim(&"a".to_owned()).is_none());
        assert!(
            runs.claim(&"b".to_owned()).is_some(),
            "another subject runs too"
        );
        assert!(runs.is_busy(&"a".to_owned()));
        drop(a);
        assert!(!runs.is_busy(&"a".to_owned()));
        assert!(runs.claim(&"a".to_owned()).is_some());
    }
}
