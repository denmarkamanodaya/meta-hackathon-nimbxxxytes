//! The background part of a publish: one platform-pack call for every platform still without a
//! caption, 3 covers for every platform still without covers (a real frame of the strongest hook
//! moment plus the brand images as anchors), and one 9:16 render shared by TikTok, Reels and
//! Shorts. The feed's video is the short's own final render (queued by `start_exports`).

use std::ops::Range;
use std::path::{Path, PathBuf};

use super::{ExportDeps, step};
use crate::domain::brand::theme_for;
use crate::domain::cover::{CoverInfo, CoverStyle};
use crate::domain::export::Platform;
use crate::domain::export::{
    COVERS_PER_BATCH, ExportAspect, ExportStatus, ShortExport, caption_limit, clean_hashtags,
    fit_caption, hook_segment, is_vertical, render_plan,
};
use crate::domain::ids::ShortId;
use crate::domain::job::StepStatus;
use crate::domain::render::{Quality, ShortProps};
use crate::domain::short::{Short, ShortSegment, Version};
use crate::domain::storage_cap::{RENDER_ESTIMATE_BYTES, images_estimate};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL};
use crate::ports::{CoverRequest, PackAnswer, PackRequest, PutFile};
use crate::usecases::brand::local_anchors;
use crate::usecases::shorts::{build_props, keeps_subject, with_blur, with_theme};
use crate::usecases::subjects::{reframe_short, with_crop_paths, with_object_blur};

/// Most shot descriptions the platform pack sees.
const PACK_MOMENTS: usize = 8;

/// What a run works from: the short, the exported version and its picked moments.
pub(super) struct Source {
    pub(super) short: Short,
    pub(super) version: Version,
    segments: Vec<ShortSegment>,
}

/// A cover drawn into a local file, ready to upload as cover number `n`.
pub(super) struct DrawnCover<'a> {
    pub(super) n: u32,
    pub(super) out: &'a Path,
    pub(super) info: CoverInfo,
}

/// What every cover of a run shares: its anchors (a real frame first, then the brand images),
/// whether the second one is the logo, and the title band's colour.
struct CoverLook {
    anchors: Vec<PathBuf>,
    has_logo: bool,
    accent: String,
}

/// Covers to make for one platform.
struct CoverJob {
    platform: Platform,
    aspect: ExportAspect,
    numbers: Range<u32>,
    /// The owner's pick; `None` takes the three original looks by number.
    style: Option<CoverStyle>,
    caption: String,
}

impl ExportDeps<'_> {
    pub(super) fn emit(&self, id: &ShortId, step: &str, status: StepStatus) {
        self.progress.emit(id.as_str(), step, status);
    }
}

/// Runs the exports of `platforms` started by `start_exports` and records how they end; the
/// stream ends with `done`, or with a failed step whose exports are marked failed.
///
/// # Errors
/// Only store errors while recording a failure.
pub async fn run_exports(
    deps: &ExportDeps<'_>,
    id: &ShortId,
    platforms: &[Platform],
) -> Result<(), AppError> {
    match run(deps, id, platforms).await {
        Ok(()) => deps.emit(id, step::DONE, StepStatus::Done),
        Err(_) => {
            let vertical: Vec<Platform> = platforms
                .iter()
                .copied()
                .filter(|p| is_vertical(*p))
                .collect();
            deps.exports
                .set_render(id, &vertical, (ExportStatus::Failed, None))
                .await?;
            deps.emit(id, step::EXPORTS, StepStatus::Failed);
        }
    }
    Ok(())
}

async fn run(deps: &ExportDeps<'_>, id: &ShortId, platforms: &[Platform]) -> Result<(), AppError> {
    let rows: Vec<ShortExport> = deps
        .exports
        .exports(id)
        .await?
        .into_iter()
        .filter(|e| platforms.contains(&e.platform))
        .collect();
    let first = rows
        .first()
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no exports to run"))?;
    let source = source(deps, id, first.version_n).await?;
    pack(deps, &source, &rows).await?;
    let fresh = deps.exports.exports(id).await?;
    let jobs: Vec<CoverJob> = fresh
        .iter()
        .filter(|e| platforms.contains(&e.platform) && e.cover_keys.is_empty())
        .map(|e| CoverJob {
            platform: e.platform,
            aspect: e.aspect,
            numbers: 0..COVERS_PER_BATCH,
            style: None,
            caption: e.caption.clone(),
        })
        .collect();
    make_covers(deps, &source, &jobs).await?;
    if render_plan(platforms).vertical {
        vertical_render(deps, &source, platforms).await?;
    }
    Ok(())
}

