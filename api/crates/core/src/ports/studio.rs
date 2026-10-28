//! Production Studio: the production store, the storyboard image maker and the shot planner.

use std::path::PathBuf;

use crate::domain::cover::CoverStyle;
use crate::domain::export::ExportAspect;
use crate::domain::ids::{ProductionId, SegmentId, ShortId, ShotId, UserId};
use crate::domain::production::{
    Act, CoverageAnswer, CoverageMatch, Format, Platform, Production, ProductionStatus, Shot,
    ShotList,
};
use crate::domain::search::Candidate;
use crate::domain::timeline::Aspect;
use crate::error::AppError;
use crate::keys::ObjectKey;
use crate::ports::PortResult;

/// What the owner's library holds, in a few words, so a shot list can be planned around it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct LibrarySummary {
    /// Ready clips.
    pub clips: u32,
    /// Their total length, minutes.
    pub minutes: f64,
    /// Most frequent places, most frequent first.
    pub places: Vec<String>,
    /// Named people, most seen first.
    pub people: Vec<String>,
    /// Most frequent actions, most frequent first.
    pub actions: Vec<String>,
}

/// Productions and their shot lists.
pub trait ProductionStore: Send + Sync {
    /// Stores a new production (no shots yet).
    fn create<'a>(&'a self, production: &'a Production) -> PortResult<'a, ()>;

    /// The production, if it exists.
    fn get<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, Option<Production>>;

    /// The user's productions, newest first.
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Production>>;

    /// The shots in play order.
    fn shots<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, Vec<Shot>>;

    /// Stores the shot list and its title, unless the production already has shots (they are
    /// kept). Returns whether these shots were stored.
    fn save_plan<'a>(
        &'a self,
        id: &'a ProductionId,
        title: &'a str,
        shots: &'a [Shot],
    ) -> PortResult<'a, bool>;

    /// Records a shot's storyboard frame.
    fn set_board<'a>(&'a self, shot: &'a ShotId, key: &'a ObjectKey) -> PortResult<'a, ()>;

    /// Records a shot's storyboard redrawn from the moment `segment`.
    fn set_footage_board<'a>(
        &'a self,
        shot: &'a ShotId,
        key: &'a ObjectKey,
        segment: &'a SegmentId,
    ) -> PortResult<'a, ()>;

    /// Sets the production's title.
    fn set_title<'a>(&'a self, id: &'a ProductionId, title: &'a str) -> PortResult<'a, ()>;

    /// Records the production's key art.
    fn set_art<'a>(&'a self, id: &'a ProductionId, key: &'a ObjectKey) -> PortResult<'a, ()>;

    /// Marks the automatic first key art as started; `true` only the first time.
    fn claim_auto_art<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, bool>;

    /// Records each match and the check time (an empty slice records only the time).
    fn set_coverage<'a>(
        &'a self,
        id: &'a ProductionId,
        matches: &'a [CoverageMatch],
        checked_at: &'a str,
    ) -> PortResult<'a, ()>;

    /// Sets the status and the error note (`None` clears it).
    fn set_status<'a>(
        &'a self,
        id: &'a ProductionId,
        status: ProductionStatus,
        error: Option<&'a str>,
    ) -> PortResult<'a, ()>;

    /// Links the story short and sets the status to `cutting`, unless a short is linked already.
    /// Returns whether this short was linked.
    fn set_cut<'a>(&'a self, id: &'a ProductionId, short: &'a ShortId) -> PortResult<'a, bool>;

    /// The production whose story short is `short`, if any.
    fn by_short<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<Production>>;

    /// Marks every production still `planning` as `failed` with `error`; returns how many.
    fn fail_planning<'a>(&'a self, error: &'a str) -> PortResult<'a, u64>;

    /// Removes the production and its shots. A missing one is not an error.
    fn delete<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, ()>;

    /// What the user's ready clips hold (duplicates left out).
    fn library_summary<'a>(&'a self, user: &'a UserId) -> PortResult<'a, LibrarySummary>;

    /// When the user's most recent clip became ready (ISO-8601 UTC), if any.
    fn last_ready_at<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<String>>;
}

/// One storyboard frame to draw.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardRequest {
    /// The shot's act.
    pub act: Act,
    /// The shot's title.
    pub title: String,
    /// How it is filmed.
    pub direction: String,
    /// Frame of the production.
    pub aspect: Aspect,
    /// Reference images the frame follows (brand style); empty for a plain frame.
    pub anchors: Vec<PathBuf>,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// One cover to draw.
