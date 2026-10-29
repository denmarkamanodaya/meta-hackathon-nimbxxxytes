//! Covers of an export: the look each cover was drawn in, the title laid over the picked one,
//! the per-platform cap, and the project key art Muse Image draws from real frames. The image
//! model never draws text: the title is laid over the picture by the renderer.

use std::ops::Range;

use serde::{Deserialize, Serialize};

use crate::domain::export::{COVERS_PER_BATCH, MAX_COVERS};
use crate::domain::objects::CutoutBackground;
use crate::domain::render::{BoxRect, FrameSize};
use crate::error::{AppError, ErrorCode};

/// Longest cover title, characters.
pub const MAX_TITLE_CHARS: usize = 32;
/// Shortest and longest redraw instruction, characters (after trimming).
pub const INSTRUCTION_CHARS: (usize, usize) = (3, 120);
/// Most frames key art is drawn from.
pub const ART_ANCHORS: usize = 4;
/// Clips a project needs before its key art is drawn on its own.
pub const AUTO_ART_CLIPS: u32 = 3;

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg.into())
}

/// The look of one cover. The first five can be picked before drawing; `redrawn` covers come
/// from "Redraw with words". `key_art` covers were made from a production's art before
/// productions were removed; stored ones still read back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverStyle {
    /// The subject large and centred in clean, bright light.
    Bright,
    /// An extreme close crop on the most striking detail.
    CloseDetail,
    /// A dramatic low or high angle with strong side light.
    Dramatic,
    /// A hand-drawn, illustrated take on the frame.
    Illustrated,
    /// The subject placed in a scene built from the brand's colours and references.
    BrandScene,
    /// Redrawn from another cover with the owner's words.
    Redrawn,
    /// Key art used as a cover (no longer made; kept so stored covers still read).
    KeyArt,
    /// The real subject cut out of the hook frame, in front of the title, over a scene or the
    /// blurred frame.
    Cutout,
}

impl CoverStyle {
    /// The styles the owner can pick before drawing, in the order the picker shows them.
    pub const PICKABLE: [Self; 5] = [
        Self::Bright,
        Self::CloseDetail,
        Self::Dramatic,
        Self::Illustrated,
        Self::BrandScene,
    ];

    /// Stored, wire and prompt text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bright => "bright",
            Self::CloseDetail => "close_detail",
            Self::Dramatic => "dramatic",
            Self::Illustrated => "illustrated",
            Self::BrandScene => "brand_scene",
            Self::Redrawn => "redrawn",
            Self::KeyArt => "key_art",
            Self::Cutout => "cutout",
        }
    }

    /// The style of a cover drawn before styles existed, or drawn with no style asked for: the
    /// three original variations, by number modulo 3.
    pub fn by_number(n: u32) -> Self {
        match n % 3 {
            0 => Self::Bright,
            1 => Self::CloseDetail,
            _ => Self::Dramatic,
        }
    }

    /// `self` when the owner may ask for it.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` for `redrawn` and `key_art`.
    pub fn pickable(self) -> Result<Self, AppError> {
        if Self::PICKABLE.contains(&self) {
            Ok(self)
        } else {
            Err(invalid(
                "style must be bright, close_detail, dramatic, illustrated or brand_scene",
            ))
        }
    }
}

/// How one cover was made, stored beside its key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoverInfo {
    /// Its look.
    pub style: CoverStyle,
    /// The owner's words, for a `redrawn` cover.
    pub instruction: Option<String>,
    /// What is behind the subject, for a `cutout` cover.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<CutoutBackground>,
    /// The layers a `cutout` cover is made from, so its published cover can be made again with
    /// a new title (the subject stays in front of it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layers: Option<CutoutLayers>,
}

/// The stored layers of a cut-out cover.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CutoutLayers {
    /// Stored key of the real frame (JPEG).
    pub frame_key: String,
    /// Stored key of the Muse Image scene behind the subject; `None` for the blurred frame.
    pub scene_key: Option<String>,
    /// The frame's size.
    pub frame: FrameSize,
    /// The subject's outline, frame pixels.
    pub path: String,
    /// The subject's box, frame pixels.
    pub bbox: BoxRect,
}

impl CoverInfo {
    /// A cover drawn in `style` with no instruction.
    pub fn styled(style: CoverStyle) -> Self {
        Self {
            style,
            instruction: None,
            background: None,
            layers: None,
        }
    }
}

/// The info of each of `count` covers: the stored entry, or for a cover stored before infos
/// existed, its style by number.
pub fn cover_infos(stored: &[CoverInfo], count: usize) -> Vec<CoverInfo> {
    (0..count)
        .map(|i| {
            stored.get(i).cloned().unwrap_or_else(|| {
                CoverInfo::styled(CoverStyle::by_number(u32::try_from(i).unwrap_or(0)))
            })
        })
        .collect()
}

/// The numbers of `wanted` more covers for a platform that has `existing`; fewer when the cap
/// is near.
///
/// # Errors
/// `VALIDATION_FAILED` when the platform already has [`MAX_COVERS`].
pub fn cover_slots(existing: usize, wanted: u32) -> Result<Range<u32>, AppError> {
    let from = u32::try_from(existing).unwrap_or(MAX_COVERS);
    if from >= MAX_COVERS {
        return Err(invalid(format!(
            "a platform has at most {MAX_COVERS} covers"
        )));
    }
    Ok(from..from.saturating_add(wanted).min(MAX_COVERS))
}

