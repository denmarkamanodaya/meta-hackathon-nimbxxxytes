//! Typed ids. Every id is validated on entry, so an id can always be used as one S3 key segment:
//! 1 to 64 characters of `[A-Za-z0-9_-]`, which rules out `/`, `..` and empty segments.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, ErrorCode};

const MAX_ID_LEN: usize = 64;

/// Returns `true` when `raw` is a safe id segment (see the module docs).
pub fn is_safe_segment(raw: &str) -> bool {
    (1..=MAX_ID_LEN).contains(&raw.len())
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

macro_rules! id_type {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            /// Validates `raw` as a safe id segment.
            ///
            /// # Errors
            /// `VALIDATION_FAILED` when `raw` is empty, longer than 64 characters or contains
            /// anything outside `[A-Za-z0-9_-]`.
            pub fn parse(raw: impl Into<String>) -> Result<Self, AppError> {
                let raw = raw.into();
                if is_safe_segment(&raw) {
                    Ok(Self(raw))
                } else {
                    Err(AppError::new(
                        ErrorCode::ValidationFailed,
                        format!("invalid {}", stringify!($name)),
                    ))
                }
            }

            /// The id as text.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = AppError;
            fn try_from(raw: String) -> Result<Self, AppError> {
                Self::parse(raw)
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> String {
                id.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(
    /// The account that owns clips, people and shorts.
    UserId
);
id_type!(
    /// One uploaded video file.
    ClipId
);
id_type!(
    /// One multipart upload of a clip (our id, not S3's upload id).
    UploadId
);
id_type!(
    /// One 5–10 s window of a clip.
    SegmentId
);
id_type!(
    /// One detected face track within a clip.
    TrackId
);
id_type!(
    /// One edited short.
    ShortId
);
id_type!(
    /// One background job row.
    JobId
);
id_type!(
    /// One named person of a user.
    PersonId
);
id_type!(
    /// One transcript turn.
    TurnId
);
id_type!(
    /// One diarized speaker within a clip.
    SpeakerId
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_uuid_text() {
        let id = ClipId::parse("0192f3a4-7b1c-7def-8000-0123456789ab").unwrap();
        assert_eq!(id.as_str(), "0192f3a4-7b1c-7def-8000-0123456789ab");
    }

    #[test]
    fn rejects_path_tricks_and_empty_ids() {
        for raw in ["", "a/b", "..", "../x", "a.b", "a b", "ü", &"x".repeat(65)] {
            let err = UserId::parse(raw).unwrap_err();
            assert_eq!(err.code, ErrorCode::ValidationFailed, "{raw:?}");
        }
    }

    #[test]
    fn deserialising_validates_too() {
        assert!(serde_json::from_str::<UploadId>(r#""ok-1""#).is_ok());
        assert!(serde_json::from_str::<UploadId>(r#""../etc""#).is_err());
    }
}
