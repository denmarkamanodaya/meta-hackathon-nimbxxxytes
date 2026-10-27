//! The one error type of the Mac app. Codes are `UPPER_SNAKE` and live in [`ErrorCode`] only;
//! the web layer receives them as `{ code, message }` from every failing command.

use serde::Serialize;

/// Stable codes callers switch on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// No server URL saved yet (first run).
    ServerNotSet,
    /// The server URL is not https (or http on localhost in a dev build).
    BadServerUrl,
    /// An API path outside `/api/`.
    BadPath,
    /// No session in the Keychain, or the server answered 401.
    NotSignedIn,
    /// The server or S3 could not be reached, or the connection dropped.
    Network,
    /// The server answered a status the caller cannot use.
    BadStatus,
    /// A body that does not parse as the agreed shape.
    BadResponse,
    /// The Keychain refused a read or write.
    Keychain,
    /// A file operation failed.
    Io,
    /// A presigned URL expired (S3 answered 403); ask for a fresh one.
    UrlExpired,
    /// A downloaded file is not the size the server announced.
    SizeMismatch,
    /// The asked-for clip, short or file is unknown.
    NotFound,
    /// A stream id that is not running.
    UnknownStream,
    /// The owner cancelled the upload.
    Cancelled,
}

/// Typed failure: a code plus a human message (the message may change, the code may not).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct DesktopError {
    /// What went wrong.
    pub code: ErrorCode,
    /// Detail for logs and the UI.
    pub message: String,
}

impl DesktopError {
    /// Builds an error.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Result alias used across the app.
pub type DesktopResult<T> = Result<T, DesktopError>;
