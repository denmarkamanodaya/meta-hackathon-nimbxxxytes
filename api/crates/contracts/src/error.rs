//! The error envelope every non-2xx API response carries. Codes come from
//! `nimbytes_core::ErrorCode`, the one source, re-exported here for wire users.

pub use nimbytes_core::ErrorCode;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Inner object of [`ErrorEnvelope`]: `{ "code": "UPPER_SNAKE", "message": "…" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ErrorBody {
    /// Machine-readable code callers switch on (`UPPER_SNAKE`). Schema type is a plain string
    /// because `core` carries no schemars dependency.
    #[schemars(with = "String")]
    pub code: ErrorCode,
    /// Human-readable text; may change between releases.
    pub message: String,
}

/// Body of every error response: `{ "error": { "code": "…", "message": "…" } }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ErrorEnvelope {
    /// The error detail.
    pub error: ErrorBody,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The web client's copy of the codes. This test is the gate that keeps the TypeScript list
    /// and the Rust enum in sync.
    const WEB_CODES: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../web/src/services/api/error-codes.json"
    ));

    #[test]
    fn web_error_codes_match_the_rust_enum_exactly() {
        let web: Vec<String> = serde_json::from_str(WEB_CODES).unwrap();
        let rust: Vec<String> = ErrorCode::ALL
            .iter()
            .map(|c| {
                serde_json::to_value(c)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        let mut web_sorted = web.clone();
        web_sorted.sort();
        web_sorted.dedup();
        assert_eq!(
            web_sorted.len(),
            web.len(),
            "duplicate code in error-codes.json"
        );
        let mut rust_sorted = rust;
        rust_sorted.sort();
        assert_eq!(web_sorted, rust_sorted);
    }

    #[test]
    fn envelope_serialises_to_the_documented_shape() {
        let envelope = ErrorEnvelope {
            error: ErrorBody {
                code: ErrorCode::NotFound,
                message: "clip not found".into(),
            },
        };
        assert_eq!(
            serde_json::to_string(&envelope).unwrap(),
            r#"{"error":{"code":"NOT_FOUND","message":"clip not found"}}"#
        );
    }
}
