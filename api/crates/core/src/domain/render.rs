//! Props of the `NimbytesShort` composition: what the renderer and the browser Player receive.
//! The server builds them from a fitted timeline, phrase captions and presigned media URLs; the
//! renderer validates the same shape against `render/fixtures/props.sample.json`.

use serde::{Deserialize, Serialize};

use crate::domain::captions::Caption;
use crate::domain::cover::{CoverTitle, TitlePosition};
use crate::domain::export::ExportAspect;
use crate::domain::ids::{SegmentId, ShortId};
use crate::domain::privacy::SegmentBlur;
use crate::domain::reframe::CropKey;
use crate::domain::sam::MaskRef;
use crate::domain::timeline::{Aspect, CaptionStyle, Post, Timeline, TimelineClip};
use crate::error::{AppError, ErrorCode};

/// Frames per second of every short.
pub const FPS: u32 = 30;
/// Seconds of the closing card with the post caption.
pub const END_CARD_S: f64 = 1.0;
/// Accent drawn in the video (the active caption word's highlight, the end card and placeholder
/// glow): the app's `--video-accent` design token, the caption highlight of the approved design.
pub const VIDEO_ACCENT: &str = "#FFE58A";
/// Font stack drawn in the video.
pub const VIDEO_FONT: &str =
    "Inter, -apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";

/// Render size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    /// Low-res preview from proxies, for the agent to watch.
    Preview,
    /// Full-size final from the originals.
    Final,
}

/// Colours and font of the video.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Theme {
    /// `#rrggbb`.
    pub accent: String,
    /// CSS font-family stack.
    pub font: String,
}

/// One shot as the composition draws it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropsClip {
    /// Segment the shot comes from.
    pub segment_id: SegmentId,
    /// Presigned video URL; `None` draws a placeholder.
    pub src_url: Option<String>,
    /// Start, source seconds.
    pub in_s: f64,
    /// End, source seconds.
    pub out_s: f64,
    /// Zoom, 1.0 = none.
    pub punch_in: f64,
    /// What the shot is about.
    pub subject: Option<String>,
    /// The camera path that keeps the subject in a 9:16 frame (clip seconds, crop centres as
    /// shares of the upright source); absent for the centred crop.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop_path: Option<Vec<CropKey>>,
    /// Width / height of the upright source; sent whenever `crop_path` is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_aspect: Option<f64>,
    /// Phrases spoken in the shot's segment, source seconds.
    pub captions: Vec<Caption>,
}

/// Everything the composition needs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShortProps {
    /// Output frame.
    pub aspect: Aspect,
    /// Always [`FPS`].
    pub fps: u32,
    /// Shots in play order (at least one).
    pub clips: Vec<PropsClip>,
    /// Post text for the end card.
    pub post: Post,
    /// End card length, 0–3 s.
    pub end_card_s: f64,
    /// Colours and font.
    pub theme: Theme,
    /// Faces to blur: hidden tracks' boxes per segment (absent on the wire when empty, so older
    /// props stay valid).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blur: Vec<SegmentBlur>,
    /// The export frame when it differs from `aspect` (a 9:16 export of a 4:5 short); absent for
    /// the short itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_aspect: Option<ExportAspect>,
}

/// Media for one shot, in timeline order.
#[derive(Debug, Clone, PartialEq)]
pub struct ShotMedia {
    /// Presigned URL of the shot's source video.
    pub src_url: Option<String>,
    /// Phrases of the shot's segment.
    pub captions: Vec<Caption>,
}

/// One shot as drawn: centred (no camera path), captions only when they are on.
fn props_clip(c: &TimelineClip, m: ShotMedia, captions_on: bool) -> PropsClip {
    PropsClip {
        segment_id: c.segment_id.clone(),
        src_url: m.src_url,
        in_s: c.in_s,
        out_s: c.out_s,
        punch_in: c.punch_in,
        subject: c.subject.clone(),
        crop_path: None,
        source_aspect: None,
        captions: if captions_on { m.captions } else { Vec::new() },
    }
}

/// Builds the props for a fitted `timeline`; `media[i]` belongs to shot `i`. Captions are left
/// out when the timeline's caption style is `none`; the end card shows when there is post text.
///
/// # Errors
/// `INTERNAL` when `media` does not have one entry per shot (a caller bug).
pub fn props(timeline: &Timeline, media: Vec<ShotMedia>) -> Result<ShortProps, AppError> {
    if media.len() != timeline.clips.len() {
        return Err(AppError::new(
            ErrorCode::Internal,
            "props need media for every shot",
        ));
    }
    let captions_on = timeline.captions.style == CaptionStyle::Phrase;
    let clips = timeline
        .clips
        .iter()
        .zip(media)
        .map(|(c, m)| props_clip(c, m, captions_on))
        .collect();
    let end_card_s = if timeline.post.caption.trim().is_empty() {
        0.0
    } else {
        END_CARD_S
    };
    Ok(ShortProps {
        aspect: timeline.aspect,
        fps: FPS,
        clips,
        post: timeline.post.clone(),
        end_card_s,
        theme: Theme {
            accent: VIDEO_ACCENT.to_owned(),
            font: VIDEO_FONT.to_owned(),
        },
        blur: Vec::new(),
        export_aspect: None,
    })
}