#[derive(Debug, Clone, PartialEq)]
pub struct CoverRequest {
    /// Where it is posted.
    pub platform: Platform,
    /// Its frame.
    pub aspect: ExportAspect,
    /// Cover number on this platform (each number is a different variation).
    pub n: u32,
    /// The look asked for (never `redrawn` or `key_art`).
    pub style: CoverStyle,
    /// The post's caption, for the mood.
    pub caption: String,
    /// `#rrggbb` of the title band: the brand accent, else the video accent.
    pub accent: String,
    /// Whether the second anchor is the owner's logo.
    pub has_logo: bool,
    /// A real frame of the short first, then the logo (when `has_logo`), then style references.
    pub anchors: Vec<PathBuf>,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// One cover redrawn from another with the owner's words.
#[derive(Debug, Clone, PartialEq)]
pub struct RedrawRequest {
    /// The cover's frame.
    pub aspect: ExportAspect,
    /// The owner's words (3 to 120 characters).
    pub instruction: String,
    /// The cover to redraw first, then the real frame it was made from (when there is one).
    pub anchors: Vec<PathBuf>,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// The scene behind a cut-out cover's subject: the real frame's place without its subject.
#[derive(Debug, Clone, PartialEq)]
pub struct SceneRequest {
    /// The cover's frame.
    pub aspect: ExportAspect,
    /// The real frame the subject is cut from.
    pub frame: PathBuf,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// One storyboard frame redrawn from the footage that covers the shot.
#[derive(Debug, Clone, PartialEq)]
pub struct FootageBoardRequest {
    /// The shot's act.
    pub act: Act,
    /// The shot's title.
    pub title: String,
    /// How it is filmed.
    pub direction: String,
    /// Frame of the production.
    pub aspect: Aspect,
    /// A real frame of the covering moment.
    pub frame: PathBuf,
    /// Variation number: 0 for the automatic drawing, another for an asked-for redraw.
    pub take: u32,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// Key art for a production or project.
#[derive(Debug, Clone, PartialEq)]
pub struct ArtRequest {
    /// Shape text, for example `4:5`.
    pub shape: &'static str,
    /// The `size` asked of the model (it sets the aspect only).
    pub size: &'static str,
    /// What the collection is about (a production's title, a project's name).
    pub theme: String,
    /// `#rrggbb` touch of colour.
    pub accent: String,
    /// Up to 4 frames (or storyboards) it is drawn from.
    pub anchors: Vec<PathBuf>,
    /// Variation number: 0 for the automatic drawing, another for "New art".
    pub take: u32,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// Draws images with an image model.
pub trait ImageMaker: Send + Sync {
    /// Draws every request at once (the caller bounds the batch), each into its `out` file as
    /// WebP. One result per request, in order; a failed frame never fails the others.
    fn draw_boards<'a>(
        &'a self,
        requests: &'a [BoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>>;

    /// Draws covers like [`ImageMaker::draw_boards`] draws frames.
    fn draw_covers<'a>(
        &'a self,
        requests: &'a [CoverRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>>;

    /// Redraws one cover into its `out` file as WebP. `MODEL_UNAVAILABLE` on failure.
    fn redraw_cover<'a>(&'a self, request: &'a RedrawRequest) -> PortResult<'a, ()>;

    /// Draws the scene behind a cut-out cover into its `out` file as WebP. `MODEL_UNAVAILABLE`
    /// on failure.
    fn draw_scene<'a>(&'a self, request: &'a SceneRequest) -> PortResult<'a, ()>;

    /// Draws footage storyboards like [`ImageMaker::draw_boards`] draws frames.
    fn draw_footage_boards<'a>(
        &'a self,
        requests: &'a [FootageBoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>>;

    /// Draws key art into its `out` file as WebP. `MODEL_UNAVAILABLE` on failure.
    fn draw_art<'a>(&'a self, request: &'a ArtRequest) -> PortResult<'a, ()>;
}

/// What the platform pack is written from.
#[derive(Debug, Clone, Copy)]
pub struct PackRequest<'a> {
    /// The platforms to write for.
    pub platforms: &'a [Platform],
    /// The short's own post caption.
    pub caption: &'a str,
    /// The short's own hashtags.
    pub hashtags: &'a [String],
    /// The production brief, when the short is a production's story.
    pub brief: Option<&'a str>,
    /// What the shots show, one line each.
    pub moments: &'a [String],
}

/// One platform's caption and hashtags, as the model wrote them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackAnswer {
    /// The platform.
    pub platform: Platform,
    /// Caption (the caller fits it to the platform's limit).
    pub caption: String,
    /// Hashtags (the caller cleans them).
    pub hashtags: Vec<String>,
}

/// What the shot list is planned from.
#[derive(Debug, Clone, Copy)]
pub struct ShotListRequest<'a> {
    /// The owner's words.
    pub brief: &'a str,
    /// Story or short.
    pub format: Format,
    /// Output frame.
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// What the library holds.
    pub library: &'a LibrarySummary,
    /// Why the last answer was refused, for the one retry.
    pub rejection: Option<&'a str>,
}

/// One planner answer.
#[derive(Debug, Clone, PartialEq)]
pub enum ShotListAttempt {
    /// Valid against the schema (the domain rules are checked by the caller).
    Valid(ShotList),
    /// The answer failed the schema.
    Invalid {
        /// Why, for the retry.
        error: String,
    },
}

/// One shot and the library moments that may cover it.
#[derive(Debug, Clone, Copy)]
pub struct CoverageShot<'a> {
    /// 1-based play order (how the judge names the shot).
    pub ord: u32,
    /// Act.
    pub act: Act,
    /// Title.
    pub title: &'a str,
    /// How it is filmed.
    pub direction: &'a str,
    /// Moments to judge, best search match first.
    pub candidates: &'a [Candidate],
}

/// Plans shot lists and judges coverage with a language model.
pub trait StudioPlanner: Send + Sync {
    /// A shot list for the brief. `MODEL_UNAVAILABLE` when the call fails.
    fn shot_list<'a>(&'a self, request: &'a ShotListRequest<'a>)
    -> PortResult<'a, ShotListAttempt>;

    /// One verdict per shot, all shots in one call. `MODEL_UNAVAILABLE` on failure or an
    /// invalid answer.
    fn match_coverage<'a>(
        &'a self,
        brief: &'a str,
        shots: &'a [CoverageShot<'a>],
    ) -> PortResult<'a, Vec<CoverageAnswer>>;

    /// A caption and hashtags per platform, all platforms in one call. `MODEL_UNAVAILABLE` on
    /// failure or an invalid answer.
    fn platform_pack<'a>(&'a self, request: &'a PackRequest<'a>)
    -> PortResult<'a, Vec<PackAnswer>>;
}
