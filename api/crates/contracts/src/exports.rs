//! `POST/GET /api/shorts/{id}/exports`, `PUT /api/shorts/{id}/exports/{platform}`,
//! `POST /api/shorts/{id}/exports/{platform}/covers`,
//! `POST /api/shorts/{id}/exports/{platform}/covers/{n}/redraw` and
//! `GET /api/shorts/{id}/exports/events`. Platform, export aspect, status, cover style and cover
//! title are the core's serde types, re-exported so there is one shape.

pub use nimbytes_core::domain::cover::{CoverStyle, CoverTitle, TitlePosition};
pub use nimbytes_core::domain::export::{ExportAspect, ExportStatus};
pub use nimbytes_core::domain::job::StepStatus;
pub use nimbytes_core::domain::production::Platform;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Publish a short to these platforms (`tiktok`, `reels`, `shorts`, `feed`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateExportsRequest {
    /// At least one.
    #[schemars(with = "Vec<String>")]
    pub platforms: Vec<Platform>,
}

/// One cover of an export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CoverTile {
    /// Presigned cover (WebP).
    pub url: String,
    /// `bright`, `close_detail`, `dramatic`, `illustrated`, `brand_scene` (pickable), `redrawn`
    /// (Redraw with words) or `key_art` (a production's art).
    #[schemars(with = "String")]
    pub style: CoverStyle,
    /// The owner's words, for a `redrawn` cover.
    pub instruction: Option<String>,
}

/// One platform's export.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ExportItem {
    /// `tiktok`, `reels`, `shorts` or `feed`.
    #[schemars(with = "String")]
    pub platform: Platform,
    /// `9:16` for TikTok, Reels and Shorts (one shared render); the short's own for the feed.
    #[schemars(with = "String")]
    pub aspect: ExportAspect,
    /// The version exported.
    pub version_n: u32,
    /// `queued`, `rendering`, `ready` or `failed`.
    #[schemars(with = "String")]
    pub status: ExportStatus,
    /// Presigned video, once ready.
    pub render_url: Option<String>,
    /// Caption (a title for Shorts).
    pub caption: String,
    /// The platform's limit: 2,200 characters, 100 for Shorts.
    pub caption_limit: u32,
    /// Hashtags, each with `#`.
    pub hashtags: Vec<String>,
    /// Covers in the order made (same index as `cover_pick`).
    pub covers: Vec<CoverTile>,
    /// The chosen cover's index.
    pub cover_pick: u32,
    /// The title over the chosen cover: `{text (1-32 chars), show, position: "top"|"bottom"}`.
    /// Until the owner edits it: the caption cut to 32 characters, shown at the bottom.
    #[schemars(with = "serde_json::Value")]
    pub cover_title: CoverTitle,
    /// The chosen cover as it will be published (titled when `cover_title.show`, else the plain
    /// cover); null while the titled still is being made or before any cover exists.
    pub download_cover_url: Option<String>,
    /// Last change, ISO-8601 UTC.
    pub updated_at: String,
}

/// `GET /api/shorts/{id}/exports`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ExportsResponse {
    /// One per platform asked for, TikTok, Reels, Shorts, then the feed.
    pub exports: Vec<ExportItem>,
    /// Whether a publish or cover run is in flight (watch `/exports/events`).
    pub busy: bool,
}

/// `PUT /api/shorts/{id}/exports/{platform}`: what changes; absent fields stay.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EditExportRequest {
    /// Within the platform's limit.
    #[serde(default)]
    pub caption: Option<String>,
    /// At most 8.
    #[serde(default)]
    pub hashtags: Option<Vec<String>>,
    /// Index of an existing cover.
    #[serde(default)]
    pub cover_pick: Option<u32>,
    /// The cover title; a change (or a new `cover_pick`) makes the published cover again in the
    /// background.
    #[serde(default)]
    #[schemars(with = "Option<serde_json::Value>")]
    pub cover_title: Option<CoverTitle>,
}

/// `POST /api/shorts/{id}/exports/{platform}/covers`: an optional body; with no body (or no
/// style) the 3 new covers take the three original looks.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MoreCoversRequest {
    /// A pickable style for all 3 new covers.
    #[serde(default)]
    #[schemars(with = "Option<String>")]
    pub style: Option<CoverStyle>,
}

/// `POST /api/shorts/{id}/exports/{platform}/covers/{n}/redraw`: one new cover from cover `n`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RedrawCoverRequest {
    /// What to change, 3 to 120 characters ("golden hour", "make it moodier").
    pub instruction: String,
}

/// `data` of one unnamed SSE event on `GET /api/shorts/{id}/exports/events`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ExportEvent {
    /// `exports`, `pack`, `covers`, `render`, or `done` (the stream then ends).
    pub step: String,
    /// `running`, `done` or `failed` (a failed step ends the stream).
    #[schemars(with = "String")]
    pub status: StepStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_item_carries_cover_tiles_the_title_and_the_published_cover() {
        let item = ExportItem {
            platform: Platform::Reels,
            aspect: ExportAspect::Vertical,
            version_n: 2,
            status: ExportStatus::Ready,
            render_url: None,
            caption: "Nap champion".into(),
            caption_limit: 2200,
            hashtags: vec![],
            covers: vec![CoverTile {
                url: "https://signed/c0".into(),
                style: CoverStyle::Redrawn,
                instruction: Some("golden hour".into()),
            }],
            cover_pick: 0,
            cover_title: CoverTitle {
                text: "Nap champion".into(),
                show: true,
                position: TitlePosition::Bottom,
            },
            download_cover_url: None,
            updated_at: "t".into(),
        };
        let v = serde_json::to_value(&item).unwrap();
        assert_eq!(
            v["covers"][0],
            serde_json::json!({"url": "https://signed/c0", "style": "redrawn", "instruction": "golden hour"})
        );
        assert_eq!(
            v["cover_title"],
            serde_json::json!({"text": "Nap champion", "show": true, "position": "bottom"})
        );
        assert!(v["download_cover_url"].is_null());
        assert!(v.get("cover_urls").is_none(), "replaced by covers");
    }

    #[test]
    fn cover_requests_take_an_optional_style_and_a_redraw_instruction() {
        let none: MoreCoversRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(none.style, None);
        let styled: MoreCoversRequest = serde_json::from_str(r#"{"style":"illustrated"}"#).unwrap();
        assert_eq!(styled.style, Some(CoverStyle::Illustrated));
        assert!(serde_json::from_str::<MoreCoversRequest>(r#"{"style":"neon"}"#).is_err());
        let redraw: RedrawCoverRequest =
            serde_json::from_str(r#"{"instruction":"moodier"}"#).unwrap();
        assert_eq!(redraw.instruction, "moodier");
        let edit: EditExportRequest =
            serde_json::from_str(r#"{"cover_title":{"text":"Hi","show":false,"position":"top"}}"#)
                .unwrap();
        assert_eq!(edit.cover_title.unwrap().position, TitlePosition::Top);
    }
}
