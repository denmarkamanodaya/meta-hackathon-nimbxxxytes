//! Library and clip screens: catalogue rows plus presigned URLs, for the owner only.

use std::time::Duration;

use crate::domain::clip::Clip;
use crate::domain::ids::{ClipId, SegmentId, UserId};
use crate::domain::index::{ClipDetailRows, DocScope, LibraryRow};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::{BlobStore, Catalogue, Clock, TextIndex};
use crate::time::format_utc;

/// Ports and settings the screens need.
pub struct LibraryDeps<'a> {
    /// Rows.
    pub catalogue: &'a dyn Catalogue,
    /// URL signing.
    pub blobs: &'a dyn BlobStore,
    /// Lifetime of every URL handed to the client.
    pub url_ttl: Duration,
    /// When the owner opens a clip (its original counts as accessed for the storage tiers).
    pub clock: &'a dyn Clock,
}

/// A library card: the row plus its thumbnail URL.
#[derive(Debug, Clone, PartialEq)]
pub struct LibraryCard {
    /// The row.
    pub row: LibraryRow,
    /// First segment's thumbnail.
    pub thumb_url: Option<String>,
}

/// The clip screen with every URL signed.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipDetailView {
    /// Catalogue rows.
    pub rows: ClipDetailRows,
    /// Thumbnail of the first segment (card image).
    pub thumb_url: Option<String>,
    /// Proxy video; present once the clip has segments (the proxy is made before them).
    pub proxy_url: Option<String>,
    /// Thumbnail URL per segment, in `rows.segments` order.
    pub segment_thumbs: Vec<String>,
    /// Crop URL per track, in `rows.tracks` order.
    pub track_crops: Vec<Option<String>>,
}

async fn sign(deps: &LibraryDeps<'_>, key: &ObjectKey) -> Result<String, AppError> {
    deps.blobs.presign_get(key, deps.url_ttl).await
}

async fn first_thumb(
    deps: &LibraryDeps<'_>,
    clip: &Clip,
    first: Option<&SegmentId>,
) -> Result<Option<String>, AppError> {
    match first {
        Some(seg) => Ok(Some(
            sign(deps, &keys::thumb(&clip.user_id, &clip.id, seg)).await?,
        )),
        None => Ok(None),
    }
}

/// The signed-in user's library, newest first.
///
/// # Errors
/// Catalogue and signing errors pass through.
pub async fn library(deps: &LibraryDeps<'_>, user: &UserId) -> Result<Vec<LibraryCard>, AppError> {
    let mut cards = Vec::new();
    for row in deps.catalogue.library(user).await? {
        let thumb_url = first_thumb(deps, &row.clip, row.first_segment.as_ref()).await?;
        cards.push(LibraryCard { row, thumb_url });
    }
    Ok(cards)
}

/// The clip's rows if `user` owns it; records the opening as the clip's last view.
async fn opened(
    deps: &LibraryDeps<'_>,
    user: &UserId,
    id: &ClipId,
) -> Result<ClipDetailRows, AppError> {
    let rows = deps
        .catalogue
        .clip_detail(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such clip"))?;
    if &rows.row.clip.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "clip belongs to another user",
        ));
    }
    let now = format_utc(deps.clock.now_millis());
    deps.catalogue.mark_viewed(id, &now).await?;
    Ok(rows)
}

/// One clip for its owner, with signed thumbnail, proxy and face-crop URLs. Opening it records
/// the time as the clip's last view.
///
/// # Errors
/// `NOT_FOUND` for an unknown clip, `FORBIDDEN` for another user's; others pass through.
pub async fn clip_detail(
    deps: &LibraryDeps<'_>,
    user: &UserId,
    id: &ClipId,
) -> Result<ClipDetailView, AppError> {
    let rows = opened(deps, user, id).await?;
    let clip = &rows.row.clip;
    let mut segment_thumbs = Vec::with_capacity(rows.segments.len());
    for s in &rows.segments {
        segment_thumbs
            .push(sign(deps, &keys::thumb(&clip.user_id, &clip.id, &s.segment.id)).await?);
    }
    let mut track_crops = Vec::with_capacity(rows.tracks.len());
    for t in &rows.tracks {
        let url = match &t.crop_key {
            Some(k) => Some(sign(deps, &ObjectKey::from_stored(k.clone())).await?),
            None => None,
        };
        track_crops.push(url);
    }
    let proxy_url = if rows.segments.is_empty() {
        None
    } else {
        Some(sign(deps, &keys::proxy_720p(&clip.user_id, &clip.id)).await?)
    };
    let thumb_url = segment_thumbs.first().cloned();
    Ok(ClipDetailView {
        rows,
        thumb_url,
        proxy_url,
        segment_thumbs,
        track_crops,
    })
}

/// Rebuilds one segment's search document (after a person or speaker name changes).
///
/// # Errors
/// Catalogue and index errors pass through.
pub async fn reindex_segment(
    catalogue: &dyn Catalogue,
    index: &dyn TextIndex,
    id: &SegmentId,
) -> Result<(), AppError> {
    let docs = catalogue.index_docs(DocScope::Segment(id)).await?;
    index.upsert(&docs).await
}
