//! The productions module: owns the background tokio tasks that plan productions and check their
//! coverage. At most one run per production is in flight; status lives in the production row and
//! progress goes out through [`BroadcastProgress`]. Productions run outside the `jobs` table.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ProductionId, UserId};
use nimbytes_core::ports::{ImageMaker, ProductionStore, StudioPlanner};
use nimbytes_core::usecases::productions::{
    StudioDeps, check_coverage, fail_interrupted, plan_production, resume_plan,
};

use crate::progress::BroadcastProgress;
use crate::state::Ports;

/// The studio ports plus the shared request ports, and the runs in flight.
pub struct Studio {
    /// Shared request ports (blobs, search, clock, ids, scratch).
    pub ports: Arc<Ports>,
    /// Productions and shots.
    pub store: Arc<dyn ProductionStore>,
    /// Shot lists and coverage verdicts.
    pub planner: Arc<dyn StudioPlanner>,
    /// Storyboard frames.
    pub images: Arc<dyn ImageMaker>,
    /// Live steps for `/events`.
    pub progress: Arc<BroadcastProgress>,
    inflight: Mutex<HashSet<ProductionId>>,
}

/// Releases a production's in-flight mark when its run ends, even by a panic.
struct Claim {
    studio: Arc<Studio>,
    id: ProductionId,
}

impl Drop for Claim {
    fn drop(&mut self) {
        self.studio.release(&self.id);
    }
}

/// What a run does once claimed.
#[derive(Clone, Copy)]
enum Run {
    Plan,
    Coverage,
}

impl Studio {
    /// A studio with nothing in flight.
    pub fn new(
        ports: Arc<Ports>,
        progress: Arc<BroadcastProgress>,
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
            inflight: Mutex::new(HashSet::new()),
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
        }
    }

    /// Whether a run of `id` is in flight.
    pub fn is_busy(&self, id: &ProductionId) -> bool {
        self.inflight.lock().is_ok_and(|set| set.contains(id))
    }

    fn claim(self: &Arc<Self>, id: &ProductionId) -> Option<Claim> {
        let mut set = self.inflight.lock().ok()?;
        set.insert(id.clone()).then(|| Claim {
            studio: self.clone(),
            id: id.clone(),
        })
    }

    fn release(&self, id: &ProductionId) {
        if let Ok(mut set) = self.inflight.lock() {
            set.remove(id);
        }
    }

    fn spawn(claim: Claim, run: Run) {
        tokio::spawn(async move {
            let deps = claim.studio.deps();
            let outcome = match run {
                Run::Plan => plan_production(&deps, &claim.id).await,
                Run::Coverage => check_coverage(&deps, &claim.id).await,
            };
            if let Err(err) = outcome {
                tracing::error!(production = %claim.id, code = ?err.code, message = %err.message, "production run failed");
            }
        });
    }

    /// Starts the plan of `id` in the background; `false` when a run is already in flight.
    pub fn start_plan(self: &Arc<Self>, id: &ProductionId) -> bool {
        self.claim(id)
            .map(|claim| Self::spawn(claim, Run::Plan))
            .is_some()
    }

    /// Starts a coverage check of `id` in the background; `false` when a run is in flight.
    pub fn start_coverage(self: &Arc<Self>, id: &ProductionId) -> bool {
        self.claim(id)
            .map(|claim| Self::spawn(claim, Run::Coverage))
            .is_some()
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
        let Some(claim) = self.claim(id) else {
            return Ok(false);
        };
        resume_plan(&self.deps(), user, id).await?;
        Self::spawn(claim, Run::Plan);
        Ok(true)
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
