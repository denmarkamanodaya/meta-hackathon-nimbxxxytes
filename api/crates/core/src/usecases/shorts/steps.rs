//! The [`StepRunner`] for `agent` jobs (the editing loop in `agent.rs`) and `render` jobs (the
//! final video). Every step logs what it did so the owner can follow it, and can be rerun after a
//! crash without duplicating a version.

use std::sync::Arc;
use std::time::Duration;

use super::{build_props, with_blur};
use crate::domain::agent::AgentBudget;
use crate::domain::ids::ShortId;
use crate::domain::job::{Job, JobKind};
use crate::domain::render::{Quality, parse_render_subject};
use crate::domain::short::{NewStep, Short, ShortStatus, StepKind, Version};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::{
    BlobStore, Catalogue, Clock, Embedder, ModelLedger, PeopleStore, PortResult, PrivacyStore,
    Reasoner, Renderer, Scratch, ShortStore, StepRunner, TextIndex, VectorIndex,
};
use crate::time::format_utc;

/// Tool name logged for timeline fixes.
pub const FIT_TOOL: &str = "fit_timeline";
/// Tool name logged for preview renders.
pub const PREVIEW_TOOL: &str = "render_preview";
/// Tool name logged for critiques.
pub const CRITIQUE_TOOL: &str = "critique_preview";
const FINAL_TOOL: &str = "render_final";

/// Ports the shorts job steps use.
#[derive(Clone)]
pub struct ShortSteps {
    /// Shorts, versions, steps.
    pub shorts: Arc<dyn ShortStore>,
    /// Media URLs for the renderer and upload URLs for its output.
    pub blobs: Arc<dyn BlobStore>,
    /// The planner.
    pub reasoner: Arc<dyn Reasoner>,
    /// The video renderer.
    pub renderer: Arc<dyn Renderer>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Lifetime of the URLs the renderer reads and writes; longer than a render.
    pub media_ttl: Duration,
    /// Where previews are downloaded for the critic.
    pub scratch: Arc<dyn Scratch>,
    /// Model spend, for the cost budget.
    pub ledger: Arc<dyn ModelLedger>,
    /// Limits of one agent run.
    pub budget: AgentBudget,
    /// The library search the planner's `search_moments` runs.
    pub library: SearchPorts,
    /// Finish settings and the hidden faces to blur.
    pub privacy: Arc<dyn PrivacyStore>,
}

/// Ports of the library search (the reasoner, blobs and clock come from [`ShortSteps`]).
#[derive(Clone)]
pub struct SearchPorts {
    /// Candidate rows and names.
    pub catalogue: Arc<dyn Catalogue>,
    /// Known people and speakers.
    pub people: Arc<dyn PeopleStore>,
    /// Keyword leg.
    pub text: Arc<dyn TextIndex>,
    /// Query embedding.
    pub embedder: Arc<dyn Embedder>,
    /// Vector leg.
    pub vectors: Arc<dyn VectorIndex>,
}

impl ShortSteps {
    pub(super) async fn log(
        &self,
        short: &ShortId,
        (kind, tool, version): (StepKind, Option<&str>, Option<u32>),
        summary: String,
    ) -> Result<(), AppError> {
        let step = NewStep {
            kind,
            tool: tool.map(str::to_owned),
            version,
            summary,
            at: format_utc(self.clock.now_millis()),
        };
        self.shorts.add_step(short, &step).await.map(|_| ())
    }

    pub(super) async fn short(&self, id: &ShortId) -> Result<Short, AppError> {
        self.shorts
            .get(id)
            .await?
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "short of job is gone"))
    }

    /// Renders `version` with `quality` to `key` and returns a one-line result. When the short was
    /// deleted meanwhile, the upload is removed and the render is `NOT_FOUND`.
    pub(super) async fn render_to(
        &self,
        short: &Short,
        version: &Version,
        (quality, key): (Quality, &ObjectKey),
    ) -> Result<String, AppError> {
        let segments = self.shorts.segments(&short.id).await?;
        let inputs = (quality, self.media_ttl);
        let props = build_props(
            self.blobs.as_ref(),
            &short.user_id,
            (&segments, &version.timeline),
            inputs,
        )
        .await?;
        let props = with_blur(self.privacy.as_ref(), &short.id, props).await?;
        let url = self.blobs.presign_put(key, self.media_ttl).await?;
        let out = self.renderer.render(&props, quality, &url).await?;
        if self.shorts.get(&short.id).await?.is_none() {
            // The short was deleted while this render ran: its upload would be an orphan.
            self.blobs.delete(std::slice::from_ref(key)).await?;
            return Err(AppError::new(
                ErrorCode::NotFound,
                "short was deleted while rendering",
            ));
        }
        let mb = out.bytes as f64 / 1_000_000.0;
        Ok(format!("{:.1} s, {mb:.1} MB", out.duration_s))
    }

    /// Renders the final video of the version named by the job subject.
    async fn render_final(&self, subject: &str) -> Result<(), AppError> {
        let (id, n) = parse_render_subject(subject)?;
        let short = self.short(&id).await?;
        let versions = self.shorts.versions(&id).await?;
        let version = versions
            .iter()
            .find(|v| v.n == n)
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "rendered version is gone"))?;
        self.shorts.set_status(&id, ShortStatus::Rendering).await?;
        self.shorts.set_render(&id, None).await?;
        let call = format!(
            "Rendering the final {} video of version {n}",
            short.aspect.as_str()
        );
        let at = (Some(FINAL_TOOL), Some(n));
        self.log(&id, (StepKind::ToolCall, at.0, at.1), call)
            .await?;
        let key = keys::render(&short.user_id, &id);
        let done = self
            .render_to(&short, version, (Quality::Final, &key))
            .await?;
        self.shorts.set_render(&id, Some((&key, n))).await?;
        self.shorts.set_status(&id, ShortStatus::Ready).await?;
        let result = format!("Final video ready: {done}");
        self.log(&id, (StepKind::ToolResult, at.0, at.1), result)
            .await
    }

    async fn dispatch(&self, job: &Job, step: &str) -> Result<(), AppError> {
        match (job.kind, step) {
            (JobKind::Agent, "edit") => self.edit(&ShortId::parse(job.subject_id.as_str())?).await,
            (JobKind::Render, "render") => self.render_final(&job.subject_id).await,
            _ => Err(AppError::new(
                ErrorCode::Internal,
                format!("no {step} step for {} jobs", job.kind.as_str()),
            )),
        }
    }

    /// After the last attempt: an agent run marks the short failed; a final render leaves the
    /// short usable. Both log why.
    async fn give_up(&self, job: &Job, error: &AppError) -> Result<(), AppError> {
        if job.kind == JobKind::Render {
            let (id, n) = parse_render_subject(&job.subject_id)?;
            self.shorts.set_status(&id, ShortStatus::Ready).await?;
            let summary = format!("Final render failed: {}", error.message);
            let at = (Some(FINAL_TOOL), Some(n));
            return self
                .log(&id, (StepKind::ToolResult, at.0, at.1), summary)
                .await;
        }
        let id = ShortId::parse(job.subject_id.as_str())?;
        self.shorts.set_status(&id, ShortStatus::Failed).await?;
        let summary = format!("Could not make the short: {}", error.message);
        self.log(&id, (StepKind::Final, None, None), summary).await
    }
}

impl StepRunner for ShortSteps {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.dispatch(job, step))
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(self.give_up(job, error))
    }
}
