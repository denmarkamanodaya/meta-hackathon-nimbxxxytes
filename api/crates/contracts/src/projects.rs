//! `/api/projects`: named, coloured groups of the owner's clips. Colours travel as text
//! (`orange`, `green`, `blue`, `purple`, `pink` or `grey`); the core's `ProjectColor` checks them.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One moment a project's key art was drawn from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ArtSource {
    /// Its clip.
    pub clip_id: String,
    /// The clip's title.
    pub clip_title: String,
    /// What the moment shows.
    pub title: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// Presigned thumbnail.
    pub thumb_url: String,
}

/// One project with totals over its clips (every project endpoint returns this shape).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Project {
    /// Project id.
    pub project_id: String,
    /// Name, trimmed, 1–60 characters.
    pub name: String,
    /// `orange`, `green`, `blue`, `purple`, `pink` or `grey`.
    pub color: String,
    /// Clips in it.
    pub clip_count: u32,
    /// Sum of the clips' known durations, seconds; 0 when none is known.
    pub duration_s: f64,
    /// Sum of the clips' original sizes, bytes.
    pub size_bytes: u64,
    /// Created, ISO-8601 UTC.
    pub created_at: String,
    /// Presigned key art (WebP, 16:9); null until drawn.
    pub art_url: Option<String>,
    /// Whether key art is being drawn now.
    pub art_drawing: bool,
    /// The moments the art was drawn from, strongest hook first.
    pub art_sources: Vec<ArtSource>,
}

/// `POST /api/projects`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateProjectRequest {
    /// Name; trimmed, 1–60 characters, unique among the owner's projects ignoring case.
    pub name: String,
    /// One of the six colours.
    pub color: String,
    /// Clips to put in it; may be left out.
    #[serde(default)]
    pub clip_ids: Vec<String>,
}

/// `PATCH /api/projects/{id}`; a field left out keeps its value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct UpdateProjectRequest {
    /// New name.
    #[serde(default)]
    pub name: Option<String>,
    /// New colour.
    #[serde(default)]
    pub color: Option<String>,
}

/// `POST /api/projects/{id}/clips`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AddProjectClipsRequest {
    /// Clips to add (at least one); clips already in the project are ignored.
    pub clip_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_project_serialises_to_the_documented_shape() {
        let p = Project {
            project_id: "p1".into(),
            name: "Tokyo".into(),
            color: "blue".into(),
            clip_count: 2,
            duration_s: 31.5,
            size_bytes: 150,
            created_at: "2026-10-28T01:02:03.000Z".into(),
            art_url: Some("https://signed/art".into()),
            art_drawing: false,
            art_sources: vec![ArtSource {
                clip_id: "c1".into(),
                clip_title: "Dog nap".into(),
                title: "A dog naps".into(),
                start_s: 3.5,
                thumb_url: "https://signed/t".into(),
            }],
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"project_id":"p1","name":"Tokyo","color":"blue","clip_count":2,"duration_s":31.5,"size_bytes":150,"created_at":"2026-10-28T01:02:03.000Z","art_url":"https://signed/art","art_drawing":false,"art_sources":[{"clip_id":"c1","clip_title":"Dog nap","title":"A dog naps","start_s":3.5,"thumb_url":"https://signed/t"}]}"#
        );
    }

    #[test]
    fn optional_request_fields_may_be_left_out() {
        let create: CreateProjectRequest =
            serde_json::from_str(r#"{"name":"A","color":"pink"}"#).unwrap();
        assert!(create.clip_ids.is_empty());
        let edit: UpdateProjectRequest = serde_json::from_str(r#"{"color":"grey"}"#).unwrap();
        assert_eq!((edit.name, edit.color.as_deref()), (None, Some("grey")));
    }
}