/// `props` with each shot's camera (see `reframe::shot_cameras`, one per shot in order): the
/// path and the source's width / height, always together.
pub fn with_cameras(
    mut props: ShortProps,
    cameras: Vec<Option<(Vec<CropKey>, f64)>>,
) -> ShortProps {
    for (clip, camera) in props.clips.iter_mut().zip(cameras) {
        if let Some((path, aspect)) = camera {
            clip.crop_path = Some(path);
            clip.source_aspect = Some(aspect);
        }
    }
    props
}

/// Separates the short and the version in a render job's subject.
const SUBJECT_SEP: &str = ":v";

/// Subject of the final-render job for version `n` of `short`: one job per short and version, so
/// rendering an edited version queues a new job while a repeat click reuses the first.
pub fn render_subject(short: &ShortId, n: u32) -> String {
    format!("{short}{SUBJECT_SEP}{n}")
}

/// Reads back [`render_subject`].
///
/// # Errors
/// `INTERNAL` for text this module did not write.
pub fn parse_render_subject(raw: &str) -> Result<(ShortId, u32), AppError> {
    let bad = || AppError::new(ErrorCode::Internal, format!("bad render subject {raw}"));
    let (short, n) = raw.rsplit_once(SUBJECT_SEP).ok_or_else(bad)?;
    Ok((ShortId::parse(short)?, n.parse().map_err(|_| bad())?))
}

/// The title of a cover still.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StillTitle {
    /// Laid over the picture as written (the composition sets the case).
    pub text: String,
    /// Top or bottom.
    pub position: TitlePosition,
}

/// Props of the `CoverStill` composition: one cover picture with its title laid over it, in the
/// brand's accent and font. The renderer validates the same shape against
/// `render/fixtures/cover_still.sample.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverStillProps {
    /// Signed URL of the plain cover.
    pub image_url: String,
    /// Still width, pixels.
    pub width: u32,
    /// Still height, pixels.
    pub height: u32,
    /// The title.
    pub title: StillTitle,
    /// Brand accent and font.
    pub theme: Theme,
    /// Blur the picture (a cut-out cover over its own frame).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_blur: Option<bool>,
    /// A cut-out subject drawn above the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cutout: Option<CutoutLayer>,
}

/// A frame size, pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameSize {
    /// Width.
    pub w: u32,
    /// Height.
    pub h: u32,
}

/// A box in frame pixels (x2, y2 inclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoxRect {
    /// Left.
    pub x1: u32,
    /// Top.
    pub y1: u32,
    /// Right.
    pub x2: u32,
    /// Bottom.
    pub y2: u32,
}

/// The subject of a cut-out cover: the frame it was cut from, its outline in that frame's
/// pixels and its box.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CutoutLayer {
    /// Signed URL of the frame.
    pub image_url: String,
    /// The frame's size.
    pub frame: FrameSize,
    /// SVG path of the outline, frame pixels.
    pub path: String,
    /// The subject's box, frame pixels.
    #[serde(rename = "box")]
    pub bbox: BoxRect,
}

/// What the renderer cuts out of a frame (`POST /cutout`, beside `out_url`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CutoutRequest {
    /// Signed URL of the frame.
    pub image_url: String,
    /// The frame's size.
    pub frame: FrameSize,
    /// The object's mask (covers `bbox`).
    pub mask: MaskRef,
    /// The object's box, frame pixels.
    #[serde(rename = "box")]
    pub bbox: BoxRect,
    /// A sticker (white outline, 12 px padding) instead of the plain cut-out.
    pub sticker: bool,
}

/// Props of the `StepStill` composition (`POST /still` with `composition: "StepStill"`): a guide
/// step's frame at its own size with a ring along the circled control's outline, no text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepStillProps {
    /// Signed URL of the frame.
    pub image_url: String,
    /// Frame width, pixels (the still's width).
    pub width: u32,
    /// Frame height, pixels (the still's height).
    pub height: u32,
    /// The control's outline: an SVG path in frame pixels (from the renderer's `/mask/path`).
    pub outline: String,
}

/// The still of a cover at `aspect`'s size with `title` over it.
pub fn cover_still_props(
    image_url: String,
    aspect: ExportAspect,
    title: &CoverTitle,
    theme: Theme,
) -> CoverStillProps {
    let (width, height) = aspect.size();
    CoverStillProps {
        image_url,
        width,
        height,
        title: StillTitle {
            text: title.text.clone(),
            position: title.position,
        },
        theme,
        background_blur: None,
        cutout: None,
    }
}

#[cfg(test)]
mod tests;
