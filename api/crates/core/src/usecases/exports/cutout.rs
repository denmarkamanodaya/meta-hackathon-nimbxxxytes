//! Cut-out covers: the real subject cut out of the hook frame with SAM, laid in front of the
//! title over a Muse Image scene of the same place (or the blurred frame). The layers are kept, so
//! the published cover is made again the same way when the title changes.

use std::path::Path;

use super::run::{hook_moment, source};
use super::{ExportDeps, export_of, invalid, step};
use crate::domain::brand::theme_for;
use crate::domain::cover::{CoverInfo, CoverStyle, CoverTitle, CutoutLayers, cover_slots};
use crate::domain::export::ExportAspect;
use crate::domain::ids::{ShortId, UserId};
use crate::domain::job::StepStatus;
use crate::domain::objects::{CutoutBackground, DEFAULT_CUTOUT_SUBJECT};
use crate::domain::production::Platform;
use crate::domain::render::{CoverStillProps, CutoutLayer, FrameSize, Theme, cover_still_props};
use crate::domain::sam::{SamMedia, SamPrompt, SamRecord, SamRequest};
use crate::domain::storage_cap::images_estimate;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, CutoutPart, DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{PutFile, SceneRequest, purpose};
use crate::usecases::subjects::{ClipFiles, SubjectPorts, box_of, masked_largest};

/// One cut-out cover the owner asked for: new cover `n` over `background`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CutoutPlan {
    /// The new cover's number.
    pub n: u32,
    /// What is behind the subject.
    pub background: CutoutBackground,
}

fn sam<'a>(deps: &ExportDeps<'a>) -> Result<&'a SubjectPorts, AppError> {
    deps.short.subjects.ok_or_else(|| {
        AppError::new(
            ErrorCode::ValidationFailed,
            "cut-out covers are not available here",
        )
    })
}

