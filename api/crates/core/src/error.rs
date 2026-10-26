//! The one application error type and the one list of error codes. Carries no HTTP status; the
//! server maps codes to statuses. `nimbytes_contracts` re-exports [`ErrorCode`] for the wire.

use serde::{Deserialize, Serialize};

/// Stable error identifier; serialised as `UPPER_SNAKE` on the wire and in logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// The requested clip, short or other record does not exist.
    NotFound,
    /// The record exists but belongs to another user.
    Forbidden,
    /// No valid session cookie.
    Unauthorized,
    /// The request body or a parameter failed validation.
    ValidationFailed,
    /// A multipart upload was completed with missing or mismatched parts.
    UploadIncomplete,
    /// A Meta model call failed after its retries.
    ModelUnavailable,
    /// ffmpeg or ffprobe failed on the input media.
    MediaFailed,
    /// The final render of a short failed.
    RenderFailed,
    /// Anything unexpected; details stay in the server log.
    Internal,
}

impl ErrorCode {
    /// Every code, in declaration order. A new variant breaks the exhaustive match in this
    /// file's tests until it is added here too, so wire sync checks always see the full list.
    pub const ALL: [Self; 9] = [
        Self::NotFound,
        Self::Forbidden,
        Self::Unauthorized,
        Self::ValidationFailed,
        Self::UploadIncomplete,
        Self::ModelUnavailable,
        Self::MediaFailed,
        Self::RenderFailed,
        Self::Internal,
    ];
}

/// Typed failure returned by ports and use cases: a stable [`ErrorCode`] plus a human message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct AppError {
    /// Stable identifier callers switch on.
    pub code: ErrorCode,
    /// Human-readable detail; never shown as a stack trace.
    pub message: String,
}

impl AppError {
    /// Builds an error from a code and any message text.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_lists_every_variant_once_in_declaration_order() {
        // No wildcard arm: a new variant fails to compile here until it gets an index and a
        // place in ErrorCode::ALL.
        fn index(code: ErrorCode) -> usize {
            match code {
                ErrorCode::NotFound => 0,
                ErrorCode::Forbidden => 1,
                ErrorCode::Unauthorized => 2,
                ErrorCode::ValidationFailed => 3,
                ErrorCode::UploadIncomplete => 4,
                ErrorCode::ModelUnavailable => 5,
                ErrorCode::MediaFailed => 6,
                ErrorCode::RenderFailed => 7,
                ErrorCode::Internal => 8,
            }
        }
        assert_eq!(ErrorCode::ALL.len(), index(ErrorCode::Internal) + 1);
        for (i, code) in ErrorCode::ALL.into_iter().enumerate() {
            assert_eq!(index(code), i, "{code:?}");
        }
    }

    #[test]
    fn every_code_serialises_as_upper_snake() {
        let cases = [
            (ErrorCode::NotFound, "\"NOT_FOUND\""),
            (ErrorCode::Forbidden, "\"FORBIDDEN\""),
            (ErrorCode::Unauthorized, "\"UNAUTHORIZED\""),
            (ErrorCode::ValidationFailed, "\"VALIDATION_FAILED\""),
            (ErrorCode::UploadIncomplete, "\"UPLOAD_INCOMPLETE\""),
            (ErrorCode::ModelUnavailable, "\"MODEL_UNAVAILABLE\""),
            (ErrorCode::MediaFailed, "\"MEDIA_FAILED\""),
            (ErrorCode::RenderFailed, "\"RENDER_FAILED\""),
            (ErrorCode::Internal, "\"INTERNAL\""),
        ];
        for (code, wire) in cases {
            assert_eq!(serde_json::to_string(&code).unwrap(), wire);
            assert_eq!(serde_json::from_str::<ErrorCode>(wire).unwrap(), code);
        }
    }

    #[test]
    fn new_keeps_code_and_message() {
        let err = AppError::new(ErrorCode::Forbidden, "not your clip");
        assert_eq!(err.code, ErrorCode::Forbidden);
        assert_eq!(err.message, "not your clip");
        assert_eq!(err.to_string(), "Forbidden: not your clip");
    }
}
