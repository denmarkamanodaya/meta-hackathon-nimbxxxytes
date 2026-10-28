//! The productions module: owns the background tokio tasks that plan productions, check their
//! coverage, redraw a storyboard from its footage, and draw key art for productions and
//! projects. At most one plan, coverage or board run per production, and one art run per
//! production or project, is in flight; status lives in the rows and progress goes out through
//! [`BroadcastProgress`]. These runs live outside the `jobs` table. Art never fails anything: a
//! failed drawing is logged and only frees the "drawing" flag.

use std::sync::Arc;

use nimbytes_core::domain::cover::manual_take;
use nimbytes_core::domain::ids::{ProductionId, ProjectId, ShortId, ShotId, UserId};
use nimbytes_core::ports::{ImageMaker, ProductionStore, StudioPlanner};
use nimbytes_core::usecases::productions::{
    StudioDeps, art_requested, auto_art_due, check_coverage, cut_story, draw_production_art,
    fail_interrupted, footage_board_requested, plan_production, redraw_footage_board, resume_plan,
};
use nimbytes_core::usecases::project_art::{
    ProjectArtDeps, auto_project_art_due, draw_project_art, project_art_requested,
};
use nimbytes_core::{AppError, ErrorCode};

use crate::progress::BroadcastProgress;
use crate::runs::{Claim, Runs};
use crate::state::Ports;

/// The studio ports plus the shared request ports, and the runs in flight.
pub struct Studio {
    /// Shared request ports (blobs, search, clock, ids, scratch).
    pub ports: Arc<Ports>,
    /// Productions and shots.
    pub store: Arc<dyn ProductionStore>,
    /// Shot lists, coverage verdicts and platform packs.
    pub planner: Arc<dyn StudioPlanner>,
    /// Storyboard frames, covers and key art.
    pub images: Arc<dyn ImageMaker>,
    /// Live steps for `/events`.
    pub progress: Arc<BroadcastProgress>,
    /// The `## user` text of `story_brief.md`.
    pub story_brief: String,
    runs: Arc<Runs<ProductionId>>,
    production_art: Arc<Runs<ProductionId>>,
    project_art: Arc<Runs<ProjectId>>,
}

/// What a run does once claimed.
#[derive(Clone)]
enum Run {
    Plan,
    Coverage,
    FootageBoard(ShotId, u32),
}

impl Studio {
    /// A studio with nothing in flight.
    pub fn new(
        ports: Arc<Ports>,
        progress: Arc<BroadcastProgress>,
        story_brief: String,
        (store, planner, images): (
            Arc<dyn ProductionStore>,
            Arc<dyn StudioPlanner>,
            Arc<dyn ImageMaker>,
        ),
    ) -> Arc<Self> {
        Arc::new(Self {
            ports,
            store,
            planner,
            images,
            progress,
            story_brief,
            runs: Arc::default(),
            production_art: Arc::default(),
            project_art: Arc::default(),
        })
    }

