//! `GET /api/people`, `PUT /api/tracks/{id}`, `PUT /api/speakers/{id}`, `GET /api/costs`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One autocomplete suggestion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Person {
    /// Person id.
    pub person_id: String,
    /// Name.
    pub name: String,
}

/// Track change: only the field that changed is sent.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TrackUpdateRequest {
    /// New name (trimmed, never empty).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// New hidden flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

/// Speaker rename.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SpeakerUpdateRequest {
    /// New display name (trimmed, never empty).
    pub display_name: String,
}

/// Spend of one model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ModelCost {
    /// Model id.
    pub model: String,
    /// Calls logged.
    pub calls: u64,
    /// USD.
    pub cost_usd: f64,
}

/// `GET /api/costs`: what the AI calls cost so far.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct CostReport {
    /// Sum over models, USD.
    pub total_usd: f64,
    /// Per model, most expensive first.
    pub by_model: Vec<ModelCost>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_track_update_carries_only_the_changed_field() {
        let only_hidden: TrackUpdateRequest = serde_json::from_str(r#"{"hidden":true}"#).unwrap();
        assert_eq!(
            only_hidden,
            TrackUpdateRequest {
                name: None,
                hidden: Some(true)
            }
        );
        assert!(
            serde_json::from_str::<TrackUpdateRequest>(r#"{"nmae":"x"}"#).is_err(),
            "typos are refused"
        );
        assert_eq!(
            serde_json::to_string(&TrackUpdateRequest {
                name: Some("Sam".into()),
                hidden: None
            })
            .unwrap(),
            r#"{"name":"Sam"}"#
        );
    }
}
