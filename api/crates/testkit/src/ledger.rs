//! In-memory model ledger.

use std::sync::Mutex;

use nimbytes_core::domain::cost::{ModelCall, ModelSpend};
use nimbytes_core::ports::{CacheEntry, ModelLedger, PortResult};

/// [`ModelLedger`] in memory: cache entries and call rows.
#[derive(Debug, Default)]
pub struct InMemoryLedger {
    cache: Mutex<Vec<(String, String)>>,
    calls: Mutex<Vec<ModelCall>>,
}

impl InMemoryLedger {
    /// Calls recorded so far.
    pub fn calls(&self) -> Vec<ModelCall> {
        crate::lock(&self.calls).clone()
    }
}

impl ModelLedger for InMemoryLedger {
    fn cached<'a>(&'a self, input_hash: &'a str) -> PortResult<'a, Option<String>> {
        Box::pin(async move {
            Ok(crate::lock(&self.cache)
                .iter()
                .find(|(h, _)| h == input_hash)
                .map(|(_, r)| r.clone()))
        })
    }

    fn store<'a>(&'a self, entry: CacheEntry<'a>) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.cache).push((entry.input_hash.to_owned(), entry.response.to_owned()));
            Ok(())
        })
    }

    fn record<'a>(&'a self, call: &'a ModelCall) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.calls).push(call.clone());
            Ok(())
        })
    }

    fn spend(&self) -> PortResult<'_, Vec<ModelSpend>> {
        Box::pin(async move {
            let mut out: Vec<ModelSpend> = Vec::new();
            for c in crate::lock(&self.calls).iter() {
                match out.iter_mut().find(|m| m.model == c.model) {
                    Some(m) => {
                        m.calls += 1;
                        m.cost_usd += c.cost_usd;
                    }
                    None => out.push(ModelSpend {
                        model: c.model.clone(),
                        calls: 1,
                        cost_usd: c.cost_usd,
                    }),
                }
            }
            out.sort_by(|a, b| b.cost_usd.total_cmp(&a.cost_usd));
            Ok(out)
        })
    }
}
