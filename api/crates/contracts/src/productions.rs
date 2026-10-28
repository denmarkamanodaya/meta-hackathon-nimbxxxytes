//! `GET/POST /api/productions`, `GET/DELETE /api/productions/{id}`,
//! `GET /api/productions/{id}/events`, `POST /api/productions/{id}/coverage`,
//! `POST /api/productions/{id}/retry`, `POST /api/productions/{id}/shots/{shot_id}/board`,
//! `POST /api/productions/{id}/art` and `POST /api/productions/{id}/art/cover`. Format, act and
//! status are the core's serde types, re-exported so there is one shape.

pub use nimbytes_core::domain::job::StepStatus;
pub use nimbytes_core::domain::production::{Act, Format, ProductionStatus};
pub use nimbytes_core::domain::timeline::Aspect;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

fn yes() -> bool {
    true
}

/// A production to plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateProductionRequest {
    /// The owner's words (1-1000 characters).
    pub brief: String,
    /// `"story"` (45-90 s) or `"short"` (10-30 s).
    #[schemars(with = "String")]
    pub format: Format,
    /// `"4:5"` or `"1:1"` (9:16 versions are made at publish).
    #[schemars(with = "String")]
    pub aspect: Aspect,
    /// Wanted length, seconds, within the format's range.
    pub target_s: f64,
    /// Blur bystanders' faces in the cut (default true).
    #[serde(default = "yes")]
    pub blur_bystanders: bool,
}

/// The new production; its plan runs in the background (watch `/events`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateProductionResponse {
    /// Production id.
    pub production_id: String,
}

/// One row of `GET /api/productions`, newest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ProductionListItem {
    /// Production id.
    pub production_id: String,
    /// Title.
    pub title: String,
    /// Story or short.
    #[schemars(with = "String")]
    pub format: Format,
    /// Output frame.
    #[schemars(with = "String")]
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// `planning`, `shooting`, `cutting`, `ready`, `published` or `failed`.
    #[schemars(with = "String")]
    pub status: ProductionStatus,
    /// Shots planned.
    pub shot_count: u32,
    /// Shots a library moment covers.
    pub covered_count: u32,
    /// Titles of the shots still to film, in play order.
    pub missing_titles: Vec<String>,
    /// The first shot's storyboard frame.
    pub cover_url: Option<String>,
    /// Presigned key art (WebP); null until drawn.
    pub art_url: Option<String>,
    /// Whether key art is being drawn now.
    pub art_drawing: bool,
    /// Creation time, ISO-8601 UTC.
    pub created_at: String,
}

/// The production itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ProductionSummary {
    /// Production id.
    pub production_id: String,
    /// Title.
    pub title: String,
    /// The owner's words.
    pub brief: String,
    /// Story or short.
    #[schemars(with = "String")]
    pub format: Format,
    /// Output frame.
    #[schemars(with = "String")]
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// Blur bystanders' faces.
    pub blur_bystanders: bool,
    /// Same values as [`ProductionListItem::status`].
    #[schemars(with = "String")]
    pub status: ProductionStatus,
    /// The story short, once cut.
    pub short_id: Option<String>,
    /// Last coverage check, ISO-8601 UTC.
    pub coverage_checked_at: Option<String>,
    /// Why planning failed, or what it could not do (frames, coverage).
    pub error: Option<String>,
    /// Presigned key art (WebP); null until drawn.
    pub art_url: Option<String>,
    /// Whether key art is being drawn now.
    pub art_drawing: bool,
    /// Creation time, ISO-8601 UTC.
    pub created_at: String,
}

/// The library moment that covers a shot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShotMatch {
    /// Segment id.
    pub segment_id: String,
    /// Its clip.
    pub clip_id: String,
    /// The clip's title.
    pub clip_title: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// When the clip was recorded, ISO-8601 UTC.
    pub recorded_at: Option<String>,
    /// What the moment shows.
    pub description: String,
    /// Presigned thumbnail.
    pub thumb_url: String,
}

/// One shot of the shot list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ProductionShot {
    /// Shot id.
    pub shot_id: String,
    /// 1-based play order.
    pub ord: u32,
    /// `hook`, `story`, `payoff` or `outro`.
    #[schemars(with = "String")]
    pub act: Act,
    /// Title.
    pub title: String,
    /// One line: how to film it.
    pub direction: String,
    /// Short filming tips.
    pub tips: Vec<String>,
    /// Planned length, seconds.
    pub duration_s: f64,
    /// Presigned storyboard frame (WebP); null until drawn. The "planned" board.
    pub board_url: Option<String>,
    /// Presigned storyboard redrawn from the covering moment's frame ("from your footage");
    /// null until a moment covers the shot and it is drawn.
    pub footage_board_url: Option<String>,
    /// The covering moment; null when the shot is still to film.
    #[serde(rename = "match")]
    pub matched: Option<ShotMatch>,
    /// Why it matched, or what is missing.
    pub match_reason: Option<String>,
    /// Usable takes in the library; 0 when not covered.
    pub take_count: u32,
}

