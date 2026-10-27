//! The user's settings.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `GET /api/settings` response, `PUT /api/settings` body and response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    /// Opt-in face match suggestions (off by default). Turning it off deletes the user's face
    /// vectors and match verdicts.
    pub face_matching: bool,
}
