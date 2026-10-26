//! The editing agent: plan v1 → render its preview → watch and critique it → revise (each change
//! citing a critique note) → render → critique …, at most two revisions, until the critic accepts
//! or a budget runs out; the best-scored version is shown. The next move is derived from the
//! stored versions, so a rerun after a crash continues where the last run stopped.

use super::steps::{CRITIQUE_TOOL, FIT_TOOL, PREVIEW_TOOL, ShortSteps};
use crate::domain::agent::{Next, Spent, Stop, best_version};
use std::path::PathBuf;

use crate::domain::critique::check_revision;
use crate::domain::ids::ShortId;
use crate::domain::render::Quality;
use crate::domain::short::{Short, ShortSegment, ShortStatus, StepKind, Version, bounds};
use crate::domain::timeline::{Clamp, Timeline, fit};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectClass};
use crate::ports::{CritiqueRequest, PlanRequest, Previous};
use crate::time::format_utc;

/// Tool name logged for planning and revising.
const PLAN_TOOL: &str = "plan_edit";
/// Answers the planner may give per version (one retry after a refusal).
const PLAN_ATTEMPTS: u32 = 2;

/// One run's fixed inputs and its call counter.
struct Run<'a> {
    short: &'a Short,
    segments: &'a [ShortSegment],
    started: i64,
    since: String,
    calls: u32,
}

