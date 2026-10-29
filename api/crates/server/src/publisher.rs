//! The publish module: owns the background tokio tasks that make a short's exports (platform
//! pack, covers, the shared 9:16 render), its extra and redrawn covers, and each export's
//! published cover (the titled still). At most one export or cover run per short, and one still
//! per export, is in flight; status lives in the export rows and progress goes out through
//! [`BroadcastProgress`] under the short's id. Exports run outside the `jobs` table.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nimbytes_core::domain::cover::CoverStyle;
use nimbytes_core::domain::export::Platform;
use nimbytes_core::domain::ids::{ShortId, UserId};
use nimbytes_core::domain::job::StepStatus;
use nimbytes_core::domain::objects::CutoutBackground;
use nimbytes_core::ports::{ExportStore, ImageMaker, PackWriter, ProgressSink, Renderer};
use nimbytes_core::usecases::exports::{
    ExportDeps, ExportEdit, bake_titled_cover, bakes_due, cutout_requested, draw_cutout_cover,
    draw_more_covers, draw_redraw, edit_export, fail_interrupted_exports, more_covers,
    redraw_requested, run_exports, start_exports,
};
use nimbytes_core::usecases::subjects::{
    ReframeView, reframe_requested, reframe_short, reframe_view,
};
use nimbytes_core::{AppError, ErrorCode};

use crate::progress::BroadcastProgress;
use crate::runs::{Claim, Runs};
use crate::state::Ports;

/// Attempts at a titled still when the owner keeps changing the pick or title meanwhile.
const BAKE_ATTEMPTS: usize = 3;

