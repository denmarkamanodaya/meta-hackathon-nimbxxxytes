//! SAM 3.1 features on top of the library: screens and number plates blurred in renders, keep
//! subject in frame for 9:16 exports, Find this, and cut-outs. Each SAM call runs on a short
//! copy of the clip's proxy made on the box (and kept there, so a repeat call sends the same bytes
//! and the model cache answers it).

mod find;
mod reframe;

use std::path::PathBuf;
use std::sync::Arc;

use crate::domain::ids::{ClipId, SegmentId, UserId};
use crate::domain::objects::{BLUR_CONCEPTS, BLUR_FPS, MAX_BLUR_SHOTS, object_blur};
use crate::domain::reframe::{reframe_for, shot_cameras};
use crate::domain::render::{ShortProps, with_cameras};
use crate::domain::sam::{SamMedia, SamPrompt, SamRequest};
use crate::domain::segmenting::Span;
use crate::domain::short::ShortSegment;
use crate::domain::timeline::Timeline;
use crate::error::AppError;
use crate::keys;
use crate::ports::{
    BlobStore, Catalogue, MaskRenderer, MediaTool, ObjectNamer, Scratch, SubjectStore,
    SubjectTracker, purpose,
};

pub use find::{CutoutView, FindDeps, FindHit, FindView, Outline, Tap, cut_out, find_this};
pub(crate) use find::{box_of, masked_largest};
pub use reframe::{ReframeShotView, ReframeView, reframe_requested, reframe_short, reframe_view};

/// The ports every SAM feature shares, bound once by the composition root.
#[derive(Clone)]
pub struct SubjectPorts {
    /// SAM 3.1.
    pub tracker: Arc<dyn SubjectTracker>,
    /// Range proxies and frames.
    pub media: Arc<dyn MediaTool>,
    /// Blur switch, reframe rows and tapped objects.
    pub store: Arc<dyn SubjectStore>,
    /// Clips (probe sizes, segments).
    pub catalogue: Arc<dyn Catalogue>,
    /// Spark names tapped objects.
    pub namer: Arc<dyn ObjectNamer>,
    /// The renderer's mask work.
    pub masks: Arc<dyn MaskRenderer>,
}

/// Where the proxy and the range copies of a clip are kept on the box.
pub(crate) struct ClipFiles<'a> {
    pub(crate) blobs: &'a dyn BlobStore,
    pub(crate) scratch: &'a dyn Scratch,
}

impl ClipFiles<'_> {
    /// The clip's proxy on the box, downloaded once.
    pub(crate) async fn proxy(&self, user: &UserId, clip: &ClipId) -> Result<PathBuf, AppError> {
        let path = self.scratch.clip_dir(clip).await?.join("sam_proxy.mp4");
        if !self.scratch.exists(&path).await? {
            self.blobs
                .get_to_file(&keys::proxy_720p(user, clip), &path)
                .await?;
        }
        Ok(path)
    }

    /// `span` of the clip's proxy at `fps`, made once and kept on the box.
    pub(crate) async fn range(
        &self,
        media: &dyn MediaTool,
        (user, clip): (&UserId, &ClipId),
        (span, fps): (Span, u32),
    ) -> Result<PathBuf, AppError> {
        let name = format!(
            "sam_range_{}_{}_{fps}.mp4",
            (span.start_s * 1000.0).round(),
            (span.end_s * 1000.0).round()
        );
        let path = self.scratch.clip_dir(clip).await?.join(name);
        if !self.scratch.exists(&path).await? {
            let proxy = self.proxy(user, clip).await?;
            media.range_proxy(&proxy, (span, fps), &path).await?;
        }
        Ok(path)
    }
}

/// `props` with the screens and number plates of each shot added to its blur, when the owner
/// turned that on: SAM looks for each phrase in the shot's range at 10 fps (at most 20 shots).
/// A shot whose lookup fails is left as it is; this never fails a render.
///
/// # Errors
/// Only reading the switch.
pub async fn with_object_blur(
    sp: &SubjectPorts,
    files: (&dyn BlobStore, &dyn Scratch),
    (user, segments, timeline): (&UserId, &[ShortSegment], &Timeline),
    mut props: ShortProps,
) -> Result<ShortProps, AppError> {
    if !sp.store.blur_objects(user).await? {
        return Ok(props);
    }
    let files = ClipFiles {
        blobs: files.0,
        scratch: files.1,
    };
    for shot in timeline.clips.iter().take(MAX_BLUR_SHOTS) {
        let Some(seg) = segments.iter().find(|s| s.segment_id == shot.segment_id) else {
            continue;
        };
        let span = Span {
            start_s: shot.in_s,
            end_s: shot.out_s,
        };
        let Ok(range) = files
            .range(sp.media.as_ref(), (user, &seg.clip_id), (span, BLUR_FPS))
            .await
        else {
            continue;
        };
        for phrase in BLUR_CONCEPTS {
            let request = SamRequest {
                media: SamMedia::Video(&range),
                prompt: SamPrompt::Concept(phrase.to_owned()),
                propagation: None,
                purpose: purpose::BLUR_OBJECTS,
            };
            if let Ok(records) = sp.tracker.segment(&request).await {
                props
                    .blur
                    .extend(object_blur(&shot.segment_id, shot.in_s, &records));
            }
        }
    }
    Ok(props)
}

/// `props` with each shot's camera path, for a 9:16 frame of a short whose finish keeps the
/// subject in frame: a shot gets its reframe row's path (and the source's width / height, which
/// the renderer needs with it) when one exists for its subject; others keep the centred crop.
///
/// # Errors
/// Store errors.
pub async fn with_crop_paths(
    sp: &SubjectPorts,
    (short, version_n): (&crate::domain::ids::ShortId, u32),
    (segments, timeline): (&[ShortSegment], &Timeline),
    props: ShortProps,
) -> Result<ShortProps, AppError> {
    let rows = sp.store.reframes(short).await?;
    if rows.is_empty() {
        return Ok(props);
    }
    // The upright source size of every clip a shot with a row comes from (rotation applied).
    let mut aspects: Vec<(SegmentId, f64)> = Vec::new();
    for shot in &timeline.clips {
        if reframe_for(&rows, version_n, shot).is_none() {
            continue;
        }
        let Some(seg) = segments.iter().find(|s| s.segment_id == shot.segment_id) else {
            continue;
        };
        let probe = sp
            .catalogue
            .get_clip(&seg.clip_id)
            .await?
            .and_then(|c| c.probe);
        if let Some(p) = probe.filter(|p| p.width > 0 && p.height > 0) {
            aspects.push((
                shot.segment_id.clone(),
                f64::from(p.width) / f64::from(p.height),
            ));
        }
    }
    let aspect_of = |id: &SegmentId| aspects.iter().find(|(s, _)| s == id).map(|(_, a)| *a);
    let cameras = shot_cameras(&rows, version_n, &timeline.clips, aspect_of);
    Ok(with_cameras(props, cameras))
}
