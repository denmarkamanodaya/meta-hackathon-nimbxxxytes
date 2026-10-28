//! The project key art module: owns the background tokio tasks that draw a project's key art.
//! At most one art run per project is in flight. Art never fails anything: a failed drawing is
//! logged and only frees the "drawing" flag.

use std::sync::Arc;

use nimbytes_core::AppError;
use nimbytes_core::domain::cover::manual_take;
use nimbytes_core::domain::ids::{ProjectId, UserId};
use nimbytes_core::ports::ImageMaker;
use nimbytes_core::usecases::project_art::{
    ProjectArtDeps, auto_project_art_due, draw_project_art, project_art_requested,
};

use crate::runs::Runs;
use crate::state::Ports;

/// The image maker over the shared ports, and the art runs in flight.
pub struct ProjectArt {
    ports: Arc<Ports>,
    images: Arc<dyn ImageMaker>,
    runs: Arc<Runs<ProjectId>>,
}

impl ProjectArt {
    /// Project art with nothing in flight.
    pub fn new(ports: Arc<Ports>, images: Arc<dyn ImageMaker>) -> Arc<Self> {
        Arc::new(Self {
            ports,
            images,
            runs: Arc::default(),
        })
    }

    fn deps(&self) -> ProjectArtDeps<'_> {
        ProjectArtDeps {
            projects: self.ports.projects.as_ref(),
            catalogue: self.ports.catalogue.as_ref(),
            images: self.images.as_ref(),
            short: self.ports.short_deps(),
        }
    }

    /// Whether project `id`'s key art is being drawn.
    pub fn is_drawing(&self, id: &ProjectId) -> bool {
        self.runs.is_busy(id)
    }

    /// Draws `user`'s project key art again in the background; `false` when it is already being
    /// drawn.
    ///
    /// # Errors
    /// As [`project_art_requested`].
    pub async fn redraw(self: &Arc<Self>, user: &UserId, id: &ProjectId) -> Result<bool, AppError> {
        project_art_requested(&self.deps(), user, id).await?;
        let take = manual_take(self.ports.clock.now_millis());
        Ok(self.start(id, take))
    }

    /// Starts the automatic first art of project `id` when it is due (3 clips, never drawn).
    pub async fn auto_draw(self: &Arc<Self>, id: &ProjectId) {
        match auto_project_art_due(self.ports.projects.as_ref(), id).await {
            Ok(true) => {
                self.start(id, 0);
            }
            Ok(false) => {}
            Err(err) => {
                tracing::error!(project = %id, code = ?err.code, message = %err.message, "auto art check failed");
            }
        }
    }

    fn start(self: &Arc<Self>, id: &ProjectId, take: u32) -> bool {
        let Some(claim) = self.runs.claim(id) else {
            return false;
        };
        let me = self.clone();
        tokio::spawn(async move {
            let id = claim.key();
            if let Err(err) = draw_project_art(&me.deps(), id, take).await {
                tracing::warn!(project = %id, code = ?err.code, message = %err.message, "key art not drawn");
            }
            me.ports.usage_refresh.poke();
        });
        true
    }
}