pub(super) async fn source(
    deps: &ExportDeps<'_>,
    id: &ShortId,
    n: u32,
) -> Result<Source, AppError> {
    let shorts = deps.short.shorts;
    let short = shorts
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "the short was deleted"))?;
    let version = shorts
        .versions(id)
        .await?
        .into_iter()
        .find(|v| v.n == n)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, format!("no version {n}")))?;
    let segments = shorts.segments(id).await?;
    Ok(Source {
        short,
        version,
        segments,
    })
}

/// The picked moments in the version's play order (each once).
fn shot_segments(src: &Source) -> Vec<&ShortSegment> {
    let mut out: Vec<&ShortSegment> = Vec::new();
    for clip in &src.version.timeline.clips {
        if let Some(s) = src
            .segments
            .iter()
            .find(|s| s.segment_id == clip.segment_id)
            && !out.iter().any(|o| o.segment_id == s.segment_id)
        {
            out.push(s);
        }
    }
    out
}

/// Captions and hashtags for the exports still without a caption: one call for all of them,
/// the short's own post text when the call fails or skips a platform.
async fn pack(deps: &ExportDeps<'_>, src: &Source, rows: &[ShortExport]) -> Result<(), AppError> {
    let todo: Vec<Platform> = rows
        .iter()
        .filter(|e| e.caption.is_empty())
        .map(|e| e.platform)
        .collect();
    if todo.is_empty() {
        return Ok(());
    }
    let id = &src.short.id;
    deps.emit(id, step::PACK, StepStatus::Running);
    let post = &src.version.timeline.post;
    let moments: Vec<String> = shot_segments(src)
        .iter()
        .filter_map(|s| s.description.clone())
        .take(PACK_MOMENTS)
        .collect();
    let request = PackRequest {
        platforms: &todo,
        caption: &post.caption,
        hashtags: &post.hashtags,
        moments: &moments,
    };
    let answers = deps.pack.platform_pack(&request).await.unwrap_or_default();
    for p in todo {
        let (caption, hashtags) = pack_text(p, &answers, (&post.caption, &post.hashtags));
        deps.exports.set_text(id, p, (&caption, &hashtags)).await?;
    }
    deps.emit(id, step::PACK, StepStatus::Done);
    Ok(())
}

/// The model's caption and hashtags for `p`, else the short's own; fitted and cleaned.
fn pack_text(p: Platform, answers: &[PackAnswer], own: (&str, &[String])) -> (String, Vec<String>) {
    let (caption, tags) = answers
        .iter()
        .find(|a| a.platform == p)
        .map_or((own.0, own.1), |a| {
            (a.caption.as_str(), a.hashtags.as_slice())
        });
    (fit_caption(caption, caption_limit(p)), clean_hashtags(tags))
}

/// Draws and stores the covers of `jobs`, all at once, anchored on a real frame of the
/// strongest hook moment and the brand images. A failed cover is skipped.
async fn make_covers(
    deps: &ExportDeps<'_>,
    src: &Source,
    jobs: &[CoverJob],
) -> Result<(), AppError> {
    if jobs.is_empty() {
        return Ok(());
    }
    let id = &src.short.id;
    deps.emit(id, step::COVERS, StepStatus::Running);
    let look = cover_look(deps, src).await?;
    let dir = deps.short.scratch.short_dir(id).await?;
    let requests = cover_requests(jobs, &look, &dir);
    let results = deps.images.draw_covers(&requests).await?;
    let drawn: Vec<&CoverRequest> = requests
        .iter()
        .zip(&results)
        .filter_map(|(r, result)| result.is_ok().then_some(r))
        .collect();
    for j in jobs {
        let mine: Vec<DrawnCover<'_>> = drawn
            .iter()
            .filter(|r| r.platform == j.platform)
            .map(|r| DrawnCover {
                n: r.n,
                out: &r.out,
                info: CoverInfo::styled(r.style),
            })
            .collect();
        store_covers(deps, (&src.short, j.platform), &mine).await?;
    }
    deps.emit(id, step::COVERS, StepStatus::Done);
    Ok(())
}

