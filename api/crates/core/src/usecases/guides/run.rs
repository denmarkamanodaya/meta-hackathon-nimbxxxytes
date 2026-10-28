//! The `guide` job: one step per stage. `steps` asks Spark for the steps from the clip's 360p copy
//! and transcript; `frames` takes each step's frame and replay clip from the 720p proxy;
//! `highlight` circles each step's control with SAM 3.1 and the renderer; `voice` speaks each
//! step with MMS-TTS; `ready` marks it done. A refused guide skips every stage after `steps`; a
//! deleted one does nothing. Each stage may run again after a crash and rewrites the same files.

use std::path::PathBuf;

use super::{GuidePorts, now, voice_step};
use crate::domain::clip::Clip;
use crate::domain::guide::{
    CLIP_FPS, Guide, GuidePlan, GuideStage, GuideStatus, GuideStep, best_highlight, plan_guide,
};
use crate::domain::job::Job;
use crate::domain::render::StepStillProps;
use crate::domain::sam::{SamMedia, SamPrompt, SamRequest};
use crate::domain::segmenting::Span;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{
    GuideProgress, GuideRequest, GuideVerdict, PortResult, PutFile, StepRunner, purpose,
};
use crate::usecases::subjects::{ClipFiles, box_of};

impl GuidePorts {
    fn files(&self) -> ClipFiles<'_> {
        ClipFiles {
            blobs: self.blobs.as_ref(),
            scratch: self.scratch.as_ref(),
        }
    }

    async fn progress(
        &self,
        guide: &Guide,
        (status, stage): (GuideStatus, Option<GuideStage>),
        error: Option<&str>,
    ) -> Result<(), AppError> {
        let at = now(self);
        let progress = GuideProgress {
            status,
            stage,
            error,
            at: &at,
        };
        self.store.set_progress(&guide.id, progress).await
    }

    async fn clip_of(&self, guide: &Guide) -> Result<Clip, AppError> {
        self.catalogue
            .get_clip(&guide.clip_id)
            .await?
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "the guide's clip is gone"))
    }

    async fn working_file(&self, guide: &Guide, name: &str) -> Result<PathBuf, AppError> {
        let dir = self.scratch.clip_dir(&guide.clip_id).await?;
        Ok(dir.join(format!("guide_{}_{name}", guide.id)))
    }

    async fn put(
        &self,
        key: &ObjectKey,
        path: &std::path::Path,
        mime: &str,
    ) -> Result<(), AppError> {
        let put = PutFile {
            key,
            path,
            content_type: mime,
            class: None,
            cache_control: Some(DERIVED_CACHE_CONTROL),
        };
        self.blobs.put_file(put).await
    }
}

/// The clip's speech as `[start–end] text` lines, or `(no speech)`.
pub(crate) fn transcript_lines(turns: &[(f64, f64, String)]) -> String {
    let lines: Vec<String> = turns
        .iter()
        .filter(|(_, _, t)| !t.trim().is_empty())
        .map(|(a, b, t)| format!("[{a:.1}–{b:.1}] {}", t.trim()))
        .collect();
    if lines.is_empty() {
        "(no speech)".to_owned()
    } else {
        lines.join("\n")
    }
}

/// `steps`: Spark reads the clip's 360p copy and transcript; the rules make the steps, or the
/// guide is refused.
async fn write_steps(p: &GuidePorts, guide: &Guide) -> Result<(), AppError> {
    let clip = p.clip_of(guide).await?;
    let duration_s = clip.probe.as_ref().map_or(0.0, |pr| pr.duration_s);
    let video = p.working_file(guide, "360p.mp4").await?;
    if !p.scratch.exists(&video).await? {
        let proxy = p.files().proxy(&guide.user_id, &guide.clip_id).await?;
        let whole = Span {
            start_s: 0.0,
            end_s: duration_s,
        };
        p.media.snippet(&proxy, whole, &video).await?;
    }
    let turns = p
        .catalogue
        .clip_detail(&guide.clip_id)
        .await?
        .map(|d| d.turns)
        .unwrap_or_default();
    let turns: Vec<(f64, f64, String)> = turns
        .into_iter()
        .map(|t| (t.span.start_s, t.span.end_s, t.text))
        .collect();
    let request = GuideRequest {
        video: &video,
        duration_s,
        transcript: transcript_lines(&turns),
    };
    let draft = p.writer.write_steps(&request).await?;
    store_plan(p, guide, plan_guide(&draft, duration_s)?).await
}

async fn store_plan(p: &GuidePorts, guide: &Guide, plan: GuidePlan) -> Result<(), AppError> {
    match plan {
        GuidePlan::Refused { reason } => {
            let verdict = GuideVerdict {
                title: "",
                safety: crate::domain::guide::Safety::NotSupported,
                reason: &reason,
            };
            p.store.set_plan(&guide.id, verdict, &[]).await?;
            p.progress(guide, (GuideStatus::Refused, None), None).await
        }
        GuidePlan::Steps {
            title,
            safety,
            reason,
            steps,
        } => {
            let rows: Vec<GuideStep> = steps.iter().map(GuideStep::planned).collect();
            let verdict = GuideVerdict {
                title: &title,
                safety,
                reason: &reason,
            };
            p.store.set_plan(&guide.id, verdict, &rows).await
        }
    }
}

