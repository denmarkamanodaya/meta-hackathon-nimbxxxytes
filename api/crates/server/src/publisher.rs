//! The publish module: owns the background tokio tasks that make a short's exports (platform
//! pack, covers, the shared 9:16 render) and its extra covers. At most one run per short is in
//! flight; status lives in the export rows and progress goes out through
//! [`BroadcastProgress`] under the short's id. Exports run outside the `jobs` table.

use std::sync::Arc;
use std::time::Duration;

use nimbytes_core::domain::ids::{ShortId, UserId};
use nimbytes_core::domain::production::Platform;
use nimbytes_core::ports::{ExportStore, Renderer};
use nimbytes_core::usecases::exports::{
    ExportDeps, draw_more_covers, fail_interrupted_exports, more_covers, run_exports, start_exports,
};
use nimbytes_core::{AppError, ErrorCode};

use crate::runs::Runs;
use crate::studio::Studio;

/// The export ports and the runs in flight.
pub struct Publisher {
    /// The studio (shared ports, planner, image maker, productions).
    pub studio: Arc<Studio>,
    /// Export rows.
    pub exports: Arc<dyn ExportStore>,
    /// The video renderer.
    pub renderer: Arc<dyn Renderer>,
    /// Lifetime of the URLs a render reads and writes.
    pub media_ttl: Duration,
    runs: Arc<Runs<ShortId>>,
}

fn busy() -> AppError {
    AppError::new(
        ErrorCode::ValidationFailed,
        "this short is already being published; try again when it finishes",
    )
}

impl Publisher {
    /// A publisher with nothing in flight.
    pub fn new(
        studio: Arc<Studio>,
        (exports, renderer): (Arc<dyn ExportStore>, Arc<dyn Renderer>),
        media_ttl: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            studio,
            exports,
            renderer,
            media_ttl,
            runs: Arc::default(),
        })
    }

    /// Deps for the export use cases.
    pub fn deps(&self) -> ExportDeps<'_> {
        let s = &self.studio;
        ExportDeps {
            short: s.ports.short_deps(),
            exports: self.exports.as_ref(),
            productions: s.store.as_ref(),
            planner: s.planner.as_ref(),
            images: s.images.as_ref(),
            renderer: self.renderer.as_ref(),
            progress: s.progress.as_ref(),
            media_ttl: self.media_ttl,
        }
    }

    /// Whether a run for the short is in flight.
    pub fn is_busy(&self, id: &ShortId) -> bool {
        self.runs.is_busy(id)
    }

    /// Starts `user`'s exports of the short to `platforms`; the slow part runs in the
    /// background.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` while a run is in flight; as `start_exports`.
    pub async fn publish(
        self: &Arc<Self>,
        user: &UserId,
        id: &ShortId,
        platforms: &[Platform],
    ) -> Result<(), AppError> {
        let claim = self.runs.claim(id).ok_or_else(busy)?;
        let platforms = start_exports(&self.deps(), user, id, platforms).await?;
        let me = self.clone();
        tokio::spawn(async move {
            if let Err(err) = run_exports(&me.deps(), claim.key(), &platforms).await {
                tracing::error!(short = %claim.key(), code = ?err.code, message = %err.message, "export run failed");
            }
            me.studio.ports.usage_refresh.poke();
        });
        Ok(())
    }

    /// Starts 3 more covers for one platform in the background.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` while a run is in flight or at 9 covers; as `more_covers`.
    pub async fn covers(
        self: &Arc<Self>,
        user: &UserId,
        id: &ShortId,
        platform: Platform,
    ) -> Result<(), AppError> {
        let claim = self.runs.claim(id).ok_or_else(busy)?;
        let numbers = more_covers(&self.deps(), user, id, platform).await?;
        let me = self.clone();
        tokio::spawn(async move {
            if let Err(err) = draw_more_covers(&me.deps(), (claim.key(), platform), numbers).await {
                tracing::error!(short = %claim.key(), code = ?err.code, message = %err.message, "cover run failed");
            }
            me.studio.ports.usage_refresh.poke();
        });
        Ok(())
    }

    /// Marks exports a restart interrupted as failed. Call once at start.
    pub async fn recover(&self) {
        match fail_interrupted_exports(self.exports.as_ref()).await {
            Ok(n) => tracing::info!(failed = n, "interrupted exports"),
            Err(err) => {
                tracing::error!(code = ?err.code, message = %err.message, "export recovery failed")
            }
        }
    }
}
