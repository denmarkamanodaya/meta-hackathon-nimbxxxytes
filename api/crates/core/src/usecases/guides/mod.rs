//! MyWay: a clip becomes a guide of numbered steps (a frame with the control circled, a spoken
//! instruction and a replay clip each), made by a `guide` job; the owner can edit a step and
//! delete the guide.

mod run;

use std::sync::Arc;
use std::time::Duration;

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::guide::{
    Guide, GuideStatus, GuideStep, LANGUAGE, MAX_CLIP_S, VOICE, edited_step, guide_title,
    narration, narration_hash, shown_reason,
};
use crate::domain::ids::{ClipId, GuideId, JobId, UserId};
use crate::domain::job::JobKind;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{
    BlobStore, Catalogue, Clock, GuideProgress, GuideStore, GuideWriter, IdGenerator, JobQueue,
    MaskRenderer, MediaTool, Narrator, NewJob, PutFile, Scratch, SubjectTracker,
};
use crate::time::format_utc;

/// Every port MyWay uses, bound once by the composition root; the request handlers and the
/// `guide` / `guide_pdf` jobs share it.
#[derive(Clone)]
pub struct GuidePorts {
    /// Guide rows.
    pub store: Arc<dyn GuideStore>,
    /// Clips, probes and transcripts.
    pub catalogue: Arc<dyn Catalogue>,
    /// Private objects.
    pub blobs: Arc<dyn BlobStore>,
    /// Working files.
    pub scratch: Arc<dyn Scratch>,
    /// Frames, the 360p copy and replay clips.
    pub media: Arc<dyn MediaTool>,
    /// The `guide` job.
    pub jobs: Arc<dyn JobQueue>,
    /// Spark writes the steps.
    pub writer: Arc<dyn GuideWriter>,
    /// SAM finds each step's control.
    pub tracker: Arc<dyn SubjectTracker>,
    /// The renderer's outline and step still.
    pub masks: Arc<dyn MaskRenderer>,
    /// MMS-TTS; `None` when `TTS_MODEL_DIR` is unset (steps then have no audio).
    pub narrator: Option<Arc<dyn Narrator>>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Ids.
    pub ids: Arc<dyn IdGenerator>,
    /// Lifetime of the URLs handed out.
    pub url_ttl: Duration,
}

/// A step as the app shows it; every URL is signed, `None` when that file was not made.
#[derive(Debug, Clone, PartialEq)]
pub struct StepView {
    /// 1-based number.
    pub n: u32,
    /// Title.
    pub title: String,
    /// Instruction.
    pub instruction: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// Key second.
    pub key_s: f64,
    /// The step image.
    pub image_url: Option<String>,
    /// The spoken instruction.
    pub audio_url: Option<String>,
    /// The replay clip.
    pub clip_url: Option<String>,
    /// The circled control's label; `None` when nothing is circled.
    pub highlight: Option<String>,
}

/// What a guide shows of its clip; both `None` when the clip is gone.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ClipFacts {
    /// The clip's title, once written.
    pub title: Option<String>,
    /// The clip's length, seconds.
    pub duration_s: Option<f64>,
}

/// A whole guide.
#[derive(Debug, Clone, PartialEq)]
pub struct GuideView {
    /// The guide row.
    pub guide: Guide,
    /// Spark's reason, shown only for `caution` and `not_supported`.
    pub safety_reason: Option<String>,
    /// Its clip.
    pub clip: ClipFacts,
    /// Its steps by number.
    pub steps: Vec<StepView>,
}

/// One row of the guides list.
#[derive(Debug, Clone, PartialEq)]
pub struct GuideSummaryView {
    /// The guide row.
    pub guide: Guide,
    /// Its clip.
    pub clip: ClipFacts,
    /// How many steps it has.
    pub step_count: u32,
    /// The first step's image, signed.
    pub cover_url: Option<String>,
}

/// What starting a guide answers.
#[derive(Debug, Clone, PartialEq)]
pub struct Started {
    /// The clip's guide.
    pub guide_id: GuideId,
    /// Its status now.
    pub status: GuideStatus,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

fn now(p: &GuidePorts) -> String {
    format_utc(p.clock.now_millis())
}

/// `user`'s guide.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub(crate) async fn owned(p: &GuidePorts, user: &UserId, id: &GuideId) -> Result<Guide, AppError> {
    let guide = p
        .store
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such iGuide"))?;
    if &guide.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "iGuide belongs to another user",
        ));
    }
    Ok(guide)
}

/// `user`'s ready clip of at most five minutes.
async fn guide_clip(p: &GuidePorts, user: &UserId, id: &ClipId) -> Result<Clip, AppError> {
    let clip = p
        .catalogue
        .get_clip(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such clip"))?;
    if &clip.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "clip belongs to another user",
        ));
    }
    let duration = clip.probe.as_ref().map(|pr| pr.duration_s);
    if clip.status != ClipStatus::Ready || duration.is_none() {
        return Err(invalid("the clip is still being processed"));
    }
    if duration.is_some_and(|d| d > MAX_CLIP_S) {
        return Err(invalid("iGuides need a clip of 5 minutes or less"));
    }
    Ok(clip)
}

