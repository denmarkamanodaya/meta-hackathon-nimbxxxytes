//! Fake of the ask box's model port.

use std::sync::Mutex;

use nimbytes_core::domain::intent::{IntentDraft, IntentRequest};
use nimbytes_core::ports::{IntentReader, PortResult};
use nimbytes_core::{AppError, ErrorCode};

/// [`IntentReader`] answering a set draft (or failing when none is set) and recording every
/// request it was sent.
#[derive(Debug, Default)]
pub struct ScriptedIntentReader {
    draft: Mutex<Option<IntentDraft>>,
    seen: Mutex<Vec<IntentRequest>>,
}

impl ScriptedIntentReader {
    /// The draft every call answers.
    pub fn answers(&self, draft: IntentDraft) {
        *crate::lock(&self.draft) = Some(draft);
    }

    /// The requests sent so far.
    pub fn calls(&self) -> Vec<IntentRequest> {
        crate::lock(&self.seen).clone()
    }
}

impl IntentReader for ScriptedIntentReader {
    fn read_intent<'a>(&'a self, request: &'a IntentRequest) -> PortResult<'a, IntentDraft> {
        Box::pin(async move {
            crate::lock(&self.seen).push(request.clone());
            crate::lock(&self.draft)
                .clone()
                .ok_or_else(|| AppError::new(ErrorCode::ModelUnavailable, "scripted failure"))
        })
    }
}
