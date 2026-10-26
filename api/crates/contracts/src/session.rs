//! `POST /api/session`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Name of the signed session cookie (HttpOnly, Secure, SameSite=Lax).
pub const SESSION_COOKIE: &str = "nb_session";

/// Request body: the shared demo passcode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SessionRequest {
    /// Demo passcode.
    pub passcode: String,
}

/// Response body; the session itself travels in the [`SESSION_COOKIE`] cookie.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SessionResponse {
    /// The signed-in user's id.
    pub user_id: String,
}