/// Queues the clip's guide job (a finished or failed one runs again from its first step).
async fn queue(p: &GuidePorts, id: &GuideId) -> Result<(), AppError> {
    let ms = p.clock.now_millis();
    let job = JobId::parse(p.ids.new_id())?;
    p.jobs
        .enqueue(
            NewJob {
                id: &job,
                kind: JobKind::Guide,
                subject_id: id.as_str(),
            },
            ms,
        )
        .await?;
    p.jobs.restart(JobKind::Guide, id.as_str(), ms).await
}

/// Starts making the guide of `user`'s clip. Idempotent per clip: a clip with a guide answers
/// that guide, and only a failed one is queued again.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a clip not ready or over 5 minutes; store
/// and queue errors.
pub async fn start_guide(
    p: &GuidePorts,
    user: &UserId,
    clip: &ClipId,
) -> Result<Started, AppError> {
    let clip = guide_clip(p, user, clip).await?;
    if let Some(g) = p.store.for_clip(&clip.id).await? {
        return again(p, g).await;
    }
    let at = now(p);
    let guide = Guide {
        id: GuideId::parse(p.ids.new_id())?,
        user_id: clip.user_id.clone(),
        clip_id: clip.id.clone(),
        title: String::new(),
        status: GuideStatus::Queued,
        stage: None,
        safety: None,
        safety_reason: None,
        language: LANGUAGE.to_owned(),
        error: None,
        created_at: at.clone(),
        updated_at: at,
    };
    if !p.store.create(&guide).await? {
        let raced = p.store.for_clip(&clip.id).await?;
        let g = raced.ok_or_else(|| AppError::new(ErrorCode::Internal, "guide vanished"))?;
        return again(p, g).await;
    }
    queue(p, &guide.id).await?;
    Ok(Started {
        guide_id: guide.id,
        status: guide.status,
    })
}

/// The answer for a clip that already has guide `g`: a failed guide is queued again.
async fn again(p: &GuidePorts, g: Guide) -> Result<Started, AppError> {
    // Only a failed guide runs again; a queued, running, ready or refused one stays as it is.
    if g.status != GuideStatus::Failed {
        return Ok(Started {
            guide_id: g.id,
            status: g.status,
        });
    }
    let at = now(p);
    let progress = GuideProgress {
        status: GuideStatus::Queued,
        stage: None,
        error: None,
        at: &at,
    };
    p.store.set_progress(&g.id, progress).await?;
    queue(p, &g.id).await?;
    Ok(Started {
        guide_id: g.id,
        status: GuideStatus::Queued,
    })
}

async fn signed(p: &GuidePorts, key: Option<&ObjectKey>) -> Result<Option<String>, AppError> {
    match key {
        Some(k) => Ok(Some(p.blobs.presign_get(k, p.url_ttl).await?)),
        None => Ok(None),
    }
}

/// The clip's title and length; both `None` when the clip is gone.
async fn clip_facts(p: &GuidePorts, guide: &Guide) -> Result<ClipFacts, AppError> {
    Ok(p.catalogue
        .get_clip(&guide.clip_id)
        .await?
        .map(|c| ClipFacts {
            title: c.title,
            duration_s: c.probe.map(|pr| pr.duration_s),
        })
        .unwrap_or_default())
}

async fn step_view(p: &GuidePorts, s: GuideStep) -> Result<StepView, AppError> {
    Ok(StepView {
        image_url: signed(p, s.image_key.as_ref()).await?,
        audio_url: signed(p, s.audio_key.as_ref()).await?,
        clip_url: signed(p, s.clip_key.as_ref()).await?,
        n: s.n,
        title: s.title,
        instruction: s.instruction,
        start_s: s.start_s,
        end_s: s.end_s,
        key_s: s.key_s,
        highlight: s.highlight,
    })
}

/// `user`'s guide with every step.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store and storage errors.
pub async fn get_guide(p: &GuidePorts, user: &UserId, id: &GuideId) -> Result<GuideView, AppError> {
    let guide = owned(p, user, id).await?;
    let mut steps = Vec::new();
    for s in p.store.steps(id).await? {
        steps.push(step_view(p, s).await?);
    }
    Ok(GuideView {
        safety_reason: shown_reason(guide.safety, guide.safety_reason.as_deref()),
        clip: clip_facts(p, &guide).await?,
        guide,
        steps,
    })
}