/// The export ports and the runs in flight.
pub struct Publisher {
    /// Shared request ports (shorts, blobs, scratch, subjects, usage refresh).
    pub ports: Arc<Ports>,
    /// Live steps for the exports stream.
    pub progress: Arc<BroadcastProgress>,
    /// The platform pack writer.
    pub pack: Arc<dyn PackWriter>,
    /// Covers, redrawn covers and cut-out scenes.
    pub images: Arc<dyn ImageMaker>,
    /// Export rows.
    pub exports: Arc<dyn ExportStore>,
    /// The video renderer.
    pub renderer: Arc<dyn Renderer>,
    /// Lifetime of the URLs a render reads and writes.
    pub media_ttl: Duration,
    runs: Arc<Runs<ShortId>>,
    stills: Arc<Runs<(ShortId, Platform)>>,
    reframes: Arc<Runs<ShortId>>,
    failed_reframes: Mutex<HashSet<ShortId>>,
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
        (ports, progress): (Arc<Ports>, Arc<BroadcastProgress>),
        (pack, images): (Arc<dyn PackWriter>, Arc<dyn ImageMaker>),
        (exports, renderer): (Arc<dyn ExportStore>, Arc<dyn Renderer>),
        media_ttl: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            ports,
            progress,
            pack,
            images,
            exports,
            renderer,
            media_ttl,
            runs: Arc::default(),
            stills: Arc::default(),
            reframes: Arc::default(),
            failed_reframes: Mutex::default(),
        })
    }

    /// Deps for the export use cases.
    pub fn deps(&self) -> ExportDeps<'_> {
        ExportDeps {
            short: self.ports.short_deps(),
            exports: self.exports.as_ref(),
            pack: self.pack.as_ref(),
            images: self.images.as_ref(),
            renderer: self.renderer.as_ref(),
            progress: self.progress.as_ref(),
            media_ttl: self.media_ttl,
        }
    }

    /// Whether a run for the short is in flight.
    pub fn is_busy(&self, id: &ShortId) -> bool {
        self.runs.is_busy(id)
    }

    /// Runs `work` for the claimed short in the background, then makes any published cover
    /// still missing and asks for a fresh storage measurement.
    fn spawn_run<F>(self: &Arc<Self>, claim: Claim<ShortId>, what: &'static str, work: F)
    where
        F: for<'a> FnOnce(
                &'a Publisher,
                &'a ShortId,
            ) -> nimbytes_core::ports::BoxFuture<'a, Result<(), AppError>>
            + Send
            + 'static,
    {
        let me = self.clone();
        tokio::spawn(async move {
            let id = claim.key().clone();
            if let Err(err) = work(&me, &id).await {
                tracing::error!(short = %id, code = ?err.code, message = %err.message, run = what, "export run failed");
            }
            drop(claim);
            me.bake_due(&id).await;
            me.ports.usage_refresh.poke();
        });
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
        self.spawn_run(claim, "publish", move |me, id| {
            Box::pin(async move { run_exports(&me.deps(), id, &platforms).await })
        });
        Ok(())
    }

    /// Starts 3 more covers for one platform (in `style` when given), or one cut-out cover over
    /// `background` for the `cutout` style, in the background.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` while a run is in flight, at 9 covers or for a style that cannot be
    /// picked; as `more_covers` and `cutout_requested`.
    pub async fn covers(
        self: &Arc<Self>,
        user: &UserId,
        (id, platform): (&ShortId, Platform),
        (style, background): (Option<CoverStyle>, Option<CutoutBackground>),
    ) -> Result<(), AppError> {
        let claim = self.runs.claim(id).ok_or_else(busy)?;
        if style == Some(CoverStyle::Cutout) {
            let plan = cutout_requested(&self.deps(), user, (id, platform), background).await?;
            self.spawn_run(claim, "cutout", move |me, id| {
                Box::pin(async move { draw_cutout_cover(&me.deps(), (id, platform), plan).await })
            });
            return Ok(());
        }
        let numbers = more_covers(&self.deps(), user, (id, platform), style).await?;
        self.spawn_run(claim, "covers", move |me, id| {
            Box::pin(
                async move { draw_more_covers(&me.deps(), (id, platform), numbers, style).await },
            )
        });
        Ok(())
    }

    /// Starts a redraw of cover `from` with the owner's words in the background.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` while a run is in flight; as `redraw_requested`.
    pub async fn redraw(
        self: &Arc<Self>,
        user: &UserId,
        (id, platform): (&ShortId, Platform),
        (from, instruction): (u32, &str),
    ) -> Result<(), AppError> {
        let claim = self.runs.claim(id).ok_or_else(busy)?;
        let plan =
            redraw_requested(&self.deps(), user, (id, platform), (from, instruction)).await?;
        self.spawn_run(claim, "redraw", move |me, id| {
            Box::pin(async move { draw_redraw(&me.deps(), (id, platform), plan).await })
        });
        Ok(())
    }

    /// Applies the owner's edit; a new pick or title makes the published cover again in the
    /// background.
    ///
    /// # Errors
    /// As `edit_export`.
    pub async fn edit(
        self: &Arc<Self>,
        user: &UserId,
        (id, platform): (&ShortId, Platform),
        change: ExportEdit,
    ) -> Result<(), AppError> {
        if edit_export(&self.deps(), user, (id, platform), change).await? {
            self.bake(id, platform);
        }
        Ok(())
    }

    /// Makes the published cover of every export of the short that is missing one.
    pub async fn bake_due(self: &Arc<Self>, id: &ShortId) {
        match bakes_due(&self.deps(), id).await {
            Ok(platforms) => {
                for p in platforms {
                    self.bake(id, p);
                }
            }
            Err(err) => {
                tracing::error!(short = %id, code = ?err.code, message = %err.message, "cover still check failed");
            }
        }
    }

    /// Makes one export's published cover in the background, again while the owner changes its
    /// pick or title meanwhile; nothing when one is already being made (it rechecks at its end).
    pub fn bake(self: &Arc<Self>, id: &ShortId, platform: Platform) {
        let Some(claim) = self.stills.claim(&(id.clone(), platform)) else {
            return;
        };
        let me = self.clone();
        tokio::spawn(async move {
            let (id, platform) = claim.key();
            for _ in 0..BAKE_ATTEMPTS {
                match bake_titled_cover(&me.deps(), (id, *platform)).await {
                    Ok(true) => break,
                    Ok(false) => {}
                    Err(err) => {
                        tracing::warn!(short = %id, code = ?err.code, message = %err.message, "cover still not made");
                        break;
                    }
                }
            }
            me.ports.usage_refresh.poke();
        });
    }

    /// Starts keep subject in frame for the short in the background (nothing when one is in
    /// flight; returns whether one started). A failed run marks only the reframe failed.
    ///
    /// # Errors
    /// As `reframe_requested`.
    pub async fn reframe(self: &Arc<Self>, user: &UserId, id: &ShortId) -> Result<bool, AppError> {
        let ports = &self.ports;
        reframe_requested(&ports.short_deps(), user, id).await?;
        let Some(claim) = self.reframes.claim(id) else {
            return Ok(false);
        };
        self.set_reframe_failed(id, false);
        let me = self.clone();
        tokio::spawn(async move {
            let id = claim.key().clone();
            let ports = &me.ports;
            let deps = ports.short_deps();
            let progress = me.progress.as_ref();
            if let Err(err) = reframe_short((&deps, &ports.subjects, progress), &id).await {
                tracing::warn!(short = %id, code = ?err.code, message = %err.message, "reframe failed");
                progress.emit(id.as_str(), "reframe", StepStatus::Failed);
                me.set_reframe_failed(&id, true);
            }
            drop(claim);
        });
        Ok(true)
    }

    /// Where the short's reframe stands.
    ///
    /// # Errors
    /// As `reframe_view`.
    pub async fn reframe_status(
        &self,
        user: &UserId,
        id: &ShortId,
    ) -> Result<ReframeView, AppError> {
        let ports = &self.ports;
        let failed = self
            .failed_reframes
            .lock()
            .is_ok_and(|set| set.contains(id));
        let running = self.reframes.is_busy(id);
        reframe_view(
            (&ports.short_deps(), &ports.subjects),
            user,
            id,
            (running, failed),
        )
        .await
    }

    fn set_reframe_failed(&self, id: &ShortId, failed: bool) {
        if let Ok(mut set) = self.failed_reframes.lock() {
            if failed {
                set.insert(id.clone());
            } else {
                set.remove(id);
            }
        }
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
