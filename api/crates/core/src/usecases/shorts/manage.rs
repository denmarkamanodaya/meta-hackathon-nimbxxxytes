//! What the shorts endpoints do: create, read, edit, render, download.

use std::collections::HashSet;
use std::time::Duration;

use super::{build_props, owned};
use crate::domain::ids::{JobId, SegmentId, ShortId, UserId};
use crate::domain::job::{JobKind, JobStatus};
use crate::domain::render::{Quality, ShortProps, render_subject};
use crate::domain::short::{
    NewStep, Short, ShortSegment, ShortStatus, Step, StepKind, Version, bounds,
};
use crate::domain::timeline::{Aspect, MAX_SHOTS, TARGET_RANGE_S, Timeline, fit};
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{BlobStore, Clock, IdGenerator, JobQueue, NewJob, ShortStore};
use crate::time::format_utc;

/// Longest accepted request text, characters.
pub const MAX_PROMPT_CHARS: usize = 500;

/// Ports the shorts endpoints need.
pub struct ShortDeps<'a> {
    /// Shorts, versions, steps.
    pub shorts: &'a dyn ShortStore,
    /// URLs.
    pub blobs: &'a dyn BlobStore,
    /// Agent and render jobs.
    pub jobs: &'a dyn JobQueue,
    /// New ids.
    pub ids: &'a dyn IdGenerator,
    /// Time.
    pub clock: &'a dyn Clock,
    /// Lifetime of the URLs handed out.
    pub url_ttl: Duration,
}

/// A short to create.
#[derive(Debug, Clone, PartialEq)]
pub struct NewShort {
    /// The owner's words; may be empty.
    pub prompt: String,
    /// Picked moments in pick order.
    pub segment_ids: Vec<SegmentId>,
    /// Output frame.
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

fn step(kind: StepKind, version: Option<u32>, summary: String, at: String) -> NewStep {
    NewStep {
        kind,
        tool: None,
        version,
        summary,
        at,
    }
}

/// The trimmed prompt when `new` is acceptable.
fn checked_prompt(new: &NewShort) -> Result<String, AppError> {
    let prompt = new.prompt.trim().to_owned();
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(invalid("prompt must be at most 500 characters"));
    }
    let ids = &new.segment_ids;
    let unique: HashSet<&SegmentId> = ids.iter().collect();
    if ids.is_empty() || ids.len() > MAX_SHOTS || unique.len() != ids.len() {
        return Err(invalid("segment_ids must be 1 to 20 different moments"));
    }
    if !(TARGET_RANGE_S.0..=TARGET_RANGE_S.1).contains(&new.target_s) {
        return Err(invalid("target_s must be 3 to 90"));
    }
    Ok(prompt)
}

/// `NOT_FOUND` for an unknown moment, `FORBIDDEN` for another user's.
async fn check_owners(
    shorts: &dyn ShortStore,
    user: &UserId,
    ids: &[SegmentId],
) -> Result<(), AppError> {
    let owners = shorts.segment_owners(ids).await?;
    for id in ids {
        match owners.iter().find(|(s, _)| s == id) {
            None => {
                return Err(AppError::new(
                    ErrorCode::NotFound,
                    format!("no moment {id}"),
                ));
            }
            Some((_, owner)) if owner != user => {
                return Err(AppError::new(
                    ErrorCode::Forbidden,
                    "moment belongs to another user",
                ));
            }
            Some(_) => {}
        }
    }
    Ok(())
}

/// Creates a short for `user` from moments they own and queues its agent job (plan, then
/// preview). Returns the new id.
///
/// # Errors
/// `VALIDATION_FAILED` for a prompt over 500 characters, 0 or more than 20 moments, a repeated
/// moment or a target outside 3–90 s; `NOT_FOUND` for an unknown moment; `FORBIDDEN` for
/// another user's moment.
pub async fn create_short(
    deps: &ShortDeps<'_>,
    user: &UserId,
    new: NewShort,
) -> Result<ShortId, AppError> {
    let prompt = checked_prompt(&new)?;
    let ids = &new.segment_ids;
    check_owners(deps.shorts, user, ids).await?;
    let now = deps.clock.now_millis();
    let short = Short {
        id: ShortId::parse(deps.ids.new_id())?,
        user_id: user.clone(),
        prompt,
        aspect: new.aspect,
        target_s: new.target_s,
        status: ShortStatus::Planning,
        best_version: None,
        render: None,
        created_at: format_utc(now),
    };
    deps.shorts.create(&short, ids).await?;
    let job = JobId::parse(deps.ids.new_id())?;
    let queued = NewJob {
        id: &job,
        kind: JobKind::Agent,
        subject_id: short.id.as_str(),
    };
    deps.jobs.enqueue(queued, now).await?;
    Ok(short.id)
}

/// One version with its preview URL and the Player's props.
#[derive(Debug, Clone, PartialEq)]
pub struct VersionView {
    /// The version.
    pub version: Version,
    /// Preview MP4, once rendered.
    pub preview_url: Option<String>,
    /// Props with presigned proxy URLs, exactly what a preview render receives.
    pub props: ShortProps,
}

/// A picked moment with its thumbnail.
#[derive(Debug, Clone, PartialEq)]
pub struct SegmentCard {
    /// The moment.
    pub segment: ShortSegment,
    /// Presigned thumbnail.
    pub thumb_url: String,
}