/// `frames`: each step's frame at its key second and its replay clip, from the 720p proxy.
async fn take_frames(p: &GuidePorts, guide: &Guide) -> Result<(), AppError> {
    let proxy = p.files().proxy(&guide.user_id, &guide.clip_id).await?;
    for mut step in p.store.steps(&guide.id).await? {
        let n = step.n;
        let frame = p.working_file(guide, &format!("frame_{n}.jpg")).await?;
        p.media.frame_at(&proxy, step.key_s, &frame).await?;
        let frame_key = keys::guide_frame(&guide.user_id, &guide.id, n);
        p.put(&frame_key, &frame, "image/jpeg").await?;
        let clip = p.working_file(guide, &format!("step_{n}.mp4")).await?;
        let span = Span {
            start_s: step.start_s,
            end_s: step.end_s,
        };
        p.media.range_proxy(&proxy, (span, CLIP_FPS), &clip).await?;
        let clip_key = keys::guide_clip(&guide.user_id, &guide.id, n);
        p.put(&clip_key, &clip, "video/mp4").await?;
        step.image_key = Some(frame_key);
        step.highlight = None;
        step.clip_key = Some(clip_key);
        p.store.put_step(&guide.id, &step).await?;
    }
    Ok(())
}

/// `highlight`: SAM looks for each step's control on its frame; a found one is circled by the
/// renderer and the still becomes the step image. Not found, or any failure on the way, keeps
/// the plain frame with no highlight: a missing circle is better than a wrong one.
async fn circle_controls(p: &GuidePorts, guide: &Guide) -> Result<(), AppError> {
    for mut step in p.store.steps(&guide.id).await? {
        let Some(control) = step.control.clone() else {
            continue;
        };
        if let Ok(Some(still)) = circled(p, guide, (step.n, &control)).await {
            step.image_key = Some(still);
            step.highlight = Some(control);
            p.store.put_step(&guide.id, &step).await?;
        }
    }
    Ok(())
}

/// The circled still of step `n`'s frame, or `None` when SAM found no confident `control`.
async fn circled(
    p: &GuidePorts,
    guide: &Guide,
    (n, control): (u32, &str),
) -> Result<Option<ObjectKey>, AppError> {
    let frame_key = keys::guide_frame(&guide.user_id, &guide.id, n);
    let frame = p.working_file(guide, &format!("frame_{n}.jpg")).await?;
    if !p.scratch.exists(&frame).await? {
        p.blobs.get_to_file(&frame_key, &frame).await?;
    }
    let request = SamRequest {
        media: SamMedia::Image(&frame),
        prompt: SamPrompt::Concept(control.to_owned()),
        propagation: None,
        purpose: purpose::GUIDE_HIGHLIGHT,
    };
    let records = p.tracker.segment(&request).await?;
    let Some(best) = best_highlight(&records) else {
        return Ok(None);
    };
    let Some(mask) = best.mask.as_ref() else {
        return Ok(None);
    };
    let props = StepStillProps {
        image_url: p.blobs.presign_get(&frame_key, p.url_ttl).await?,
        width: best.frame_w,
        height: best.frame_h,
        outline: p.masks.mask_path(mask, box_of(best)).await?,
    };
    let still = keys::guide_still(&guide.user_id, &guide.id, n);
    let out = p.blobs.presign_put(&still, p.url_ttl).await?;
    p.masks.step_still(&props, &out).await?;
    Ok(Some(still))
}

/// `voice`: each step's sentence spoken by MMS-TTS. Without a narrator, or when one step cannot
/// be spoken, that step simply has no audio (the app shows the text).
async fn speak_steps(p: &GuidePorts, guide: &Guide) -> Result<(), AppError> {
    let Some(narrator) = p.narrator.as_deref() else {
        return Ok(());
    };
    for step in p.store.steps(&guide.id).await? {
        if let Ok(voiced) = voice_step(p, (narrator, guide), step).await {
            p.store.put_step(&guide.id, &voiced).await?;
        }
    }
    Ok(())
}

async fn run_stage(p: &GuidePorts, guide: &Guide, stage: GuideStage) -> Result<(), AppError> {
    if stage == GuideStage::Ready {
        return p
            .progress(guide, (GuideStatus::Ready, Some(stage)), None)
            .await;
    }
    p.progress(guide, (GuideStatus::Running, Some(stage)), None)
        .await?;
    match stage {
        GuideStage::Steps => write_steps(p, guide).await,
        GuideStage::Frames => take_frames(p, guide).await,
        GuideStage::Highlight => circle_controls(p, guide).await,
        GuideStage::Voice | GuideStage::Ready => speak_steps(p, guide).await,
    }
}

async fn run_guide(p: &GuidePorts, job: &Job, step: &str) -> Result<(), AppError> {
    let stage = GuideStage::parse(step)?;
    let id = crate::domain::ids::GuideId::parse(job.subject_id.as_str())?;
    let Some(guide) = p.store.get(&id).await? else {
        return Ok(());
    };
    if guide.status == GuideStatus::Refused && stage != GuideStage::Steps {
        return Ok(());
    }
    run_stage(p, &guide, stage).await
}

async fn guide_failed(p: &GuidePorts, job: &Job, error: &AppError) -> Result<(), AppError> {
    let id = crate::domain::ids::GuideId::parse(job.subject_id.as_str())?;
    let Some(guide) = p.store.get(&id).await? else {
        return Ok(());
    };
    p.progress(&guide, (GuideStatus::Failed, None), Some(&error.message))
        .await
}

impl StepRunner for GuidePorts {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(run_guide(self, job, step))
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(guide_failed(self, job, error))
    }
}
