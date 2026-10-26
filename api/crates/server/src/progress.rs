//! In-process [`ProgressSink`]: a broadcast channel the SSE handler subscribes to. Events are
//! fire-and-forget; with no listener, or a listener that lags, nothing blocks the worker.

use nimbytes_core::domain::job::StepStatus;
use nimbytes_core::ports::ProgressSink;
use tokio::sync::broadcast;

/// One step change of one subject (a clip for ingest jobs).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepEvent {
    /// Clip id.
    pub subject_id: String,
    /// Step name.
    pub step: String,
    /// New state.
    pub status: StepStatus,
}

/// Broadcasts step events to every subscriber.
#[derive(Debug, Clone)]
pub struct BroadcastProgress {
    tx: broadcast::Sender<StepEvent>,
}

impl BroadcastProgress {
    /// Keeps up to `capacity` events per slow subscriber before it starts skipping.
    pub fn new(capacity: usize) -> Self {
        Self {
            tx: broadcast::channel(capacity).0,
        }
    }

    /// A receiver for events published from now on.
    pub fn subscribe(&self) -> broadcast::Receiver<StepEvent> {
        self.tx.subscribe()
    }
}

impl ProgressSink for BroadcastProgress {
    fn emit(&self, subject_id: &str, step: &str, status: StepStatus) {
        // An error only means nobody is listening right now.
        let _ = self.tx.send(StepEvent {
            subject_id: subject_id.to_owned(),
            step: step.to_owned(),
            status,
        });
    }
}
