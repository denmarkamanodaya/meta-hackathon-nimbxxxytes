//! Fakes for Memory Lane: session rows in memory and a scripted Spark writer. Calls are recorded
//! so tests can assert what was asked.

use std::collections::VecDeque;
use std::sync::Mutex;

use nimbytes_core::domain::ids::{MemoryId, UserId};
use nimbytes_core::domain::memory::{LineCheck, Memory, WriteAnswer};
use nimbytes_core::ports::{MemoryRequest, MemoryStore, MemoryWriter, PortResult};
use nimbytes_core::{AppError, ErrorCode};

/// [`MemoryStore`] over a vector.
#[derive(Debug, Default)]
pub struct InMemoryMemories {
    rows: Mutex<Vec<Memory>>,
}

impl InMemoryMemories {
    /// The stored session.
    pub fn memory(&self, id: &str) -> Option<Memory> {
        crate::lock(&self.rows)
            .iter()
            .find(|m| m.id.as_str() == id)
            .cloned()
    }

    /// Puts a session in place, as an earlier run would have.
    pub fn put(&self, memory: Memory) {
        crate::lock(&self.rows).push(memory);
    }
}

impl MemoryStore for InMemoryMemories {
    fn create<'a>(&'a self, memory: &'a Memory) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.rows).push(memory.clone());
            Ok(())
        })
    }

    fn get<'a>(&'a self, id: &'a MemoryId) -> PortResult<'a, Option<Memory>> {
        Box::pin(async move { Ok(self.memory(id.as_str())) })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Memory>> {
        Box::pin(async move {
            let mut mine: Vec<Memory> = crate::lock(&self.rows)
                .iter()
                .filter(|m| &m.user_id == user)
                .cloned()
                .collect();
            mine.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
            Ok(mine)
        })
    }

    fn save<'a>(&'a self, memory: &'a Memory) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            if let Some(row) = rows.iter_mut().find(|m| m.id == memory.id) {
                *row = memory.clone();
            }
            Ok(())
        })
    }

    fn delete<'a>(&'a self, id: &'a MemoryId) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.rows).retain(|m| &m.id != id);
            Ok(())
        })
    }
}

/// One call the writer saw.
#[derive(Debug, Clone, PartialEq)]
pub struct SeenMemoryCall {
    /// `write` or `check`.
    pub call: &'static str,
    /// The moments' lines (empty before the write).
    pub lines: Vec<String>,
    /// The viewer named.
    pub viewer: Option<String>,
    /// Names of the faces sent.
    pub faces: Vec<String>,
    /// How many frames were sent.
    pub frames: usize,
}

/// [`MemoryWriter`] answering queued drafts and verdicts in order; `MODEL_UNAVAILABLE` when its
/// queue is empty.
#[derive(Debug, Default)]
pub struct ScriptedMemoryWriter {
    writes: Mutex<VecDeque<WriteAnswer>>,
    checks: Mutex<VecDeque<Vec<LineCheck>>>,
    seen: Mutex<Vec<SeenMemoryCall>>,
}

impl ScriptedMemoryWriter {
    /// Queues one write answer.
    pub fn writes(&self, answer: WriteAnswer) {
        crate::lock(&self.writes).push_back(answer);
    }

    /// Queues one check answer.
    pub fn checks(&self, answer: Vec<LineCheck>) {
        crate::lock(&self.checks).push_back(answer);
    }

    /// Every call so far.
    pub fn seen(&self) -> Vec<SeenMemoryCall> {
        crate::lock(&self.seen).clone()
    }

    fn record(&self, call: &'static str, r: MemoryRequest<'_>) {
        crate::lock(&self.seen).push(SeenMemoryCall {
            call,
            lines: r.moments.iter().map(|m| m.line.clone()).collect(),
            viewer: r.viewer.map(str::to_owned),
            faces: r.faces.iter().map(|f| f.name.clone()).collect(),
            frames: r.frames.len(),
        });
    }
}

fn unscripted(call: &str) -> AppError {
    AppError::new(ErrorCode::ModelUnavailable, format!("no {call} scripted"))
}

impl MemoryWriter for ScriptedMemoryWriter {
    fn write<'a>(&'a self, request: MemoryRequest<'a>) -> PortResult<'a, WriteAnswer> {
        Box::pin(async move {
            self.record("write", request);
            crate::lock(&self.writes)
                .pop_front()
                .ok_or_else(|| unscripted("write"))
        })
    }

    fn check<'a>(&'a self, request: MemoryRequest<'a>) -> PortResult<'a, Vec<LineCheck>> {
        Box::pin(async move {
            self.record("check", request);
            crate::lock(&self.checks)
                .pop_front()
                .ok_or_else(|| unscripted("check"))
        })
    }
}