/// The numbers of the next batch of covers (see [`cover_slots`]).
///
/// # Errors
/// As [`cover_slots`].
pub fn next_covers(existing: usize) -> Result<Range<u32>, AppError> {
    cover_slots(existing, COVERS_PER_BATCH)
}

/// The owner's redraw instruction, trimmed.
///
/// # Errors
/// `VALIDATION_FAILED` outside 3 to 120 characters.
pub fn checked_instruction(raw: &str) -> Result<String, AppError> {
    let text = raw.trim();
    let n = text.chars().count();
    let (min, max) = INSTRUCTION_CHARS;
    if !(min..=max).contains(&n) {
        return Err(invalid(format!(
            "instruction must be {min} to {max} characters"
        )));
    }
    Ok(text.to_owned())
}

/// Where the title sits on the cover.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TitlePosition {
    /// Over the top of the picture.
    Top,
    /// Over the bottom of the picture.
    Bottom,
}

/// The title laid over an export's picked cover.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoverTitle {
    /// 1 to 32 characters.
    pub text: String,
    /// Whether the published cover carries it.
    pub show: bool,
    /// Top or bottom.
    pub position: TitlePosition,
}

/// `text` without hashtags and extra spaces, cut to at most 32 characters at a word boundary
/// (mid-word only when the first word alone is longer).
pub fn title_text(text: &str) -> String {
    let words: Vec<&str> = text
        .split_whitespace()
        .filter(|w| !w.starts_with('#'))
        .collect();
    let mut out = String::new();
    for w in words {
        let len = out.chars().count() + usize::from(!out.is_empty()) + w.chars().count();
        if len > MAX_TITLE_CHARS {
            if out.is_empty() {
                out = w.chars().take(MAX_TITLE_CHARS).collect();
            }
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(w);
    }
    out
}

/// The title a cover gets until the owner edits it: the caption (else `fallback`, the short's
/// own request) cut to 32 characters, shown at the bottom.
pub fn default_title(caption: &str, fallback: &str) -> CoverTitle {
    let from_caption = title_text(caption);
    let text = if from_caption.is_empty() {
        title_text(fallback)
    } else {
        from_caption
    };
    CoverTitle {
        text: if text.is_empty() {
            "My short".to_owned()
        } else {
            text
        },
        show: true,
        position: TitlePosition::Bottom,
    }
}

/// The title an export carries: the stored one, else the default from its caption.
pub fn effective_title(stored: Option<&CoverTitle>, caption: &str, fallback: &str) -> CoverTitle {
    stored
        .cloned()
        .unwrap_or_else(|| default_title(caption, fallback))
}

/// The variation number of art or a board the owner asked for again: never 0 (the automatic
/// drawing's), and new each time, so the model cache does not hand back the same picture.
pub fn manual_take(now_millis: i64) -> u32 {
    u32::try_from(now_millis.rem_euclid(999_999)).map_or(1, |n| n + 1)
}

/// Shape and model size of a project's key art: a wide banner.
pub const PROJECT_ART_FRAME: (&str, &str) = ("16:9", "1920x1080");

/// The owner's title with its text trimmed.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty text or one over 32 characters.
pub fn checked_title(title: CoverTitle) -> Result<CoverTitle, AppError> {
    let text = title.text.trim().to_owned();
    if !(1..=MAX_TITLE_CHARS).contains(&text.chars().count()) {
        return Err(invalid(format!(
            "the cover title is 1 to {MAX_TITLE_CHARS} characters"
        )));
    }
    Ok(CoverTitle { text, ..title })
}

/// What the published cover of an export is right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishedCover<'a, K> {
    /// The titled still of the picked cover.
    Titled(&'a K),
    /// The picked cover itself (the title is off).
    Plain(&'a K),
    /// The titled still is being made.
    Baking,
    /// No cover yet.
    None,
}

/// The published cover from the covers, the pick, the title and the titled still (if made).
pub fn published_cover<'a, K>(
    covers: &'a [K],
    pick: u32,
    show_title: bool,
    titled: Option<&'a K>,
) -> PublishedCover<'a, K> {
    let Some(picked) = covers.get(pick as usize) else {
        return PublishedCover::None;
    };
    match (show_title, titled) {
        (false, _) => PublishedCover::Plain(picked),
        (true, Some(t)) => PublishedCover::Titled(t),
        (true, None) => PublishedCover::Baking,
    }
}

/// Picks up to [`ART_ANCHORS`] moments for key art: the highest `hook` score first (the
/// earlier one on a tie), unscored moments last.
pub fn art_moments<T>(moments: Vec<T>, hook: impl Fn(&T) -> Option<u8>) -> Vec<T> {
    let mut indexed: Vec<(usize, T)> = moments.into_iter().enumerate().collect();
    indexed.sort_by(|(ia, a), (ib, b)| {
        let (ha, hb) = (hook(a).map_or(-1, i16::from), hook(b).map_or(-1, i16::from));
        hb.cmp(&ha).then(ia.cmp(ib))
    });
    indexed
        .into_iter()
        .take(ART_ANCHORS)
        .map(|(_, m)| m)
        .collect()
}

#[cfg(test)]
mod tests;