/// Checks a cut-out cover request (one new cover, the scene by default); the caller then runs
/// [`draw_cutout_cover`].
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` at 9 covers or without SAM;
/// `STORAGE_FULL`.
pub async fn cutout_requested(
    deps: &ExportDeps<'_>,
    user: &UserId,
    (id, platform): (&ShortId, Platform),
    background: Option<CutoutBackground>,
) -> Result<CutoutPlan, AppError> {
    sam(deps)?;
    let current = export_of(deps, user, id, platform).await?;
    let n = cover_slots(current.cover_keys.len(), 1)?.start;
    deps.short.ensure_room(user, images_estimate(3)).await?;
    Ok(CutoutPlan {
        n,
        background: background.unwrap_or(CutoutBackground::Scene),
    })
}

/// Makes one cut-out cover in the background. Progress: `covers`, then `done`, or a failed
/// `covers` step.
///
/// # Errors
/// Never; a failed cover is reported on the stream.
pub async fn draw_cutout_cover(
    deps: &ExportDeps<'_>,
    (id, platform): (&ShortId, Platform),
    plan: CutoutPlan,
) -> Result<(), AppError> {
    deps.emit(id, step::COVERS, StepStatus::Running);
    match cutout(deps, (id, platform), plan).await {
        Ok(()) => deps.emit(id, step::DONE, StepStatus::Done),
        Err(_) => deps.emit(id, step::COVERS, StepStatus::Failed),
    }
    Ok(())
}

async fn put(
    deps: &ExportDeps<'_>,
    (key, path): (&ObjectKey, &Path),
    content_type: &str,
) -> Result<(), AppError> {
    let put = PutFile {
        key,
        path,
        content_type,
        class: None,
        cache_control: Some(DERIVED_CACHE_CONTROL),
    };
    deps.short.blobs.put_file(put).await
}

async fn cutout(
    deps: &ExportDeps<'_>,
    (id, platform): (&ShortId, Platform),
    plan: CutoutPlan,
) -> Result<(), AppError> {
    let row = super::covers::row_of(deps, id, platform).await?;
    let src = source(deps, id, row.version_n).await?;
    let user = &src.short.user_id;
    let layers = cut_subject(deps, (&src, row.aspect), (platform, plan)).await?;
    let title = super::effective_title(row.cover_title.as_ref(), &row.caption, &src.short.prompt);
    let theme = theme_for(deps.short.brand.brand_kit(user).await?.as_ref());
    let props = layered_still(deps, (row.aspect, &title, theme), &layers).await?;
    let key = keys::cutout_cover(user, id, platform, plan.n);
    let out = deps.short.blobs.presign_put(&key, deps.media_ttl).await?;
    deps.renderer.still(&props, &out).await?;
    let info = CoverInfo {
        background: Some(plan.background),
        layers: Some(layers),
        ..CoverInfo::styled(CoverStyle::Cutout)
    };
    deps.exports.add_covers(id, platform, &[(key, info)]).await
}

/// The hook frame, its subject cut out by SAM (the first shot's subject, else a person), its
/// outline from the renderer, and the background: every layer stored.
async fn cut_subject(
    deps: &ExportDeps<'_>,
    (src, aspect): (&super::run::Source, ExportAspect),
    (platform, plan): (Platform, CutoutPlan),
) -> Result<CutoutLayers, AppError> {
    let sp = sam(deps)?;
    let (id, user) = (&src.short.id, &src.short.user_id);
    let dir = deps.short.scratch.short_dir(id).await?;
    let name = format!("cutout_{}_{}", platform.as_str(), plan.n);
    let frame = dir.join(format!("{name}.jpg"));
    let subject = hook_subject(deps, sp, src, &frame).await?;
    let bbox = box_of(&subject);
    let mask = subject.mask.as_ref().ok_or_else(|| invalid("no mask"))?;
    let path = sp.masks.mask_path(mask, bbox).await?;
    let frame_key = keys::cutout_layer(user, id, (platform, plan.n), CutoutPart::Frame);
    put(deps, (&frame_key, &frame), "image/jpeg").await?;
    let scene_key = match plan.background {
        CutoutBackground::Blur => None,
        CutoutBackground::Scene => {
            let key = keys::cutout_layer(user, id, (platform, plan.n), CutoutPart::Scene);
            let out = dir.join(format!("{name}_scene.webp"));
            draw_scene(deps, (aspect, &frame), (&key, &out)).await?;
            Some(key.as_str().to_owned())
        }
    };
    Ok(CutoutLayers {
        frame_key: frame_key.as_str().to_owned(),
        scene_key,
        frame: FrameSize {
            w: subject.frame_w,
            h: subject.frame_h,
        },
        path,
        bbox,
    })
}

/// The hook moment's middle frame written to `frame`, and SAM's largest masked subject in it.
async fn hook_subject(
    deps: &ExportDeps<'_>,
    sp: &SubjectPorts,
    src: &super::run::Source,
    frame: &Path,
) -> Result<SamRecord, AppError> {
    let hook = hook_moment(src).ok_or_else(|| invalid("the short has no moment to cut from"))?;
    let files = ClipFiles {
        blobs: deps.short.blobs,
        scratch: deps.short.scratch,
    };
    let proxy = files.proxy(&src.short.user_id, &hook.clip_id).await?;
    let at = f64::midpoint(hook.span.start_s, hook.span.end_s);
    sp.media.frame_at(&proxy, at, frame).await?;
    let request = SamRequest {
        media: SamMedia::Image(frame),
        prompt: SamPrompt::Concept(cutout_subject(src)),
        propagation: None,
        purpose: purpose::CUTOUT,
    };
    masked_largest(sp.tracker.segment(&request).await?)
        .ok_or_else(|| invalid("no subject found in the hook frame"))
}

/// Muse Image draws the frame's place without its subject into `out`, stored at `key`.
async fn draw_scene(
    deps: &ExportDeps<'_>,
    (aspect, frame): (ExportAspect, &Path),
    (key, out): (&ObjectKey, &Path),
) -> Result<(), AppError> {
    let scene = SceneRequest {
        aspect,
        frame: frame.to_path_buf(),
        out: out.to_path_buf(),
    };
    deps.images.draw_scene(&scene).await?;
    put(deps, (key, out), "image/webp").await
}

/// What SAM looks for in the hook frame: the first shot's subject, else a person.
fn cutout_subject(src: &super::run::Source) -> String {
    src.version
        .timeline
        .clips
        .first()
        .and_then(|c| c.subject.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CUTOUT_SUBJECT)
        .to_owned()
}

/// The still of a cut-out cover: the scene (or the blurred frame) behind, the title, and the
/// subject cut from the frame in front of it.
///
/// # Errors
/// Signing errors.
pub(super) async fn layered_still(
    deps: &ExportDeps<'_>,
    (aspect, title, theme): (ExportAspect, &CoverTitle, Theme),
    layers: &CutoutLayers,
) -> Result<CoverStillProps, AppError> {
    let (blobs, ttl) = (deps.short.blobs, deps.media_ttl);
    let frame_key = ObjectKey::from_stored(layers.frame_key.clone());
    let frame_url = blobs.presign_get(&frame_key, ttl).await?;
    let background = match &layers.scene_key {
        Some(k) => {
            blobs
                .presign_get(&ObjectKey::from_stored(k.clone()), ttl)
                .await?
        }
        None => frame_url.clone(),
    };
    let mut props = cover_still_props(background, aspect, title, theme);
    props.background_blur = layers.scene_key.is_none().then_some(true);
    props.cutout = Some(CutoutLayer {
        image_url: frame_url,
        frame: layers.frame,
        path: layers.path.clone(),
        bbox: layers.bbox,
    });
    Ok(props)
}
