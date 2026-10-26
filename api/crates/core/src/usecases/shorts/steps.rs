//! The [`StepRunner`] for `agent` jobs (plan a timeline, render its preview) and `render` jobs
//! (render the final video). Every step logs what it did so the owner can follow it, and can be
//! rerun after a crash without duplicating a version.

use std::sync::Arc;
use std::time::Duration;

use super::build_props;
use crate::domain::ids::ShortId;
use crate::domain::job::{Job, JobKind};
use crate::domain::render::{Quality, parse_render_subject};
use crate::domain::short::{NewStep, Short, ShortStatus, StepKind, Version, bounds};
use crate::domain::timeline::fit;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectClass, ObjectKey};
use crate::ports::{
    BlobStore, Clock, PlanRequest, PortResult, Reasoner, Renderer, ShortStore, StepRunner,
};
use crate::time::format_utc;

/// Tool name logged for timeline fixes.
pub const FIT_TOOL: &str = "fit_timeline";
const PREVIEW_TOOL: &str = "render_preview";
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
}

impl ShortSteps {
    async fn log(
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

    async fn short(&self, id: &ShortId) -> Result<Short, AppError> {
        self.shorts
            .get(id)
            .await?
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "short of job is gone"))
    }

    /// Plans version 1 with the reasoner, fits it to the picked moments and logs each fix.
    /// Does nothing when version 1 exists (the step is being rerun).
    async fn plan(&self, id: &ShortId) -> Result<(), AppError> {
        let short = self.short(id).await?;
        if !self.shorts.versions(id).await?.is_empty() {
            return Ok(());
        }
        self.shorts.set_status(id, ShortStatus::Planning).await?;
        let segments = self.shorts.segments(id).await?;
        let request = PlanRequest {
            prompt: &short.prompt,
            aspect: short.aspect,
            target_s: short.target_s,
            segments: &segments,
        };
        let mut timeline = self.reasoner.plan_edit(&request).await?;
        (timeline.aspect, timeline.target_seconds) = (short.aspect, short.target_s);
        timeline.revision = None;
        let (timeline, clamps) = fit(timeline, &bounds(&segments))?;
        self.shorts.add_version(id, 1, &timeline).await?;
        self.shorts.set_best_version(id, 1).await?;
        let rationale = timeline.rationale.clone();
        self.log(id, (StepKind::Plan, None, Some(1)), rationale)
            .await?;
        for clamp in clamps {
            let at = (Some(FIT_TOOL), Some(1));
            self.log(id, (StepKind::ToolResult, at.0, at.1), clamp.note)
                .await?;
        }
        Ok(())
    }

    /// Renders `version` with `quality` to `key` and returns a one-line result.
    async fn render_to(
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
        let url = self.blobs.presign_put(key, self.media_ttl).await?;
        let out = self.renderer.render(&props, quality, &url).await?;
        let mb = out.bytes as f64 / 1_000_000.0;
        Ok(format!("{:.1} s, {mb:.1} MB", out.duration_s))
    }

    /// Renders the newest version's preview for the agent trail. A failed preview is logged and
    /// does not fail the short: the owner still has the timeline and the live Player.
    async fn preview(&self, id: &ShortId) -> Result<(), AppError> {
        let short = self.short(id).await?;
        let versions = self.shorts.versions(id).await?;
        let version = versions
            .last()
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "preview before any version"))?;
        let n = Some(version.n);
        if version.preview_key.is_none() {
            self.shorts.set_status(id, ShortStatus::Rendering).await?;
            let call = format!("Rendering a preview of version {}", version.n);
            self.log(id, (StepKind::ToolCall, Some(PREVIEW_TOOL), n), call)
                .await?;
            let key = keys::preview(&short.user_id, id, version.n);
            let result = match self
                .render_to(&short, version, (Quality::Preview, &key))
                .await
            {
                Ok(done) => {
                    self.blobs.tag(&key, ObjectClass::Preview).await?;
                    self.shorts.set_preview(id, version.n, &key).await?;
                    format!("Preview ready: {done}")
                }
                Err(err) => format!("Preview failed: {}", err.message),
            };
            self.log(id, (StepKind::ToolResult, Some(PREVIEW_TOOL), n), result)
                .await?;
        }
        self.shorts.set_status(id, ShortStatus::Ready).await?;
        let summary = format!("Version {} is ready", version.n);
        self.log(id, (StepKind::Final, None, n), summary).await
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
            (JobKind::Agent, "plan") => self.plan(&ShortId::parse(job.subject_id.as_str())?).await,
            (JobKind::Agent, "preview") => {
                self.preview(&ShortId::parse(job.subject_id.as_str())?)
                    .await
            }
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