    /// Deps for the productions use cases.
    pub fn deps(&self) -> StudioDeps<'_> {
        StudioDeps {
            store: self.store.as_ref(),
            planner: self.planner.as_ref(),
            images: self.images.as_ref(),
            scratch: self.ports.scratch.as_ref(),
            search: self.ports.search_deps(),
            ids: self.ports.ids.as_ref(),
            progress: self.progress.as_ref(),
            short: self.ports.short_deps(),
            story_brief: &self.story_brief,
            brand: self.ports.brand.as_ref(),
        }
    }

    /// Deps for the project art use cases.
    pub fn project_art_deps(&self) -> ProjectArtDeps<'_> {
        ProjectArtDeps {
            projects: self.ports.projects.as_ref(),
            catalogue: self.ports.catalogue.as_ref(),
            images: self.images.as_ref(),
            short: self.ports.short_deps(),
        }
    }

    /// Whether a run of `id` is in flight.
    pub fn is_busy(&self, id: &ProductionId) -> bool {
        self.runs.is_busy(id)
    }

    /// Whether production `id`'s key art is being drawn.
    pub fn art_drawing(&self, id: &ProductionId) -> bool {
        self.production_art.is_busy(id)
    }

    /// Whether project `id`'s key art is being drawn.
    pub fn project_art_drawing(&self, id: &ProjectId) -> bool {
        self.project_art.is_busy(id)
    }

    fn spawn(self: &Arc<Self>, claim: Claim<ProductionId>, run: Run) {
        let studio = self.clone();
        tokio::spawn(async move {
            let deps = studio.deps();
            let id = claim.key();
            let outcome = match &run {
                Run::Plan => plan_production(&deps, id).await,
                Run::Coverage => check_coverage(&deps, id).await,
                Run::FootageBoard(shot, take) => {
                    redraw_footage_board(&deps, (id, shot), *take).await
                }
            };
            if let Err(err) = outcome {
                tracing::error!(production = %id, code = ?err.code, message = %err.message, "production run failed");
            }
            if matches!(run, Run::Plan) {
                studio.auto_art(id).await;
            }
            studio.ports.usage_refresh.poke();
        });
    }

    /// Starts the plan of `id` in the background; `false` when a run is already in flight.
    pub fn start_plan(self: &Arc<Self>, id: &ProductionId) -> bool {
        self.runs
            .claim(id)
            .map(|claim| self.spawn(claim, Run::Plan))
            .is_some()
    }

    /// Starts a coverage check of `id` in the background; `false` when a run is in flight.
    pub fn start_coverage(self: &Arc<Self>, id: &ProductionId) -> bool {
        self.runs
            .claim(id)
            .map(|claim| self.spawn(claim, Run::Coverage))
            .is_some()
    }

    /// Redraws `user`'s shot storyboard from its footage in the background; `false` when a run
    /// of the production is in flight.
    ///
    /// # Errors
    /// As [`footage_board_requested`].
    pub async fn redraw_board(
        self: &Arc<Self>,
        user: &UserId,
        (id, shot): (&ProductionId, &ShotId),
    ) -> Result<bool, AppError> {
        footage_board_requested(&self.deps(), user, (id, shot)).await?;
        let Some(claim) = self.runs.claim(id) else {
            return Ok(false);
        };
        let take = manual_take(self.ports.clock.now_millis());
        self.spawn(claim, Run::FootageBoard(shot.clone(), take));
        Ok(true)
    }

    /// Draws `user`'s production key art again in the background; `false` when it is already
    /// being drawn.
    ///
    /// # Errors
    /// As [`art_requested`].
    pub async fn new_art(
        self: &Arc<Self>,
        user: &UserId,
        id: &ProductionId,
    ) -> Result<bool, AppError> {
        art_requested(&self.deps(), user, id).await?;
        let take = manual_take(self.ports.clock.now_millis());
        Ok(self.start_art(id, take))
    }

    /// The automatic first art, once the plan finished.
    async fn auto_art(self: &Arc<Self>, id: &ProductionId) {
        match auto_art_due(self.store.as_ref(), id).await {
            Ok(true) => {
                self.start_art(id, 0);
            }
            Ok(false) => {}
            Err(err) => {
                tracing::error!(production = %id, code = ?err.code, message = %err.message, "auto art check failed");
            }
        }
    }

    fn start_art(self: &Arc<Self>, id: &ProductionId, take: u32) -> bool {
        let Some(claim) = self.production_art.claim(id) else {
            return false;
        };
        let studio = self.clone();
        tokio::spawn(async move {
            let id = claim.key();
            if let Err(err) = draw_production_art(&studio.deps(), id, take).await {
                tracing::warn!(production = %id, code = ?err.code, message = %err.message, "key art not drawn");
            }
            studio.ports.usage_refresh.poke();
        });
        true
    }

    /// Draws `user`'s project key art again in the background; `false` when it is already being
    /// drawn.
    ///
    /// # Errors
    /// As [`project_art_requested`].
    pub async fn new_project_art(
        self: &Arc<Self>,
        user: &UserId,
        id: &ProjectId,
    ) -> Result<bool, AppError> {
        project_art_requested(&self.project_art_deps(), user, id).await?;
        let take = manual_take(self.ports.clock.now_millis());
        Ok(self.start_project_art(id, take))
    }

    /// Starts the automatic first art of project `id` when it is due (3 clips, never drawn).
    pub async fn auto_project_art(self: &Arc<Self>, id: &ProjectId) {
        match auto_project_art_due(self.ports.projects.as_ref(), id).await {
            Ok(true) => {
                self.start_project_art(id, 0);
            }
            Ok(false) => {}
            Err(err) => {
                tracing::error!(project = %id, code = ?err.code, message = %err.message, "auto art check failed");
            }
        }
    }

    fn start_project_art(self: &Arc<Self>, id: &ProjectId, take: u32) -> bool {
        let Some(claim) = self.project_art.claim(id) else {
            return false;
        };
        let studio = self.clone();
        tokio::spawn(async move {
            let id = claim.key();
            if let Err(err) = draw_project_art(&studio.project_art_deps(), id, take).await {
                tracing::warn!(project = %id, code = ?err.code, message = %err.message, "key art not drawn");
            }
            studio.ports.usage_refresh.poke();
        });
        true
    }

    /// Resumes `user`'s plan of `id` (stored shots and frames are kept); `false` when a run is
    /// already in flight.
    ///
    /// # Errors
    /// As [`resume_plan`].
    pub async fn retry(
        self: &Arc<Self>,
        user: &UserId,
        id: &ProductionId,
    ) -> Result<bool, AppError> {
        let Some(claim) = self.runs.claim(id) else {
            return Ok(false);
        };
        resume_plan(&self.deps(), user, id).await?;
        self.spawn(claim, Run::Plan);
        Ok(true)
    }

    /// Cuts `user`'s production `id` into its story short (see [`cut_story`]), never while a
    /// plan or coverage run of it is in flight.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` while a run is in flight; as [`cut_story`].
    pub async fn cut(
        self: &Arc<Self>,
        user: &UserId,
        id: &ProductionId,
    ) -> Result<ShortId, AppError> {
        let Some(_claim) = self.runs.claim(id) else {
            return Err(AppError::new(
                ErrorCode::ValidationFailed,
                "the production is still being planned or checked; try again when it finishes",
            ));
        };
        cut_story(&self.deps(), user, id).await
    }

    /// Marks plans a restart interrupted as failed, so a retry resumes them. Call once at start.
    pub async fn recover(&self) {
        match fail_interrupted(self.store.as_ref()).await {
            Ok(n) => tracing::info!(failed = n, "interrupted production plans"),
            Err(err) => {
                tracing::error!(code = ?err.code, message = %err.message, "production recovery failed")
            }
        }
    }
}
