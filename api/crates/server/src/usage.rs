//! Keeps every account's storage measurement fresh: once at start, every hour, and shortly after
//! anything writes or deletes objects (a poke). Pokes that arrive while waiting collapse into one
//! measurement.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_core::ports::{BlobStore, Clock, UsageStore};
use nimbytes_core::usecases::storage::measure_all;
use tokio::sync::Notify;

/// Wakes the measurement loop.
#[derive(Debug, Default)]
pub struct UsageRefresh {
    wake: Notify,
}

impl UsageRefresh {
    /// Asks for a measurement soon; cheap and never blocks.
    pub fn poke(&self) {
        self.wake.notify_one();
    }

    /// Measures at start, then again `every` or `settle` after a poke, forever.
    pub async fn run(
        self: Arc<Self>,
        (usage, blobs, clock): (Arc<dyn UsageStore>, Arc<dyn BlobStore>, Arc<dyn Clock>),
        (every, settle): (Duration, Duration),
    ) {
        loop {
            match measure_all(usage.as_ref(), (blobs.as_ref(), clock.as_ref())).await {
                Ok(n) => tracing::info!(accounts = n, "storage measured"),
                Err(err) => {
                    tracing::error!(code = ?err.code, message = %err.message, "storage measurement failed")
                }
            }
            tokio::select! {
                () = tokio::time::sleep(every) => {}
                () = self.wake.notified() => tokio::time::sleep(settle).await,
            }
        }
    }
}
