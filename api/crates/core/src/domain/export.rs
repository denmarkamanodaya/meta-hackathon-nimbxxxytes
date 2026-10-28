//! Publishing a short: per platform a frame, a render, a caption within the platform's limit,
//! hashtags and covers. Exports have their own aspect type, so 9:16 never reaches the shorts
//! themselves (create-short and save-timeline only take [`Aspect`]).

use serde::{Deserialize, Serialize};

use crate::domain::cover::{CoverInfo, CoverTitle};
use crate::domain::ids::ShortId;
use crate::domain::text_enum::text_enum;
use crate::domain::timeline::Aspect;
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;

/// Fewest hashtags the platform pack writes.
pub const MIN_HASHTAGS: usize = 3;
/// Most hashtags kept per platform.
pub const MAX_HASHTAGS: usize = 8;
/// Covers made per request.
pub const COVERS_PER_BATCH: u32 = 3;
/// Most covers per platform.
pub const MAX_COVERS: u32 = 9;
/// Longest hashtag, characters (the `#` included).
const MAX_TAG_CHARS: usize = 40;
/// Marks a caption that was cut short.
const ELLIPSIS: char = '…';

text_enum!(
    /// Where an export is posted (the owner posts; nothing is posted for them).
    Platform {
        /// TikTok, 9:16.
        Tiktok => "tiktok",
        /// Instagram Reels, 9:16.
        Reels => "reels",
        /// YouTube Shorts, 9:16.
        Shorts => "shorts",
        /// A feed post at the short's own aspect.
        Feed => "feed",
    }
);

/// Frame of an export.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExportAspect {
    /// 4:5 portrait (1080×1350).
    #[serde(rename = "4:5")]
    Portrait,
    /// 1:1 square (1080×1080).
    #[serde(rename = "1:1")]
    Square,
    /// 9:16 vertical (1080×1920), for TikTok, Reels and Shorts.
    #[serde(rename = "9:16")]
    Vertical,
}

impl ExportAspect {
    /// Stored and wire text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Portrait => "4:5",
            Self::Square => "1:1",
            Self::Vertical => "9:16",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for text this type did not write.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::Portrait, Self::Square, Self::Vertical]
            .into_iter()
            .find(|a| a.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad export aspect {raw}")))
    }

    /// The short's own frame as an export frame.
    pub fn of(aspect: Aspect) -> Self {
        match aspect {
            Aspect::Portrait => Self::Portrait,
            Aspect::Square => Self::Square,
        }
    }

    /// Final size in pixels (always 1080 wide).
    pub fn size(self) -> (u32, u32) {
        match self {
            Self::Portrait => (1080, 1350),
            Self::Square => (1080, 1080),
            Self::Vertical => (1080, 1920),
        }
    }

    /// The `size` asked of the image model (it sets the aspect only).
    pub fn image_size(self) -> &'static str {
        match self {
            Self::Portrait => "1080x1350",
            Self::Square => "1080x1080",
            Self::Vertical => "1080x1920",
        }
    }
}

/// Whether `platform` takes the shared 9:16 render (TikTok, Reels, Shorts); the feed takes the
/// short's own render.
pub fn is_vertical(platform: Platform) -> bool {
    !matches!(platform, Platform::Feed)
}

/// The frame of `platform`'s export of a short framed `short`.
pub fn export_aspect(platform: Platform, short: Aspect) -> ExportAspect {
    if is_vertical(platform) {
        ExportAspect::Vertical
    } else {
        ExportAspect::of(short)
    }
}

/// What an export request renders: one 9:16 render shared by every vertical platform asked
/// for, and whether the feed (which reuses the short's own render) was asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RenderPlan {
    /// Render one 9:16 video.
    pub vertical: bool,
    /// Use the short's own final render.
    pub feed: bool,
}

/// The renders `platforms` need: at most one 9:16 render, however many vertical platforms.
pub fn render_plan(platforms: &[Platform]) -> RenderPlan {
    RenderPlan {
        vertical: platforms.iter().any(|p| is_vertical(*p)),
        feed: platforms.contains(&Platform::Feed),
    }
}

/// The requested platforms, each once, in the given order.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty list.
pub fn checked_platforms(platforms: &[Platform]) -> Result<Vec<Platform>, AppError> {
    let mut out: Vec<Platform> = Vec::new();
    for p in platforms {
        if !out.contains(p) {
            out.push(*p);
        }
    }
    if out.is_empty() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "platforms must name at least one platform",
        ));
    }
    Ok(out)
}

