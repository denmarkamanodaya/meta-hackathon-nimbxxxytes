//! Props of the `NimbytesShort` composition: what the renderer and the browser Player receive.
//! The server builds them from a fitted timeline, phrase captions and presigned media URLs; the
//! renderer validates the same shape against `render/fixtures/props.sample.json`.

use serde::{Deserialize, Serialize};

use crate::domain::captions::Caption;
use crate::domain::export::ExportAspect;
use crate::domain::ids::{SegmentId, ShortId};
use crate::domain::privacy::SegmentBlur;
use crate::domain::timeline::{Aspect, CaptionStyle, Post, Timeline};
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
        .map(|(c, m)| PropsClip {
            segment_id: c.segment_id.clone(),
            src_url: m.src_url,
            in_s: c.in_s,
            out_s: c.out_s,
            punch_in: c.punch_in,
            subject: c.subject.clone(),
            captions: if captions_on { m.captions } else { Vec::new() },
        })
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

#[cfg(test)]
mod tests;
