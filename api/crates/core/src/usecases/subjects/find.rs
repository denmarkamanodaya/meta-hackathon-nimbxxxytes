//! Find this and Cut out: the owner taps a thing in a clip. Find this follows it through the clip
//! with SAM, embeds its best view with PE and finds the moments it shows up in again; Cut out cuts
//! it from the frame as a transparent PNG and a sticker.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{ClipFiles, SubjectPorts};
use crate::domain::clip::Clip;
use crate::domain::faces::{CropRect, Detection, FrameCrop, crop_rect};
use crate::domain::ids::{ClipId, SegmentId, UserId};
use crate::domain::objects::{
    FIND_K, FindMatch, PixelRect, box_rect, clean_label, fallback_crop, group_hits, in_view,
};
use crate::domain::render::{BoxRect, CutoutRequest, FrameSize};
use crate::domain::sam::{
    MaskEncoding, MaskRef, Propagation, SamMedia, SamPrompt, SamRecord, SamRequest, frame_at_time,
    largest, of_object, to_px,
};
use crate::domain::search::Candidate;
use crate::domain::segmenting::Span;
use crate::domain::storage_cap::images_estimate;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL};
use crate::ports::{
    BlobStore, Clock, Embedder, FaceMatchStore, IdGenerator, ObjectTrack, PutFile, Scratch,
    VectorIndex, purpose,
};
use crate::time::format_utc;
use crate::usecases::storage::{Quota, ensure_room};

/// Frame rate of the clip copy Find this runs on (the 1 fps copy made at ingest).
const FIND_FPS: u32 = 1;
/// SAM's id for the tapped object.
const TAPPED: u32 = 1;

/// Ports of Find this and Cut out.
pub struct FindDeps<'a> {
    /// SAM, media, stores, namer and mask work.
    pub sp: &'a SubjectPorts,
    /// Proxies, thumbnails and the cut-out PNGs.
    pub blobs: &'a dyn BlobStore,
    /// The clip's working files.
    pub scratch: &'a dyn Scratch,
    /// PE image embeddings.
    pub embedder: &'a dyn Embedder,
    /// Segment vectors.
    pub vectors: &'a dyn VectorIndex,
    /// The face matching switch (face vectors exist only while it is on).
    pub faces: &'a dyn FaceMatchStore,
    /// New ids.
    pub ids: &'a dyn IdGenerator,
    /// Time.
    pub clock: &'a dyn Clock,
    /// Lifetime of the URLs handed out.
    pub url_ttl: Duration,
    /// The storage cap (cut-outs write to the user's storage).
    pub quota: Quota<'a>,
}

/// Where the owner tapped: a clip second and a point as shares (0–1) of the displayed frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tap {
    /// Clip second.
    pub t_s: f64,
    /// Share of the width.
    pub x: f64,
    /// Share of the height.
    pub y: f64,
}

/// The tapped object's outline in the tapped frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Outline {
    /// SVG path in frame pixels.
    pub path: String,
    /// Frame width the path refers to.
    pub frame_w: u32,
    /// Frame height the path refers to.
    pub frame_h: u32,
}

/// One moment the object shows up in.
#[derive(Debug, Clone, PartialEq)]
pub struct FindHit {
    /// The clip.
    pub clip_id: ClipId,
    /// Its title.
    pub clip_title: String,
    /// When it was recorded.
    pub recorded_at: Option<String>,
    /// The moment.
    pub segment_id: SegmentId,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// Signed thumbnail of the moment.
    pub thumb_url: String,
    /// Similarity 0–1.
    pub score: f64,
}

/// What Find this answers.
#[derive(Debug, Clone, PartialEq)]
pub struct FindView {
    /// 1–3 lowercase words.
    pub label: String,
    /// Where the object is in view in the tapped clip.
    pub in_view: Span,
    /// Its outline in the tapped frame; `None` when SAM found nothing at the tap.
    pub outline: Option<Outline>,
    /// The tapped clip first, then other clips, best first (at most 12).
    pub hits: Vec<FindHit>,
}