/// Longest caption, characters: TikTok, Reels and the feed take 2,200; YouTube Shorts takes a
/// 100-character title.
pub fn caption_limit(platform: Platform) -> usize {
    match platform {
        Platform::Shorts => 100,
        Platform::Tiktok | Platform::Reels | Platform::Feed => 2200,
    }
}

/// `text` trimmed and, when longer than `limit` characters, cut at the last space that leaves
/// room for an ellipsis (mid-word only when there is no space).
pub fn fit_caption(text: &str, limit: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= limit {
        return text.to_owned();
    }
    let head: String = text.chars().take(limit.saturating_sub(1)).collect();
    let cut = match head.rfind(char::is_whitespace) {
        Some(i) if i > 0 => head[..i].trim_end().to_owned(),
        _ => head,
    };
    format!("{cut}{ELLIPSIS}")
}

/// Hashtags as posted: `#` plus letters, digits and underscores (anything else dropped), each
/// tag once ignoring case, at most [`MAX_HASHTAGS`], empty ones dropped.
pub fn clean_hashtags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in tags {
        let body: String = raw
            .trim()
            .trim_start_matches('#')
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_')
            .take(MAX_TAG_CHARS - 1)
            .collect();
        if body.is_empty() || out.iter().any(|t| t[1..].eq_ignore_ascii_case(&body)) {
            continue;
        }
        out.push(format!("#{body}"));
        if out.len() == MAX_HASHTAGS {
            break;
        }
    }
    out
}

/// Where an export's render stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportStatus {
    /// Waiting for its render.
    Queued,
    /// Its render runs.
    Rendering,
    /// Its render is ready.
    Ready,
    /// Its render failed; asking again retries.
    Failed,
}

impl ExportStatus {
    /// Stored text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Rendering => "rendering",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for text this type did not write.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::Queued, Self::Rendering, Self::Ready, Self::Failed]
            .into_iter()
            .find(|s| s.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad export status {raw}")))
    }
}

/// One platform's export of a short.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortExport {
    /// Row id.
    pub id: String,
    /// The short.
    pub short_id: ShortId,
    /// Where it is posted.
    pub platform: Platform,
    /// Its frame.
    pub aspect: ExportAspect,
    /// The version exported.
    pub version_n: u32,
    /// Its render.
    pub status: ExportStatus,
    /// The video, once rendered (shared by the 9:16 platforms; the feed's is the short's own).
    pub render_key: Option<ObjectKey>,
    /// Caption within the platform's limit.
    pub caption: String,
    /// Hashtags.
    pub hashtags: Vec<String>,
    /// Covers in the order made.
    pub cover_keys: Vec<ObjectKey>,
    /// The chosen cover (index into `cover_keys`).
    pub cover_pick: u32,
    /// Last change (ISO-8601 UTC).
    pub updated_at: String,
    /// How each cover was made, as stored: aligned with `cover_keys`, but shorter when covers
    /// predate it (read them through `cover_infos`).
    pub cover_info: Vec<CoverInfo>,
    /// The title over the picked cover; `None` until first set (see `default_title`).
    pub cover_title: Option<CoverTitle>,
    /// The picked cover with its title, as published; `None` while it is being made.
    pub titled_cover_key: Option<ObjectKey>,
}

/// The status and video a feed export shows: the short's own final render once it exists, and
/// failed once that render gave up (`final_failed`), so the owner can publish again.
pub fn feed_render(
    status: ExportStatus,
    short_render: Option<&ObjectKey>,
    final_failed: bool,
) -> (ExportStatus, Option<ObjectKey>) {
    match short_render {
        Some(key) => (ExportStatus::Ready, Some(key.clone())),
        None if final_failed => (ExportStatus::Failed, None),
        None if status == ExportStatus::Ready => (ExportStatus::Rendering, None),
        None => (status, None),
    }
}

/// The version a short is exported at: the one the agent rated best, else the latest.
pub fn export_version(best: Option<u32>, versions: &[u32]) -> Option<u32> {
    best.filter(|b| versions.contains(b))
        .or_else(|| versions.iter().max().copied())
}

/// The moment covers are anchored on: of the shots' segments (in play order), the one with the
/// highest hook score; the first shot when none is scored.
pub fn hook_segment<'a, T>(shots: &[&'a T], hook: impl Fn(&T) -> Option<u8>) -> Option<&'a T> {
    let mut best: Option<(&T, u8)> = None;
    for s in shots {
        let score = hook(s).unwrap_or(0);
        if best.is_none_or(|(_, b)| score > b) {
            best = Some((s, score));
        }
    }
    best.map(|(s, _)| s)
}

#[cfg(test)]
mod tests;
