//! Keep subject in frame: track each shot's subject over the shot at 12 fps, turn the track into a
//! camera path and store it per short, version and moment; read where that stands.

use super::{ClipFiles, SubjectPorts};
use crate::domain::export::export_version;
use crate::domain::ids::{ShortId, UserId};
use crate::domain::job::StepStatus;
use crate::domain::reframe::{
    REFRAME_FPS, ReframeStatus, ShotReframe, reframe_for, reframe_shots, reframe_status,
    reframe_step, tracked_shot,
};
use crate::domain::sam::{SamMedia, SamPrompt, SamRequest};
use crate::domain::segmenting::Span;
use crate::domain::short::{Short, Version};
use crate::domain::timeline::TimelineClip;
use crate::error::{AppError, ErrorCode};
use crate::ports::{ProgressSink, ShortStore, purpose};
use crate::time::format_utc;
use crate::usecases::shorts::ShortDeps;

/// Progress step names of a reframe run (`reframe` carries `n/m`).
pub mod step {
    /// The run finished.
    pub const DONE: &str = "reframe_done";
}

/// One followed shot as the Short page shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct ReframeShotView {
    /// The shot's moment.
    pub segment_id: crate::domain::ids::SegmentId,
    /// What it follows.
    pub subject: String,
    /// Frames the subject was seen in (0 before tracking).
    pub frames_tracked: u32,
    /// Frames of the shot (0 before tracking).
    pub frames_total: u32,
    /// Seconds out of view.
    pub lost_s: f64,
}

/// Where a short's reframe stands.
#[derive(Debug, Clone, PartialEq)]
pub struct ReframeView {
    /// Idle, running, ready or failed.
    pub status: ReframeStatus,
    /// The followed shots of the exported version.
    pub shots: Vec<ReframeShotView>,
}

async fn owned(shorts: &dyn ShortStore, user: &UserId, id: &ShortId) -> Result<Short, AppError> {
    crate::usecases::shorts::owned(shorts, user, id).await
}

/// The version a reframe follows: the one exports use.
async fn exported(shorts: &dyn ShortStore, short: &Short) -> Result<Option<Version>, AppError> {
    let versions = shorts.versions(&short.id).await?;
    let numbers: Vec<u32> = versions.iter().map(|v| v.n).collect();
    let n = export_version(short.best_version, &numbers);
    Ok(versions.into_iter().find(|v| Some(v.n) == n))
}

/// Checks that `user` may reframe the short; the caller then runs [`reframe_short`].
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a short without a version yet.
pub async fn reframe_requested(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
) -> Result<(), AppError> {
    let short = owned(deps.shorts, user, id).await?;
    if exported(deps.shorts, &short).await?.is_none() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "the short has no version to reframe yet",
        ));
    }
    Ok(())
}

/// The reframe of `user`'s short: `running` / `failed` come from the server's run tracker.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub async fn reframe_view(
    (deps, sp): (&ShortDeps<'_>, &SubjectPorts),
    user: &UserId,
    id: &ShortId,
    (running, failed): (bool, bool),
) -> Result<ReframeView, AppError> {
    let short = owned(deps.shorts, user, id).await?;
    let Some(version) = exported(deps.shorts, &short).await? else {
        return Ok(ReframeView {
            status: ReframeStatus::Idle,
            shots: Vec::new(),
        });
    };
    let rows = sp.store.reframes(id).await?;
    let followed = reframe_shots(&version.timeline.clips);
    let shots: Vec<ReframeShotView> = followed
        .iter()
        .map(|c| {
            let row = reframe_for(&rows, version.n, c);
            ReframeShotView {
                segment_id: c.segment_id.clone(),
                subject: c.subject.clone().unwrap_or_default().trim().to_owned(),
                frames_tracked: row.map_or(0, |r| r.frames_tracked),
                frames_total: row.map_or(0, |r| r.frames_total),
                lost_s: row.map_or(0.0, |r| r.lost_s),
            }
        })
        .collect();
    let with_rows = followed
        .iter()
        .filter(|c| reframe_for(&rows, version.n, c).is_some())
        .count();
    Ok(ReframeView {
        status: reframe_status(running, failed, followed.len(), with_rows),
        shots,
    })
}

/// Tracks every followed shot of the short's exported version that has no row for its subject
/// yet, emitting `reframe n/m` steps under the short's id, then `reframe_done`.
///
/// # Errors
/// Store, media and `MODEL_UNAVAILABLE` errors; the caller marks only this run failed.
pub async fn reframe_short(
    (deps, sp, progress): (&ShortDeps<'_>, &SubjectPorts, &dyn ProgressSink),
    id: &ShortId,
) -> Result<(), AppError> {
    let short = deps
        .shorts
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "the short was deleted"))?;
    let Some(version) = exported(deps.shorts, &short).await? else {
        return Ok(());
    };
    let segments = deps.shorts.segments(id).await?;
    let rows = sp.store.reframes(id).await?;
    let todo: Vec<&TimelineClip> = reframe_shots(&version.timeline.clips)
        .into_iter()
        .filter(|c| reframe_for(&rows, version.n, c).is_none())
        .collect();
    let files = ClipFiles {
        blobs: deps.blobs,
        scratch: deps.scratch,
    };
    for (i, shot) in todo.iter().enumerate() {
        let label = reframe_step(i, todo.len());
        progress.emit(id.as_str(), &label, StepStatus::Running);
        let Some(seg) = segments.iter().find(|s| s.segment_id == shot.segment_id) else {
            continue;
        };
        let row = track_shot(sp, &files, (&short, version.n, &seg.clip_id), shot).await?;
        let row = ShotReframe {
            updated_at: format_utc(deps.clock.now_millis()),
            ..row
        };
        sp.store.put_reframe(&row).await?;
    }
    progress.emit(id.as_str(), step::DONE, StepStatus::Done);
    Ok(())
}

/// One shot: a 12 fps range copy, SAM on its subject, the steadiest track, its camera path.
async fn track_shot(
    sp: &SubjectPorts,
    files: &ClipFiles<'_>,
    (short, n, clip): (&Short, u32, &crate::domain::ids::ClipId),
    shot: &TimelineClip,
) -> Result<ShotReframe, AppError> {
    let subject = shot
        .subject
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_owned();
    let span = Span {
        start_s: shot.in_s,
        end_s: shot.out_s,
    };
    let range = files
        .range(
            sp.media.as_ref(),
            (&short.user_id, clip),
            (span, REFRAME_FPS),
        )
        .await?;
    let request = SamRequest {
        media: SamMedia::Video(&range),
        prompt: SamPrompt::Concept(subject.clone()),
        propagation: None,
        purpose: purpose::REFRAME,
    };
    let records = sp.tracker.segment(&request).await?;
    let t = tracked_shot(&records, (shot.in_s, shot.out_s));
    Ok(ShotReframe {
        short_id: short.id.clone(),
        version_n: n,
        segment_id: shot.segment_id.clone(),
        subject,
        crop_path: t.crop_path,
        frames_tracked: t.frames_tracked,
        frames_total: t.frames_total,
        lost_s: t.lost_s,
        updated_at: String::new(),
    })
}
