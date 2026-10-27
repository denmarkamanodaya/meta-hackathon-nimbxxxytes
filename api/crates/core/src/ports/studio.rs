//! Production Studio: the production store, the storyboard image maker and the shot planner.

use std::path::PathBuf;

use crate::domain::ids::{ProductionId, ShotId, UserId};
use crate::domain::production::{
    Act, CoverageAnswer, CoverageMatch, Format, Production, ProductionStatus, Shot, ShotList,
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

/// Draws images with an image model.
pub trait ImageMaker: Send + Sync {
    /// Draws every request at once (the caller bounds the batch), each into its `out` file as
    /// WebP. One result per request, in order; a failed frame never fails the others.
    fn draw_boards<'a>(
        &'a self,
        requests: &'a [BoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>>;
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
}
