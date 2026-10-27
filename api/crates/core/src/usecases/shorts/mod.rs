//! Shorts: create one from picked moments, read it back with Player props, save manual edits,
//! queue final renders, hand out the download, remove one, and run the plan / preview / render job steps.

mod agent;
mod list;
mod lookup;
mod manage;
mod previews;
mod remove;
mod steps;

use std::collections::HashMap;
use std::time::Duration;

pub use list::{ShortListEntry, list_shorts};
pub use manage::{
    MAX_PROMPT_CHARS, NewShort, SegmentCard, ShortDeps, ShortView, VersionView, create_short,
    download_url, request_render, save_timeline, short_detail, short_steps,
};
pub use previews::{PreviewCleanupDeps, clean_previews};
pub use remove::delete_short;
pub use steps::{SearchPorts, ShortSteps};

use crate::domain::captions::segment_captions;
use crate::domain::ids::{ShortId, UserId};
use crate::domain::render::{Quality, ShortProps, ShotMedia, props};
use crate::domain::short::{Short, ShortSegment};
use crate::domain::timeline::Timeline;
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{BlobStore, ShortStore};

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
