//! Shorts: create one from picked moments, read it back with Player props, save manual edits,
//! queue final renders, hand out the download, remove one, and run the plan / preview / render job steps.

mod agent;
mod finish;
mod list;
mod lookup;
mod manage;
mod previews;
mod remove;
mod steps;

use std::collections::HashMap;
use std::time::Duration;

pub use finish::{short_finish, update_finish};
pub use list::{ShortListEntry, list_shorts};
pub use manage::{
    MAX_PROMPT_CHARS, NewShort, SegmentCard, ShortDeps, ShortView, VersionView, create_short,
    download_url, request_render, save_timeline, short_detail, short_steps,
};
pub use previews::{PreviewCleanupDeps, clean_previews};
pub use remove::delete_short;
pub use steps::{SearchPorts, ShortSteps};

use crate::domain::brand::theme_for;
use crate::domain::captions::segment_captions;
use crate::domain::ids::{SegmentId, ShortId, UserId};
use crate::domain::privacy::{blur_entries, finish_or_default};
use crate::domain::render::{Quality, ShortProps, ShotMedia, props};
use crate::domain::short::{Short, ShortSegment};
use crate::domain::timeline::Timeline;
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{BlobStore, BrandStore, PrivacyStore, ShortStore};
use crate::usecases::subjects::with_crop_paths;

/// The short if `user` owns it.
///
/// # Errors
/// `NOT_FOUND` when it does not exist, `FORBIDDEN` when another user owns it.
pub(crate) async fn owned(
    shorts: &dyn ShortStore,
    user: &UserId,
    id: &ShortId,
) -> Result<Short, AppError> {
    let short = shorts
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such short"))?;
    if &short.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "short belongs to another user",
        ));
    }
    Ok(short)
}

/// `props` with the faces to blur: the hidden tracks' boxes in the shots' segments, when the
/// short's finish (or its default) has blur on.
///
/// # Errors
/// Store errors.
pub(crate) async fn with_blur(
    privacy: &dyn PrivacyStore,
    short: &ShortId,
    mut props: ShortProps,
) -> Result<ShortProps, AppError> {
    let stored = privacy.finish(short).await?;
    let finish = finish_or_default(stored);
    let mut segments: Vec<SegmentId> = Vec::new();
    for c in &props.clips {
        if !segments.contains(&c.segment_id) {
            segments.push(c.segment_id.clone());
        }
    }
    if !finish.blur_bystanders || segments.is_empty() {
        return Ok(props);
    }
    let hidden = privacy.hidden_boxes(&segments).await?;
    props.blur = blur_entries(&segments, hidden, finish.blur_bystanders);
    Ok(props)
}

/// Whether the short's finish (or its default) keeps the subject in frame in 9:16 exports.
///
/// # Errors
/// Store errors.
pub(crate) async fn keeps_subject(
    privacy: &dyn PrivacyStore,
    short: &ShortId,
) -> Result<bool, AppError> {
    let stored = privacy.finish(short).await?;
    Ok(finish_or_default(stored).keep_subject)
}

/// `props` with each shot's camera path for a 9:16 frame, when the short keeps its subject in
/// frame and SAM features are wired; the Short page shows the same path the vertical export uses.
///
/// # Errors
/// Store errors.
pub(crate) async fn with_reframe(
    deps: &ShortDeps<'_>,
    version: (&ShortId, u32),
    cut: (&[ShortSegment], &Timeline),
    props: ShortProps,
) -> Result<ShortProps, AppError> {
    match deps.subjects {
        Some(sp) if keeps_subject(deps.privacy, version.0).await? => {
            with_crop_paths(sp, version, cut, props).await
        }
        _ => Ok(props),
    }
}

/// `props` themed by the owner's brand kit (its first colour and title font), or the defaults
/// when there is none.
///
/// # Errors
/// Store errors.
pub(crate) async fn with_theme(
    brand: &dyn BrandStore,
    user: &UserId,
    mut props: ShortProps,
) -> Result<ShortProps, AppError> {
    props.theme = theme_for(brand.brand_kit(user).await?.as_ref());
    Ok(props)
}

/// Composition props for `timeline`: proxies for previews (and the Player), originals for the
/// final render, each URL valid for `ttl`, plus the phrase captions of every shot's segment.
///
/// # Errors
/// Signing errors.
pub(crate) async fn build_props(
    blobs: &dyn BlobStore,
    user: &UserId,
    (segments, timeline): (&[ShortSegment], &Timeline),
    (quality, ttl): (Quality, Duration),
) -> Result<ShortProps, AppError> {
    let mut urls: HashMap<String, String> = HashMap::new();
    let mut media = Vec::with_capacity(timeline.clips.len());
    for shot in &timeline.clips {
        // A moment deleted after the cut was made (its clip re-segmented) is drawn as the
        // composition's placeholder instead of failing the whole short.
        let Some(seg) = segments.iter().find(|s| s.segment_id == shot.segment_id) else {
            media.push(ShotMedia {
                src_url: None,
                captions: Vec::new(),
            });
            continue;
        };
        let key = match quality {
            Quality::Preview => keys::proxy_720p(user, &seg.clip_id),
            Quality::Final => keys::original(user, &seg.clip_id, seg.clip_ext),
        };
        let url = match urls.get(key.as_str()) {
            Some(url) => url.clone(),
            None => {
                let url = blobs.presign_get(&key, ttl).await?;
                urls.insert(key.as_str().to_owned(), url.clone());
                url
            }
        };
        media.push(ShotMedia {
            src_url: Some(url),
            captions: segment_captions(seg.span, &seg.turns),
        });
    }
    props(timeline, media)
}
