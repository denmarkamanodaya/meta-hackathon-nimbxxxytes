//! `GET /api/health` response shape.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Body of `GET /api/health`: `{ "ok": true }` while the process serves requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct HealthResponse {
    /// Always `true` when the server answers.
    pub ok: bool,
}