/// `user`'s guides, newest first, each with its step count and first image.
///
/// # Errors
/// Store and storage errors.
pub async fn list_guides(p: &GuidePorts, user: &UserId) -> Result<Vec<GuideSummaryView>, AppError> {
    let mut out = Vec::new();
    for guide in p.store.list(user).await? {
        let steps = p.store.steps(&guide.id).await?;
        let cover = steps.first().and_then(|s| s.image_key.as_ref());
        out.push(GuideSummaryView {
            cover_url: signed(p, cover).await?,
            clip: clip_facts(p, &guide).await?,
            step_count: u32::try_from(steps.len()).unwrap_or(u32::MAX),
            guide,
        });
    }
    Ok(out)
}

/// The step's sentence spoken and stored (a sentence spoken before is found again, not spoken
/// twice); the step then points at it.
///
/// # Errors
/// `VALIDATION_FAILED` when nothing can be spoken; narrator, scratch and storage errors.
pub(crate) async fn voice_step(
    p: &GuidePorts,
    (narrator, guide): (&dyn Narrator, &Guide),
    mut step: GuideStep,
) -> Result<GuideStep, AppError> {
    let text = narration(step.n, &step.instruction);
    let hash = narration_hash(VOICE, &text);
    let key = keys::guide_audio(&guide.user_id, &guide.id, &hash);
    match p.blobs.object_size(&key).await {
        Ok(_) => {}
        Err(e) if e.code == ErrorCode::NotFound => {
            let wav = crate::usecases::narrate::narrate(narrator, &text).await?;
            let dir = p.scratch.clip_dir(&guide.clip_id).await?;
            let path = dir.join(format!("guide_{}_voice_{hash}.wav", guide.id));
            p.scratch.write_file(&path, &wav).await?;
            let put = PutFile {
                key: &key,
                path: &path,
                content_type: "audio/wav",
                class: None,
                cache_control: Some(DERIVED_CACHE_CONTROL),
            };
            p.blobs.put_file(put).await?;
        }
        Err(e) => return Err(e),
    }
    step.audio_key = Some(key);
    step.audio_text = Some(text);
    Ok(step)
}

/// What an edit of one step sends: either text or both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StepEdit<'a> {
    /// New title.
    pub title: Option<&'a str>,
    /// New instruction.
    pub instruction: Option<&'a str>,
}

/// Edits step `n` of `user`'s ready guide. Only that step's voice is spoken again, and only when
/// its sentence changed.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` without step `n`; `VALIDATION_FAILED` for a guide not
/// ready or a bad edit; narrator, store and storage errors.
pub async fn edit_step(
    p: &GuidePorts,
    user: &UserId,
    (id, n): (&GuideId, u32),
    edit: StepEdit<'_>,
) -> Result<StepView, AppError> {
    let guide = owned(p, user, id).await?;
    if guide.status != GuideStatus::Ready {
        return Err(invalid("only a ready iGuide can be edited"));
    }
    let mut step = p
        .store
        .steps(id)
        .await?
        .into_iter()
        .find(|s| s.n == n)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such step"))?;
    let (title, instruction) = edited_step(
        (&step.title, &step.instruction),
        (edit.title, edit.instruction),
    )?;
    (step.title, step.instruction) = (title, instruction);
    let step = revoiced(p, &guide, step).await?;
    p.store.put_step(id, &step).await?;
    step_view(p, step).await
}

/// `step` with its voice spoken again when its sentence changed (the old file is deleted).
async fn revoiced(p: &GuidePorts, guide: &Guide, step: GuideStep) -> Result<GuideStep, AppError> {
    let Some(narrator) = p.narrator.as_deref() else {
        return Ok(step);
    };
    if step.audio_text.as_deref() == Some(narration(step.n, &step.instruction).as_str()) {
        return Ok(step);
    }
    let old = step.audio_key.clone();
    let step = voice_step(p, (narrator, guide), step).await?;
    if let Some(old) = old.filter(|k| Some(k) != step.audio_key.as_ref()) {
        p.blobs.delete(&[old]).await?;
    }
    Ok(step)
}

/// Renames `user`'s guide and answers it in full.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for an empty or too-long title; store errors.
pub async fn rename_guide(
    p: &GuidePorts,
    user: &UserId,
    id: &GuideId,
    title: &str,
) -> Result<GuideView, AppError> {
    owned(p, user, id).await?;
    let title = guide_title(title)?;
    p.store.set_title(id, &title, &now(p)).await?;
    get_guide(p, user, id).await
}

/// Deletes `user`'s guide: its files, rows and job.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; storage, store and queue errors.
pub async fn delete_guide(p: &GuidePorts, user: &UserId, id: &GuideId) -> Result<(), AppError> {
    let guide = owned(p, user, id).await?;
    let steps = p.store.steps(id).await?;
    p.blobs
        .delete(&keys::guide_objects(&guide.user_id, id, &steps))
        .await?;
    p.store.delete(id).await?;
    p.jobs.cancel(JobKind::Guide, id.as_str()).await
}