/// One request per cover number of each job, in the job's style (by number when it has none).
fn cover_requests(jobs: &[CoverJob], look: &CoverLook, dir: &Path) -> Vec<CoverRequest> {
    jobs.iter()
        .flat_map(|j| {
            j.numbers.clone().map(|n| CoverRequest {
                platform: j.platform,
                aspect: j.aspect,
                n,
                style: j.style.unwrap_or_else(|| CoverStyle::by_number(n)),
                caption: j.caption.clone(),
                accent: look.accent.clone(),
                has_logo: look.has_logo,
                anchors: look.anchors.clone(),
                out: dir.join(format!("cover_{}_{n}.webp", j.platform.as_str())),
            })
        })
        .collect()
}

/// Uploads one platform's drawn covers and records them with how each was made (an upload that
/// fails is skipped); `STORAGE_FULL` when they no longer fit under the cap. Returns how many
/// were stored.
pub(super) async fn store_covers(
    deps: &ExportDeps<'_>,
    (short, platform): (&Short, Platform),
    drawn: &[DrawnCover<'_>],
) -> Result<usize, AppError> {
    let room = images_estimate(drawn.len());
    deps.short.ensure_room(&short.user_id, room).await?;
    let mut stored = Vec::with_capacity(drawn.len());
    for d in drawn {
        let key = keys::export_cover(&short.user_id, &short.id, platform, d.n);
        let put = PutFile {
            key: &key,
            path: d.out,
            content_type: "image/webp",
            class: None,
            cache_control: Some(DERIVED_CACHE_CONTROL),
        };
        if deps.short.blobs.put_file(put).await.is_ok() {
            stored.push((key, d.info.clone()));
        }
    }
    deps.exports
        .add_covers(&short.id, platform, &stored)
        .await?;
    Ok(stored.len())
}

/// The strongest hook moment of the version.
pub(super) fn hook_moment(src: &Source) -> Option<&ShortSegment> {
    hook_segment(&shot_segments(src), |s| s.hook_score)
}

/// The strongest hook moment's thumbnail (a real frame), downloaded into `dir`; `None` when the
/// short has no moment or the download fails.
pub(super) async fn hook_frame(deps: &ExportDeps<'_>, src: &Source, dir: &Path) -> Option<PathBuf> {
    let s = hook_moment(src)?;
    let path = dir.join("cover_frame.jpg");
    let thumb = keys::thumb(&src.short.user_id, &s.clip_id, &s.segment_id);
    deps.short
        .blobs
        .get_to_file(&thumb, &path)
        .await
        .is_ok()
        .then_some(path)
}

/// The cover anchors: the strongest hook moment's thumbnail (a real frame), then the brand
/// images.
async fn cover_look(deps: &ExportDeps<'_>, src: &Source) -> Result<CoverLook, AppError> {
    let user = &src.short.user_id;
    let dir = deps.short.scratch.short_dir(&src.short.id).await?;
    let mut anchors: Vec<PathBuf> = hook_frame(deps, src, &dir).await.into_iter().collect();
    let brand = local_anchors(deps.short.brand, deps.short.blobs, user, &dir).await?;
    // The logo is second only behind a real frame; without one, no anchor is called the logo.
    let has_logo = !anchors.is_empty() && brand.first().is_some_and(|p| is_logo(p));
    anchors.extend(brand);
    let kit = deps.short.brand.brand_kit(user).await?;
    Ok(CoverLook {
        anchors,
        has_logo,
        accent: theme_for(kit.as_ref()).accent,
    })
}

/// Whether a downloaded brand anchor is the logo (see `local_anchors`' file names).
fn is_logo(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("brand_logo."))
}