/// What Cut out answers.
#[derive(Debug, Clone, PartialEq)]
pub struct CutoutView {
    /// 1–3 lowercase words.
    pub label: String,
    /// Signed transparent PNG.
    pub png_url: String,
    /// Signed sticker PNG (white outline).
    pub sticker_url: String,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// `user`'s ready clip and its upright size; the tap checked against it.
async fn tapped_clip(
    sp: &SubjectPorts,
    user: &UserId,
    id: &ClipId,
    tap: Tap,
) -> Result<Clip, AppError> {
    let clip = sp
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
    let probe = clip
        .probe
        .as_ref()
        .ok_or_else(|| invalid("the clip is still being processed"))?;
    let inside = |v: f64| (0.0..=1.0).contains(&v);
    if !(inside(tap.x) && inside(tap.y)) {
        return Err(invalid("x and y must be between 0 and 1"));
    }
    if !(tap.t_s >= 0.0 && tap.t_s <= probe.duration_s) {
        return Err(invalid("t_s must be inside the clip"));
    }
    Ok(clip)
}

fn files<'a>(deps: &'a FindDeps<'a>) -> ClipFiles<'a> {
    ClipFiles {
        blobs: deps.blobs,
        scratch: deps.scratch,
    }
}

/// The display size of a local video or image.
async fn size_of(sp: &SubjectPorts, path: &Path) -> Result<(u32, u32), AppError> {
    let p = sp.media.probe(path).await?;
    Ok((p.width.max(1), p.height.max(1)))
}

fn as_detection(r: &SamRecord) -> Detection {
    Detection {
        frame: r.frame,
        ordinal: r.id,
        bbox: r.bbox,
        frame_w: r.frame_w,
        frame_h: r.frame_h,
        conf: r.conf,
    }
}

fn square(r: PixelRect) -> CropRect {
    CropRect {
        x: r.x,
        y: r.y,
        side: r.w.min(r.h),
    }
}

pub(crate) fn box_of(r: &SamRecord) -> BoxRect {
    let p = box_rect(r);
    BoxRect {
        x1: p.x,
        y1: p.y,
        x2: p.x + p.w - 1,
        y2: p.y + p.h - 1,
    }
}

/// A 256 px crop of the proxy around `best` (SAM's best view), else around the tap.
async fn object_crop(
    deps: &FindDeps<'_>,
    (proxy, size): (&Path, (u32, u32)),
    best: Option<&SamRecord>,
    (tap, out): (Tap, &Path),
) -> Result<(), AppError> {
    let crop = match best {
        Some(r) => FrameCrop {
            at_s: f64::from(r.frame) / f64::from(FIND_FPS),
            rect: crop_rect(&as_detection(r), size.0, size.1),
        },
        None => FrameCrop {
            at_s: tap.t_s,
            rect: square(fallback_crop((tap.x, tap.y), size)),
        },
    };
    deps.sp.media.crop(proxy, crop, out).await
}

async fn label(sp: &SubjectPorts, crop: &Path) -> String {
    clean_label(&sp.namer.name_object(crop).await.unwrap_or_default())
}

/// Find this: follows the tapped object through the clip (SAM on the 1 fps copy, both ways from
/// the tapped second), embeds its largest view, and returns where it is in view, its outline,
/// its name and the moments it shows up in. When SAM finds nothing at the tap, a crop around the
/// tap is embedded instead and there is no outline. The object is stored so later taps find it.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a tap outside the clip or a clip still
/// being processed; media, embedding and store errors.
pub async fn find_this(
    deps: &FindDeps<'_>,
    user: &UserId,
    id: &ClipId,
    tap: Tap,
) -> Result<FindView, AppError> {
    let sp = deps.sp;
    let clip = tapped_clip(sp, user, id, tap).await?;
    let (track, frame) = follow_tap(deps, user, id, tap).await?;
    let best = largest(&track);
    let proxy = files(deps).proxy(user, id).await?;
    let size = size_of(sp, &proxy).await?;
    let dir = deps.scratch.clip_dir(id).await?;
    let crop = dir.join(format!("find_{}.jpg", deps.ids.new_id()));
    object_crop(deps, (&proxy, size), best, (tap, &crop)).await?;
    let vector = deps.embedder.embed_image(&crop).await?;
    let label = label(sp, &crop).await;
    let view = in_view(&track, FIND_FPS).unwrap_or(Span {
        start_s: tap.t_s.floor(),
        end_s: tap.t_s.floor() + 1.0,
    });
    let tapped = track.iter().find(|r| r.frame == frame).or(best);
    let outline = match tapped {
        Some(r) => outline_of(sp, r).await,
        None => None,
    };
    let hits = matches(deps, user, &vector).await?;
    let hits = resolve(deps, user, group_hits((&clip.id, Some(view)), hits)).await?;
    if best.is_some() {
        remember(deps, (&clip, tap, view), &label, &vector).await?;
    }
    Ok(FindView {
        label,
        in_view: view,
        outline,
        hits,
    })
}

/// SAM on the clip's 1 fps copy with a point at the tap, followed both ways: the tapped object's
/// records and the tapped frame. A failed call is treated like an empty answer, so the
/// tap-centred crop still finds moments.
async fn follow_tap(
    deps: &FindDeps<'_>,
    user: &UserId,
    id: &ClipId,
    tap: Tap,
) -> Result<(Vec<SamRecord>, u32), AppError> {
    let fps1 = deps.scratch.clip_dir(id).await?.join("sam_fps1.mp4");
    if !deps.scratch.exists(&fps1).await? {
        deps.blobs
            .get_to_file(&keys::proxy_fps1(user, id), &fps1)
            .await?;
    }
    let (w, h) = size_of(deps.sp, &fps1).await?;
    let frame = frame_at_time(tap.t_s, FIND_FPS);
    let request = SamRequest {
        media: SamMedia::Video(&fps1),
        prompt: tap_point(tap, frame, (w, h)),
        propagation: Some(Propagation::Both),
        purpose: purpose::FIND_OBJECT,
    };
    let records = deps.sp.tracker.segment(&request).await.unwrap_or_default();
    Ok((of_object(&records, TAPPED), frame))
}

/// Stores the tapped object and its vector so later taps find it.
async fn remember(
    deps: &FindDeps<'_>,
    (clip, tap, view): (&Clip, Tap, Span),
    label: &str,
    vector: &[f32],
) -> Result<(), AppError> {
    let track = ObjectTrack {
        id: deps.ids.new_id(),
        clip_id: clip.id.clone(),
        user_id: clip.user_id.clone(),
        label: label.to_owned(),
        t_s: tap.t_s,
        start_s: view.start_s,
        end_s: view.end_s,
        created_at: format_utc(deps.clock.now_millis()),
    };
    deps.sp.store.put_object(&track, vector).await
}

/// The record's outline from the renderer; `None` without a mask or when the renderer fails.
async fn outline_of(sp: &SubjectPorts, r: &SamRecord) -> Option<Outline> {
    let mask = r.mask.as_ref()?;
    let path = sp.masks.mask_path(mask, box_of(r)).await.ok()?;
    Some(Outline {
        path,
        frame_w: r.frame_w,
        frame_h: r.frame_h,
    })
}

/// Nearest moments, tapped objects and (with face matching on) faces.
async fn matches(
    deps: &FindDeps<'_>,
    user: &UserId,
    vector: &[f32],
) -> Result<Vec<FindMatch>, AppError> {
    let near = deps.vectors.nearest(user, vector, FIND_K).await?;
    let ids: Vec<SegmentId> = near.iter().map(|(s, _)| s.clone()).collect();
    let cands = deps.sp.catalogue.candidates(user, &ids).await?;
    let mut out: Vec<FindMatch> = near
        .iter()
        .filter_map(|(seg, distance)| {
            let c = cands.iter().find(|c| &c.segment_id == seg)?;
            Some(FindMatch {
                clip_id: c.clip_id.clone(),
                segment_id: Some(seg.clone()),
                span: Span {
                    start_s: c.start_s,
                    end_s: c.end_s,
                },
                score: (1.0 - distance).clamp(0.0, 1.0),
            })
        })
        .collect();
    out.extend(deps.sp.store.nearest_objects(user, vector, FIND_K).await?);
    if deps.faces.matching(user).await? {
        out.extend(deps.sp.store.nearest_faces(user, vector, FIND_K).await?);
    }
    Ok(out)
}

/// The match's moment: its own, else the clip's moment containing its start (else the first).
async fn moment_of(deps: &FindDeps<'_>, m: &FindMatch) -> Result<Option<SegmentId>, AppError> {
    if let Some(s) = &m.segment_id {
        return Ok(Some(s.clone()));
    }
    let segs = deps.sp.catalogue.list_segments(&m.clip_id).await?;
    Ok(segs
        .iter()
        .find(|s| s.span.start_s <= m.span.start_s && m.span.start_s < s.span.end_s)
        .or_else(|| segs.first())
        .map(|s| s.id.clone()))
}

/// Each grouped match as a moment card: its moment (the one containing the match's start for
/// object and face matches), the clip's title and a signed thumbnail. Matches outside the user's
/// library (or in duplicate clips) are dropped.
async fn resolve(
    deps: &FindDeps<'_>,
    user: &UserId,
    grouped: Vec<FindMatch>,
) -> Result<Vec<FindHit>, AppError> {
    let mut picked: Vec<(FindMatch, SegmentId)> = Vec::new();
    for m in grouped {
        if let Some(seg) = moment_of(deps, &m).await? {
            picked.push((m, seg));
        }
    }
    let ids: Vec<SegmentId> = picked.iter().map(|(_, s)| s.clone()).collect();
    let cards: HashMap<SegmentId, Candidate> = deps
        .sp
        .catalogue
        .candidates(user, &ids)
        .await?
        .into_iter()
        .map(|c| (c.segment_id.clone(), c))
        .collect();
    let mut out = Vec::with_capacity(picked.len());
    for (m, seg) in picked {
        let Some(card) = cards.get(&seg) else {
            continue;
        };
        let thumb = keys::thumb(user, &card.clip_id, &seg);
        out.push(FindHit {
            clip_id: card.clip_id.clone(),
            clip_title: card.clip_title.clone(),
            recorded_at: card.recorded_at.clone(),
            segment_id: seg,
            start_s: m.span.start_s,
            end_s: m.span.end_s,
            thumb_url: deps.blobs.presign_get(&thumb, deps.url_ttl).await?,
            score: m.score,
        });
    }
    Ok(out)
}

/// Uploads a local file the renderer reads.
async fn put_jpeg(
    blobs: &dyn BlobStore,
    key: &keys::ObjectKey,
    path: &Path,
) -> Result<(), AppError> {
    let put = PutFile {
        key,
        path,
        content_type: "image/jpeg",
        class: None,
        cache_control: Some(DERIVED_CACHE_CONTROL),
    };
    blobs.put_file(put).await
}

/// Cut out: SAM finds the tapped object in that frame (one image, a point prompt), and the
/// renderer cuts it out as a transparent PNG and a sticker.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a bad tap or nothing at the tap;
/// `STORAGE_FULL`; media, model, storage and `RENDER_FAILED` errors.
pub async fn cut_out(
    deps: &FindDeps<'_>,
    user: &UserId,
    id: &ClipId,
    tap: Tap,
) -> Result<CutoutView, AppError> {
    let sp = deps.sp;
    tapped_clip(sp, user, id, tap).await?;
    let proxy = files(deps).proxy(user, id).await?;
    let size = size_of(sp, &proxy).await?;
    let cut = deps.ids.new_id();
    let frame: PathBuf = deps
        .scratch
        .clip_dir(id)
        .await?
        .join(format!("cutout_{cut}.jpg"));
    sp.media.frame_at(&proxy, tap.t_s, &frame).await?;
    let request = SamRequest {
        media: SamMedia::Image(&frame),
        prompt: tap_point(tap, 0, size),
        propagation: None,
        purpose: purpose::CUTOUT,
    };
    let subject = masked_largest(sp.tracker.segment(&request).await?)
        .ok_or_else(|| invalid("nothing to cut out at that point"))?;
    ensure_room(
        deps.quota,
        (deps.blobs, deps.clock),
        user,
        images_estimate(3),
    )
    .await?;
    let frame_key = keys::cutout_frame(user, id, &cut);
    put_jpeg(deps.blobs, &frame_key, &frame).await?;
    let image_url = deps.blobs.presign_get(&frame_key, deps.url_ttl).await?;
    let (png_url, sticker_url) =
        pngs(deps, (user, id, &cut), cutout_request(image_url, &subject)).await?;
    let crop = frame.with_file_name(format!("cutout_{cut}_crop.jpg"));
    let label = subject_label(sp, (&proxy, size), (tap.t_s, &subject), &crop).await;
    Ok(CutoutView {
        label,
        png_url,
        sticker_url,
    })
}

/// Spark's name for `subject` at clip second `at_s`, from a crop of the proxy into `crop`;
/// `thing` when the crop or the call fails.
async fn subject_label(
    sp: &SubjectPorts,
    (proxy, size): (&Path, (u32, u32)),
    (at_s, subject): (f64, &SamRecord),
    crop: &Path,
) -> String {
    let named = FrameCrop {
        at_s,
        rect: crop_rect(&as_detection(subject), size.0, size.1),
    };
    match sp.media.crop(proxy, named, crop).await {
        Ok(()) => label(sp, crop).await,
        Err(_) => clean_label(""),
    }
}

/// A point prompt at the tap on frame `frame` of a `size` frame.
fn tap_point(tap: Tap, frame: u32, (w, h): (u32, u32)) -> SamPrompt {
    SamPrompt::Point {
        frame,
        id: TAPPED,
        x: to_px(tap.x, w),
        y: to_px(tap.y, h),
        w,
        h,
    }
}

/// The largest record that carries a mask.
pub(crate) fn masked_largest(records: Vec<SamRecord>) -> Option<SamRecord> {
    let masked: Vec<SamRecord> = records.into_iter().filter(|r| r.mask.is_some()).collect();
    largest(&masked).cloned()
}

/// What the renderer cuts out of the frame at `image_url`: `subject`'s mask and box.
pub(crate) fn cutout_request(image_url: String, subject: &SamRecord) -> CutoutRequest {
    CutoutRequest {
        image_url,
        frame: FrameSize {
            w: subject.frame_w,
            h: subject.frame_h,
        },
        mask: subject.mask.clone().unwrap_or_else(|| MaskRef {
            encoding: MaskEncoding::OneBit,
            width: 0,
            height: 0,
            payload: String::new(),
        }),
        bbox: box_of(subject),
        sticker: false,
    }
}

/// The plain cut-out and the sticker, written by the renderer; their signed URLs.
async fn pngs(
    deps: &FindDeps<'_>,
    (user, id, cut): (&UserId, &ClipId, &str),
    base: CutoutRequest,
) -> Result<(String, String), AppError> {
    let mut urls = Vec::with_capacity(2);
    for sticker in [false, true] {
        let key = keys::cutout_png(user, id, cut, sticker);
        let put = deps.blobs.presign_put(&key, deps.url_ttl).await?;
        let request = CutoutRequest {
            sticker,
            ..base.clone()
        };
        deps.sp.masks.cutout(&request, &put).await?;
        urls.push(deps.blobs.presign_get(&key, deps.url_ttl).await?);
    }
    let mut urls = urls.into_iter();
    Ok((
        urls.next().unwrap_or_default(),
        urls.next().unwrap_or_default(),
    ))
}
