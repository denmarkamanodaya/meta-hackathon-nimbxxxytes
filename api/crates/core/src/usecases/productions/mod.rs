//! Productions: create one from a brief, plan it (shot list, storyboards, first coverage), read
//! it with signed board and moment URLs, recheck coverage, resume a failed plan and delete one.
//! The plan and coverage runs are started in the background by the server; these functions are
//! what each run does.

mod coverage;
mod cut;
mod plan;

use crate::domain::ids::{ProductionId, UserId};
use crate::domain::job::StepStatus;
use crate::domain::production::{
    NewProduction, Production, ProductionStatus, Shot, can_cut, checked_new, coverage_allowed,
    coverage_stale, covered_count, draft_title,
};
use crate::domain::search::Candidate;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::{
    BlobStore, BrandStore, IdGenerator, ImageMaker, ProductionStore, ProgressSink, Scratch,
    StudioPlanner,
};
use crate::time::format_utc;
use crate::usecases::search::SearchDeps;
use crate::usecases::shorts::ShortDeps;

pub use coverage::check_coverage;
pub use cut::{cut_story, short_production};
pub use plan::plan_production;

/// Error note a plan interrupted by a restart is left with.
pub const INTERRUPTED: &str = "planning stopped when the server restarted; retry to resume";

/// Ports the productions use cases need.
pub struct StudioDeps<'a> {
    /// Productions and shots.
    pub store: &'a dyn ProductionStore,
    /// Shot lists and coverage verdicts.
    pub planner: &'a dyn StudioPlanner,
    /// Storyboard frames.
    pub images: &'a dyn ImageMaker,
    /// Where frames are written before upload.
    pub scratch: &'a dyn Scratch,
    /// The library search (its local stage finds coverage candidates); also the blob store,
    /// clock and URL lifetime every production use case shares.
    pub search: SearchDeps<'a>,
    /// New production and shot ids.
    pub ids: &'a dyn IdGenerator,
    /// Live steps for the production's event stream.
    pub progress: &'a dyn ProgressSink,
    /// The existing shorts (the story cut is one, made by the unchanged create-short use case).
    pub short: ShortDeps<'a>,
    /// The `## user` text of `story_brief.md`: the story short's request template.
    pub story_brief: &'a str,
    /// The owner's brand kit (storyboard anchors).
    pub brand: &'a dyn BrandStore,
}

impl StudioDeps<'_> {
    fn blobs(&self) -> &dyn BlobStore {
        self.search.blobs
    }

    fn now(&self) -> String {
        format_utc(self.search.clock.now_millis())
    }

    fn emit(&self, id: &ProductionId, step: &str, status: StepStatus) {
        self.progress.emit(id.as_str(), step, status);
    }
}

/// A shot with its signed storyboard frame and the moment that covers it.
#[derive(Debug, Clone, PartialEq)]
pub struct ShotView {
    /// The shot.
    pub shot: Shot,
    /// Signed storyboard frame.
    pub board_url: Option<String>,
    /// The covering moment with its signed thumbnail.
    pub matched: Option<(Candidate, String)>,
}

/// A production as its page shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct ProductionView {
    /// The production.
    pub production: Production,
    /// Shots in play order.
    pub shots: Vec<ShotView>,
    /// Shots a moment covers.
    pub covered: usize,
    /// Whether enough is covered to cut the story.
    pub can_cut: bool,
    /// Whether a clip became ready since the last check and a check may run now: the caller
    /// starts one in the background.
    pub recheck: bool,
}

/// One row of the productions list.
#[derive(Debug, Clone, PartialEq)]
pub struct ProductionListEntry {
    /// The production.
    pub production: Production,
    /// Shots planned.
    pub shot_count: usize,
    /// Shots a moment covers.
    pub covered: usize,
    /// Titles of the shots still to film, in play order.
    pub missing: Vec<String>,
    /// The first shot's signed storyboard frame.
    pub cover_url: Option<String>,
}

/// The production if `user` owns it.
///
/// # Errors
/// `NOT_FOUND` when it does not exist, `FORBIDDEN` when another user owns it.
pub(crate) async fn owned(
    store: &dyn ProductionStore,
    user: &UserId,
    id: &ProductionId,
) -> Result<Production, AppError> {
    let p = store
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such production"))?;
    if &p.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "production belongs to another user",
        ));
    }
    Ok(p)
}

/// The production if `user` owns it, for the first event of its stream.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` (see [`owned`]); store errors.
pub async fn watch_production(
    deps: &StudioDeps<'_>,
    user: &UserId,
    id: &ProductionId,
) -> Result<Production, AppError> {
    cut::synced(deps, owned(deps.store, user, id).await?).await
}

/// Stores a new production in `planning`; the caller starts its plan.
///
/// # Errors
/// `VALIDATION_FAILED` for a bad brief or target; store errors.
pub async fn create_production(
    deps: &StudioDeps<'_>,
    user: &UserId,
    new: NewProduction,
) -> Result<ProductionId, AppError> {
    let new = checked_new(new)?;
    let id = ProductionId::parse(deps.ids.new_id())?;
    let production = Production {
        id: id.clone(),
        user_id: user.clone(),
        title: draft_title(&new.brief),
        brief: new.brief,
        format: new.format,
        aspect: new.aspect,
        target_s: new.target_s,
        blur_bystanders: new.blur_bystanders,
        status: ProductionStatus::Planning,
        short_id: None,
        coverage_checked_at: None,
        error: None,
        created_at: deps.now(),
    };
    deps.store.create(&production).await?;
    Ok(id)
}

async fn sign(deps: &StudioDeps<'_>, key: Option<&ObjectKey>) -> Result<Option<String>, AppError> {
    match key {
        Some(k) => Ok(Some(
            deps.blobs().presign_get(k, deps.search.url_ttl).await?,
        )),
        None => Ok(None),
    }
}