/// A short as its owner sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortView {
    /// The short.
    pub short: Short,
    /// Final render URL, once one finished.
    pub render_url: Option<String>,
    /// Versions in order.
    pub versions: Vec<VersionView>,
    /// Step log in order.
    pub steps: Vec<Step>,
    /// Picked moments in pick order.
    pub segments: Vec<SegmentCard>,
}

/// The short with every version, its Player props, the step log and the picked moments.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` from the ownership check; storage and signing errors.
pub async fn short_detail(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
) -> Result<ShortView, AppError> {
    let short = owned(deps.shorts, user, id).await?;
    let segments = deps.shorts.segments(id).await?;
    let ttl = deps.url_ttl;
    let render_url = match &short.render {
        Some((key, _)) => Some(deps.blobs.presign_get(key, ttl).await?),
        None => None,
    };
    let mut versions = Vec::new();
    for version in deps.shorts.versions(id).await? {
        let preview_url = match &version.preview_key {
            Some(key) => Some(deps.blobs.presign_get(key, ttl).await?),
            None => None,
        };
        let quality = (Quality::Preview, ttl);
        let props = build_props(deps.blobs, user, (&segments, &version.timeline), quality).await?;
        versions.push(VersionView {
            version,
            preview_url,
            props,
        });
    }
    let mut cards = Vec::with_capacity(segments.len());
    for segment in segments {
        let key = keys::thumb(user, &segment.clip_id, &segment.segment_id);
        let thumb_url = deps.blobs.presign_get(&key, ttl).await?;
        cards.push(SegmentCard { segment, thumb_url });
    }
    Ok(ShortView {
        short,
        render_url,
        versions,
        steps: deps.shorts.steps(id).await?,
        segments: cards,
    })
}

/// Saves the owner's edit as the next version, fitted to the picked moments; each fix the fit
/// made is logged. Returns the new version number.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` when the timeline cannot be fitted.
pub async fn save_timeline(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
    timeline: Timeline,
) -> Result<u32, AppError> {
    owned(deps.shorts, user, id).await?;
    let segments = deps.shorts.segments(id).await?;
    let (timeline, clamps) = fit(timeline, &bounds(&segments))?;
    let versions = deps.shorts.versions(id).await?;
    let n = versions.iter().map(|v| v.n).max().unwrap_or(0) + 1;
    deps.shorts.add_version(id, n, &timeline).await?;
    let at = format_utc(deps.clock.now_millis());
    let summary = format!("You edited the cut: version {n}");
    let mut log = vec![step(StepKind::Revise, Some(n), summary, at.clone())];
    log.extend(clamps.into_iter().map(|c| NewStep {
        tool: Some(super::steps::FIT_TOOL.to_owned()),
        ..step(StepKind::ToolResult, Some(n), c.note, at.clone())
    }));
    for s in &log {
        deps.shorts.add_step(id, s).await?;
    }
    Ok(n)
}

/// Queues the final render of version `n` and returns its job. A repeat request while it runs,
/// or after it finished for the same version, returns the same job; a failed render, or a
/// version that is no longer the rendered one, is queued again.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` for an unknown version.
pub async fn request_render(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
    n: u32,
) -> Result<JobId, AppError> {
    let short = owned(deps.shorts, user, id).await?;
    let versions = deps.shorts.versions(id).await?;
    if !versions.iter().any(|v| v.n == n) {
        return Err(AppError::new(
            ErrorCode::NotFound,
            format!("no version {n}"),
        ));
    }
    let subject = render_subject(id, n);
    let now = deps.clock.now_millis();
    let rendered_now = short.render.as_ref().is_some_and(|(_, v)| *v == n);
    match deps.jobs.find(JobKind::Render, &subject).await? {
        Some(job) if job.status == JobStatus::Done && rendered_now => return Ok(job.id),
        Some(job) if matches!(job.status, JobStatus::Queued | JobStatus::Running) => {
            return Ok(job.id);
        }
        Some(_) => deps.jobs.restart(JobKind::Render, &subject, now).await?,
        None => {
            let job = JobId::parse(deps.ids.new_id())?;
            let queued = NewJob {
                id: &job,
                kind: JobKind::Render,
                subject_id: &subject,
            };
            deps.jobs.enqueue(queued, now).await?;
        }
    }
    deps.shorts.set_render(id, None).await?;
    deps.jobs
        .find(JobKind::Render, &subject)
        .await?
        .map(|job| job.id)
        .ok_or_else(|| AppError::new(ErrorCode::Internal, "render job vanished"))
}

/// The step log of a short its owner watches.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` from the ownership check.
pub async fn short_steps(
    shorts: &dyn ShortStore,
    user: &UserId,
    id: &ShortId,
) -> Result<Vec<Step>, AppError> {
    owned(shorts, user, id).await?;
    shorts.steps(id).await
}

/// A URL that downloads the final render as a file.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `NOT_FOUND` when no final render finished yet.
pub async fn download_url(
    deps: &ShortDeps<'_>,
    user: &UserId,
    id: &ShortId,
) -> Result<String, AppError> {
    let short = owned(deps.shorts, user, id).await?;
    let (key, n) = short
        .render
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no final render yet"))?;
    let filename = format!("nimbytes-short-v{n}.mp4");
    deps.blobs
        .presign_download(&key, deps.url_ttl, &filename)
        .await
}