/// `GET /api/productions/{id}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ProductionDetail {
    /// The production.
    pub production: ProductionSummary,
    /// Shots in play order, grouped by act through `act`.
    pub shots: Vec<ProductionShot>,
    /// Shots a moment covers.
    pub covered_count: u32,
    /// Whether enough is covered to cut the story (3 shots or 60 %).
    pub can_cut: bool,
    /// Whether a plan or coverage run is in flight (watch `/events`).
    pub busy: bool,
}

/// `POST /api/productions/{id}/coverage` and `/retry`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StartedResponse {
    /// Whether a run started; false when one is in flight or (coverage) the last check is less
    /// than a minute old or the production is not planned yet.
    pub started: bool,
}

/// `POST /api/productions/{id}/art/cover`: the platforms whose export got the art as a new
/// `key_art` cover (a platform already at 9 covers is skipped).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ArtCoverResponse {
    /// `tiktok`, `reels`, `shorts` or `feed`.
    #[schemars(with = "Vec<String>")]
    pub platforms: Vec<nimbytes_core::domain::production::Platform>,
}

/// `POST /api/productions/{id}/cut`: the story short (the same one on every call). Watch it with
/// the existing `GET /api/shorts/{id}` and `/events`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CutResponse {
    /// Short id.
    pub short_id: String,
}

/// One shot of a story short's production, for mapping timeline clips to acts by `segment_id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ActShot {
    /// 1-based play order in the shot list.
    pub ord: u32,
    /// `hook`, `story`, `payoff` or `outro`.
    #[schemars(with = "String")]
    pub act: Act,
    /// Title.
    pub title: String,
    /// Planned length, seconds.
    pub duration_s: f64,
    /// The covering moment; null for a shot that was not filmed (it is not in the cut).
    pub segment_id: Option<String>,
}

/// `GET /api/shorts/{id}/production`: the production a story short was cut from (404 when the
/// short is not a production's story).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ShortProduction {
    /// Production id.
    pub production_id: String,
    /// Title.
    pub title: String,
    /// Same values as [`ProductionListItem::status`].
    #[schemars(with = "String")]
    pub status: ProductionStatus,
    /// Every shot in play order.
    pub shots: Vec<ActShot>,
}

/// `data` of one unnamed SSE event on `GET /api/productions/{id}/events`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProductionEvent {
    /// `planning`, `shot_list`, `boards n/m`, `coverage`, `footage_boards n/m`, or `done` (the
    /// stream then ends).
    pub step: String,
    /// `running`, `done` or `failed` (a failed step ends the stream).
    #[schemars(with = "String")]
    pub status: StepStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_create_request_defaults_blur_on_and_refuses_unknown_fields() {
        let r: CreateProductionRequest = serde_json::from_str(
            r#"{"brief":"Beach","format":"story","aspect":"4:5","target_s":60}"#,
        )
        .unwrap();
        assert!(r.blur_bystanders);
        assert_eq!(r.format, Format::Story);
        assert!(
            serde_json::from_str::<CreateProductionRequest>(
                r#"{"brief":"b","format":"story","aspect":"9:16","target_s":60}"#
            )
            .is_err(),
            "9:16 is for exports only"
        );
        assert!(
            serde_json::from_str::<CreateProductionRequest>(
                r#"{"brief":"b","format":"story","aspect":"4:5","target_s":60,"x":1}"#
            )
            .is_err()
        );
    }

    #[test]
    fn a_shot_names_its_moment_match_on_the_wire() {
        let shot = ProductionShot {
            shot_id: "s1".into(),
            ord: 1,
            act: Act::Hook,
            title: "Doors".into(),
            direction: "d".into(),
            tips: vec![],
            duration_s: 4.0,
            board_url: None,
            footage_board_url: None,
            matched: None,
            match_reason: None,
            take_count: 0,
        };
        let v = serde_json::to_value(&shot).unwrap();
        assert_eq!(v["act"], "hook");
        assert!(v.get("match").is_some_and(serde_json::Value::is_null));
    }
}