/// The SAM parts of the 9:16 render: screens and number plates blurred when the owner asked,
/// and, when the short keeps its subject in frame, a reframe of any shot not tracked yet (the
/// render waits for it; a failed reframe leaves those shots centred) and each shot's camera path.
async fn with_subjects(
    deps: &ExportDeps<'_>,
    src: &Source,
    props: ShortProps,
) -> Result<ShortProps, AppError> {
    let Some(sp) = deps.short.subjects else {
        return Ok(props);
    };
    let (id, timeline) = (&src.short.id, &src.version.timeline);
    let files = (deps.short.blobs, deps.short.scratch);
    let cut = (&src.short.user_id, src.segments.as_slice(), timeline);
    let props = with_object_blur(sp, files, cut, props).await?;
    if !keeps_subject(deps.short.privacy, id).await? {
        return Ok(props);
    }
    // Keep subject in frame never fails an export: untracked shots stay centred.
    let _ = reframe_short((&deps.short, sp, deps.progress), id).await;
    with_crop_paths(sp, (id, src.version.n), (&src.segments, timeline), props).await
}

/// Renders the exported version at 9:16 once, with the short's blur and brand theme, and gives
/// the video to every vertical platform asked for.
async fn vertical_render(
    deps: &ExportDeps<'_>,
    src: &Source,
    platforms: &[Platform],
) -> Result<(), AppError> {
    let (id, user) = (&src.short.id, &src.short.user_id);
    let vertical: Vec<Platform> = platforms
        .iter()
        .copied()
        .filter(|p| is_vertical(*p))
        .collect();
    deps.emit(id, step::RENDER, StepStatus::Running);
    deps.exports
        .set_render(id, &vertical, (ExportStatus::Rendering, None))
        .await?;
    let inputs = (Quality::Final, deps.media_ttl);
    let props = build_props(
        deps.short.blobs,
        user,
        (&src.segments, &src.version.timeline),
        inputs,
    )
    .await?;
    let props = with_blur(deps.short.privacy, id, props).await?;
    let props = with_theme(deps.short.brand, user, props).await?;
    let mut props = with_subjects(deps, src, props).await?;
    props.export_aspect = Some(ExportAspect::Vertical);
    let key = keys::export_vertical(user, id);
    deps.short.ensure_room(user, RENDER_ESTIMATE_BYTES).await?;
    let url = deps.short.blobs.presign_put(&key, deps.media_ttl).await?;
    deps.renderer.render(&props, Quality::Final, &url).await?;
    deps.exports
        .set_render(id, &vertical, (ExportStatus::Ready, Some(&key)))
        .await?;
    deps.emit(id, step::RENDER, StepStatus::Done);
    Ok(())
}

/// Draws covers `numbers` for one platform (the owner asked for more), in `style` when given,
/// and records how it ended.
///
/// # Errors
/// Only store errors while recording the outcome.
pub async fn draw_more_covers(
    deps: &ExportDeps<'_>,
    (id, platform): (&ShortId, Platform),
    numbers: Range<u32>,
    style: Option<CoverStyle>,
) -> Result<(), AppError> {
    let outcome = async {
        let row = deps
            .exports
            .exports(id)
            .await?
            .into_iter()
            .find(|e| e.platform == platform)
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no export for that platform"))?;
        let src = source(deps, id, row.version_n).await?;
        let job = CoverJob {
            platform,
            aspect: row.aspect,
            numbers,
            style,
            caption: row.caption,
        };
        make_covers(deps, &src, &[job]).await
    };
    match outcome.await {
        Ok(()) => deps.emit(id, step::DONE, StepStatus::Done),
        Err(_) => deps.emit(id, step::COVERS, StepStatus::Failed),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_platform_the_pack_skipped_falls_back_to_the_shorts_own_text_fitted_and_cleaned() {
        let answers = [PackAnswer {
            platform: Platform::Tiktok,
            caption: "Morning run".into(),
            hashtags: vec!["run".into(), "#Run".into()],
        }];
        let own_tags = vec!["#pov".to_owned()];
        let long = "word ".repeat(40);

        let tiktok = pack_text(Platform::Tiktok, &answers, (&long, &own_tags));
        let shorts = pack_text(Platform::Shorts, &answers, (&long, &own_tags));

        assert_eq!(tiktok, ("Morning run".to_owned(), vec!["#run".to_owned()]));
        assert!(shorts.0.chars().count() <= 100 && shorts.0.ends_with('…'));
        assert_eq!(shorts.1, ["#pov"]);
    }
}