/// The user's productions, newest first, with coverage counts and the shots still to film.
///
/// # Errors
/// Store and signing errors.
pub async fn list_productions(
    deps: &StudioDeps<'_>,
    user: &UserId,
) -> Result<Vec<ProductionListEntry>, AppError> {
    let mut out = Vec::new();
    for production in deps.store.list(user).await? {
        let production = cut::synced(deps, production).await?;
        let shots = deps.store.shots(&production.id).await?;
        let first_board = shots.iter().find_map(|s| s.board_key.as_ref());
        out.push(ProductionListEntry {
            cover_url: sign(deps, first_board).await?,
            shot_count: shots.len(),
            covered: covered_count(&shots),
            missing: shots
                .iter()
                .filter(|s| s.matched_segment_id.is_none())
                .map(|s| s.title.clone())
                .collect(),
            production,
        });
    }
    Ok(out)
}

/// The production with signed boards and covering moments, and whether a coverage check is due.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` (see [`owned`]); store and signing errors.
pub async fn production_detail(
    deps: &StudioDeps<'_>,
    user: &UserId,
    id: &ProductionId,
) -> Result<ProductionView, AppError> {
    let production = cut::synced(deps, owned(deps.store, user, id).await?).await?;
    let shots = deps.store.shots(id).await?;
    let views = shot_views(deps, user, &shots).await?;
    let recheck = recheck_due(deps, &production, !shots.is_empty()).await?;
    let covered = covered_count(&shots);
    Ok(ProductionView {
        can_cut: can_cut(covered, shots.len()),
        covered,
        shots: views,
        production,
        recheck,
    })
}

/// Each shot with its signed frame and its covering moment's facts and signed thumbnail.
async fn shot_views(
    deps: &StudioDeps<'_>,
    user: &UserId,
    shots: &[Shot],
) -> Result<Vec<ShotView>, AppError> {
    let matched_ids: Vec<_> = shots
        .iter()
        .filter_map(|s| s.matched_segment_id.clone())
        .collect();
    let moments = deps.search.catalogue.candidates(user, &matched_ids).await?;
    let mut views = Vec::with_capacity(shots.len());
    for shot in shots {
        let moment = shot
            .matched_segment_id
            .as_ref()
            .and_then(|m| moments.iter().find(|c| &c.segment_id == m));
        let matched = match moment {
            Some(c) => {
                let thumb = keys::thumb(user, &c.clip_id, &c.segment_id);
                let url = deps
                    .blobs()
                    .presign_get(&thumb, deps.search.url_ttl)
                    .await?;
                Some((c.clone(), url))
            }
            None => None,
        };
        views.push(ShotView {
            board_url: sign(deps, shot.board_key.as_ref()).await?,
            shot: shot.clone(),
            matched,
        });
    }
    Ok(views)
}

/// A page view starts a coverage check while the owner is still shooting, a clip became ready
/// since the last check, and the last check is a minute old.
async fn recheck_due(
    deps: &StudioDeps<'_>,
    p: &Production,
    has_shots: bool,
) -> Result<bool, AppError> {
    if p.status != ProductionStatus::Shooting || !has_shots {
        return Ok(false);
    }
    let checked = p.coverage_checked_at.as_deref();
    if !coverage_allowed(checked, deps.search.clock.now_millis()) {
        return Ok(false);
    }
    let ready = deps.store.last_ready_at(&p.user_id).await?;
    Ok(coverage_stale(checked, ready.as_deref()))
}

/// Whether the owner's recheck may run now: the production is planned (not planning or failed),
/// has shots, and was not checked in the last minute. `false` means nothing is started.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub async fn coverage_requested(
    deps: &StudioDeps<'_>,
    user: &UserId,
    id: &ProductionId,
) -> Result<bool, AppError> {
    let p = owned(deps.store, user, id).await?;
    if matches!(
        p.status,
        ProductionStatus::Planning | ProductionStatus::Failed
    ) {
        return Ok(false);
    }
    let now = deps.search.clock.now_millis();
    Ok(coverage_allowed(p.coverage_checked_at.as_deref(), now)
        && !deps.store.shots(id).await?.is_empty())
}

/// Puts a production back into `planning` so its plan resumes: stored shots and frames are kept.
/// The caller makes sure no run of it is in flight, then starts the plan.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` once the story was cut; store errors.
pub async fn resume_plan(
    deps: &StudioDeps<'_>,
    user: &UserId,
    id: &ProductionId,
) -> Result<(), AppError> {
    let p = cut::synced(deps, owned(deps.store, user, id).await?).await?;
    if !matches!(
        p.status,
        ProductionStatus::Planning | ProductionStatus::Shooting | ProductionStatus::Failed
    ) {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "the story was already cut",
        ));
    }
    deps.store
        .set_status(id, ProductionStatus::Planning, None)
        .await
}

/// Deletes the production, its shots and every storyboard frame.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; storage and store errors.
pub async fn delete_production(
    deps: &StudioDeps<'_>,
    user: &UserId,
    id: &ProductionId,
) -> Result<(), AppError> {
    owned(deps.store, user, id).await?;
    let shots: Vec<_> = deps
        .store
        .shots(id)
        .await?
        .into_iter()
        .map(|s| s.id)
        .collect();
    deps.blobs()
        .delete(&keys::production_objects(user, id, &shots))
        .await?;
    deps.store.delete(id).await
}

/// Marks plans a restart interrupted as failed (they resume on retry); returns how many.
///
/// # Errors
/// Store errors.
pub async fn fail_interrupted(store: &dyn ProductionStore) -> Result<u64, AppError> {
    store.fail_planning(INTERRUPTED).await
}