/// The planner's answer for version `n` made safe: the short's own frame and length, no revision
/// on v1, a revision citing the critique on v2+, and fitted to the picked moments.
fn checked(
    run: &Run<'_>,
    (n, previous): (u32, Option<Previous<'_>>),
    mut timeline: Timeline,
) -> Result<(Timeline, Vec<Clamp>), AppError> {
    (timeline.aspect, timeline.target_seconds) = (run.short.aspect, run.short.target_s);
    if n == 1 {
        timeline.revision = None;
    }
    if let Some(p) = previous {
        check_revision(&timeline, n, p.critique)?;
    }
    fit(timeline, &bounds(run.segments))
}

/// What one planner answer came to.
enum Attempt {
    /// Stored as the next version.
    Saved,
    /// Refused, with the reason for the retry.
    Refused(String),
    /// The model call failed on a revision; the run ends.
    Failed,
}

/// What an action did: carry on, or end the run for a reason.
type Outcome = Result<Option<Stop>, AppError>;

impl ShortSteps {
    /// Runs the loop to its end and shows the best version.
    pub(super) async fn edit(&self, id: &ShortId) -> Result<(), AppError> {
        let short = self.short(id).await?;
        let segments = self.shorts.segments(id).await?;
        let started = self.clock.now_millis();
        let mut run = Run {
            short: &short,
            segments: &segments,
            started,
            since: format_utc(started),
            calls: 0,
        };
        let stop = loop {
            let versions = self.shorts.versions(id).await?;
            let next = self.budget.next(&versions);
            if let Next::Finish(stop) = next {
                break stop;
            }
            if let Some(stop) = self.over_budget(&run, &versions).await? {
                break stop;
            }
            run.calls += 1;
            if let Some(stop) = self.act(&mut run, next, &versions).await? {
                break stop;
            }
        };
        self.finish(id, stop).await
    }

    /// The used-up budget, once version 1 exists (v1 is always made).
    async fn over_budget(&self, run: &Run<'_>, versions: &[Version]) -> Outcome {
        if versions.is_empty() {
            return Ok(None);
        }
        let spent = Spent {
            tool_calls: run.calls,
            wall_ms: self.clock.now_millis() - run.started,
            cost_usd: self.ledger.cost_since(&run.since).await?,
        };
        Ok(self.budget.exceeded(spent))
    }

    async fn act(&self, run: &mut Run<'_>, next: Next, versions: &[Version]) -> Outcome {
        let version = |n: u32| {
            versions
                .iter()
                .find(|v| v.n == n)
                .ok_or_else(|| AppError::new(ErrorCode::Internal, "agent lost a version"))
        };
        match next {
            Next::Plan => self.plan(run, None).await,
            Next::Render(n) => self.render_preview(run.short, version(n)?).await,
            Next::Critique(n) => self.critique(run, version(n)?).await,
            Next::Revise(n) => self.plan(run, Some(version(n)?)).await,
            Next::Finish(stop) => Ok(Some(stop)),
        }
    }

    /// Plans v1, or revises `from` into the next version. An answer that names a moment outside
    /// the short, or a revision that does not cite the critique, is refused and asked again once.
    async fn plan(&self, run: &mut Run<'_>, from: Option<&Version>) -> Outcome {
        let n = from.map_or(1, |v| v.n + 1);
        let status = if n == 1 {
            ShortStatus::Planning
        } else {
            ShortStatus::Revising
        };
        self.shorts.set_status(&run.short.id, status).await?;
        let previous = match from {
            Some(v) => Some(Previous {
                timeline: &v.timeline,
                critique: v.critique.as_ref().ok_or_else(|| {
                    AppError::new(ErrorCode::Internal, "revising an uncritiqued version")
                })?,
            }),
            None => None,
        };
        let mut rejection: Option<String> = None;
        for attempt in 1..=PLAN_ATTEMPTS {
            if attempt > 1 {
                run.calls += 1;
            }
            let ask = (n, previous, rejection.as_deref());
            match self.attempt(run, ask).await? {
                Attempt::Saved => return Ok(None),
                Attempt::Failed => return Ok(Some(Stop::RevisionRefused)),
                Attempt::Refused(why) => rejection = Some(why),
            }
        }
        match n {
            1 => Err(AppError::new(
                ErrorCode::ModelUnavailable,
                "the planner gave no usable cut",
            )),
            _ => Ok(Some(Stop::RevisionRefused)),
        }
    }

    /// One planner answer for version `n`: saved, refused (with the reason), or failed.
    async fn attempt(
        &self,
        run: &Run<'_>,
        (n, previous, rejection): (u32, Option<Previous<'_>>, Option<&str>),
    ) -> Result<Attempt, AppError> {
        let id = &run.short.id;
        let at = (StepKind::ToolResult, Some(PLAN_TOOL), Some(n));
        let request = PlanRequest {
            prompt: &run.short.prompt,
            aspect: run.short.aspect,
            target_s: run.short.target_s,
            segments: run.segments,
            previous,
            rejection,
        };
        let timeline = match self.reasoner.plan_edit(&request).await {
            Ok(t) => t,
            Err(e) if n == 1 => return Err(e),
            Err(e) => {
                self.log(id, at, format!("Revision failed: {}", e.message))
                    .await?;
                return Ok(Attempt::Failed);
            }
        };
        let checked = checked(run, (n, previous), timeline);
        match checked {
            Ok((timeline, clamps)) => {
                self.save(id, (n, &timeline), clamps).await?;
                Ok(Attempt::Saved)
            }
            Err(e) => {
                self.log(id, at, format!("Refused version {n}: {}", e.message))
                    .await?;
                Ok(Attempt::Refused(e.message))
            }
        }
    }

    /// Stores version `n` and logs its rationale and every fix the fit made.
    async fn save(
        &self,
        id: &ShortId,
        (n, timeline): (u32, &Timeline),
        clamps: Vec<Clamp>,
    ) -> Result<(), AppError> {
        self.shorts.add_version(id, n, timeline).await?;
        let kind = if n == 1 {
            self.shorts.set_best_version(id, 1).await?;
            StepKind::Plan
        } else {
            StepKind::Revise
        };
        self.log(id, (kind, None, Some(n)), timeline.rationale.clone())
            .await?;
        for clamp in clamps {
            let at = (StepKind::ToolResult, Some(FIT_TOOL), Some(n));
            self.log(id, at, clamp.note).await?;
        }
        Ok(())
    }

    /// Renders version `v`'s low-res preview for the critic.
    async fn render_preview(&self, short: &Short, v: &Version) -> Outcome {
        let id = &short.id;
        let at = (Some(PREVIEW_TOOL), Some(v.n));
        self.shorts.set_status(id, ShortStatus::Rendering).await?;
        let call = format!("Rendering a preview of version {}", v.n);
        self.log(id, (StepKind::ToolCall, at.0, at.1), call).await?;
        let key = keys::preview(&short.user_id, id, v.n);
        let rendered = self.render_to(short, v, (Quality::Preview, &key)).await;
        let (summary, stop) = match rendered {
            Ok(done) => {
                self.blobs.tag(&key, ObjectClass::Preview).await?;
                self.shorts.set_preview(id, v.n, &key).await?;
                (format!("Preview ready: {done}"), None)
            }
            Err(e) => (
                format!("Preview failed: {}", e.message),
                Some(Stop::RenderFailed),
            ),
        };
        self.log(id, (StepKind::ToolResult, at.0, at.1), summary)
            .await?;
        Ok(stop)
    }

    /// Watches version `v`'s preview and stores the critique.
    async fn critique(&self, run: &Run<'_>, v: &Version) -> Outcome {
        let id = &run.short.id;
        let at = (Some(CRITIQUE_TOOL), Some(v.n));
        self.shorts.set_status(id, ShortStatus::Critiquing).await?;
        let call = format!("Watching the preview of version {}", v.n);
        self.log(id, (StepKind::ToolCall, at.0, at.1), call).await?;
        let video = self.local_preview(id, v).await?;
        let request = CritiqueRequest {
            video: &video,
            version: v.n,
            prompt: &run.short.prompt,
            target_s: run.short.target_s,
            timeline: &v.timeline,
            segments: run.segments,
        };
        let c = match self.reasoner.critique(&request).await {
            Ok(c) => c,
            Err(e) => {
                let summary = format!("Critique failed: {}", e.message);
                self.log(id, (StepKind::ToolResult, at.0, at.1), summary)
                    .await?;
                return Ok(Some(Stop::CritiqueFailed));
            }
        };
        self.shorts.set_critique(id, v.n, &c).await?;
        self.log(id, (StepKind::Critique, None, Some(v.n)), c.summary())
            .await?;
        Ok(None)
    }

    /// The preview of `v` on local disk, downloaded unless a rerun already has it.
    async fn local_preview(&self, id: &ShortId, v: &Version) -> Result<PathBuf, AppError> {
        let key = v
            .preview_key
            .as_ref()
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "critique before a preview"))?;
        let video = self
            .scratch
            .short_dir(id)
            .await?
            .join(format!("v{}.mp4", v.n));
        if !self.scratch.exists(&video).await? {
            self.blobs.get_to_file(key, &video).await?;
        }
        Ok(video)
    }

    /// Picks the best version, marks the short ready and says why the run ended.
    async fn finish(&self, id: &ShortId, stop: Stop) -> Result<(), AppError> {
        let versions = self.shorts.versions(id).await?;
        let best = best_version(&versions)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "finished without a version"))?;
        self.shorts.set_best_version(id, best).await?;
        self.shorts.set_status(id, ShortStatus::Ready).await?;
        let score = versions
            .iter()
            .find(|v| v.n == best)
            .and_then(|v| v.critique.as_ref())
            .map_or(String::new(), |c| format!(" ({}/50)", c.total));
        let summary = format!("Showing version {best}{score}: {}", stop.reason());
        self.log(id, (StepKind::Final, None, Some(best)), summary)
            .await
    }
}
