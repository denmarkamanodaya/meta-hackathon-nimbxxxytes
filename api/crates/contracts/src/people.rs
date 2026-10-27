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

/// A named person on the people screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct PersonCard {
    /// Person id.
    pub person_id: String,
    /// Name.
    pub name: String,
    /// Clips with at least one visible track of this person.
    pub clip_count: u32,
    /// Presigned biggest face crop.
    pub crop_url: Option<String>,
}

/// A visible face no one has named yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct UnnamedTrack {
    /// Track id (name or hide it with `PUT /api/tracks/{id}`).
    pub track_id: String,
    /// Its clip.
    pub clip_id: String,
    /// The clip's title.
    pub clip_title: String,
    /// The clip's recording time.
    pub recorded_at: Option<String>,
    /// Seconds on screen.
    pub on_screen_s: f64,
    /// Presigned face crop.
    pub crop_url: Option<String>,
    /// Shared by unnamed faces Spark linked to each other; null for a face on its own and while
    /// face matching is off.
    pub group_id: Option<String>,
    /// The named person this face (or its group) most likely is; null while face matching is off.
    pub suggested: Option<FaceSuggestion>,
}

/// "Is this ‹name›?"
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct FaceSuggestion {
    /// The person.
    pub person_id: String,
    /// Their name.
    pub name: String,
    /// Spark's confidence, 0 to 1.
    pub similarity: f64,
}

/// `POST /api/tracks/name`: names a confirmed group in one call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NameTracksRequest {
    /// The user's tracks, 1 to 100.
    pub track_ids: Vec<String>,
    /// Name (trimmed, 1 to 60 characters).
    pub name: String,
}

/// `GET /api/people/overview`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct PeopleOverview {
    /// Named people, most clips first, then by name.
    pub people: Vec<PersonCard>,
    /// Unnamed visible faces, newest clip first.
    pub unnamed: Vec<UnnamedTrack>,
    /// Faces the owner hid, newest clip first (unhide with `PUT /api/tracks/{id}`
    /// `{"hidden": false}`).
    pub hidden: Vec<HiddenTrack>,
    /// `hidden.len()`.
    pub hidden_count: u32,
}

/// A face the owner hid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct HiddenTrack {
    /// Track id.
    pub track_id: String,
    /// Its clip.
    pub clip_id: String,
    /// The clip's title.
    pub clip_title: String,
    /// The clip's recording time.
    pub recorded_at: Option<String>,
    /// Presigned face crop.
    pub crop_url: Option<String>,
}
