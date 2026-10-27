//! Maps a short (best version's timeline, picked segments, critique) plus the library metadata
//! and the local media paths onto the FCPXML [`Project`].

use nimbytes_contracts::shorts::{Aspect, ShortDetail};
use nimbytes_contracts::sync::SyncClip;
use nimbytes_core::domain::faces::PROXY_LONG_EDGE_PX;

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::fcpxml::{FrameRate, Media, Note, Project, Shot};

/// The proxy's constant frame rate (the api's ffmpeg proxy arguments force `fps=30`).
pub const PROXY_FPS: f64 = 30.0;

/// Output size of a short, pixels (the composition's 1080-wide frames).
pub fn frame_size(aspect: Aspect) -> (u32, u32) {
    match aspect {
        Aspect::Portrait => (1080, 1350),
        Aspect::Square => (1080, 1080),
    }
}

/// Proxy size for an original of `w`×`h`: long edge at most [`PROXY_LONG_EDGE_PX`], even sides.
pub fn proxy_size(w: u32, h: u32) -> (u32, u32) {
    let long = w.max(h).max(1);
    if long <= PROXY_LONG_EDGE_PX {
        return (w, h);
    }
    let scale = |side: u32| {
        (u64::from(side) * u64::from(PROXY_LONG_EDGE_PX) / u64::from(long)) as u32 / 2 * 2
    };
    if w >= h {
        (PROXY_LONG_EDGE_PX, scale(h))
    } else {
        (scale(w), PROXY_LONG_EDGE_PX)
    }
}

/// The clip ids the best version uses, each once, in play order.
///
/// # Errors
/// `NOT_FOUND` when the short has no version or a shot names an unknown segment.
pub fn clip_ids(detail: &ShortDetail) -> DesktopResult<Vec<String>> {
    let mut ids: Vec<String> = Vec::new();
    for shot in &best(detail)?.timeline.clips {
        let id = segment_clip(detail, shot.segment_id.as_str())?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn best(detail: &ShortDetail) -> DesktopResult<&nimbytes_contracts::shorts::ShortVersion> {
    let wanted = detail.short.best_version;
    detail
        .versions
        .iter()
        .find(|v| Some(v.n) == wanted)
        .or_else(|| detail.versions.last())
        .ok_or_else(|| DesktopError::new(ErrorCode::NotFound, "the short has no cut yet"))
}

/// The clip of a segment: from the short's picked segments, else from the id itself (the api
/// builds segment ids as `{clip}-s{idx}`; a revision may use a segment that was not picked).
fn segment_clip(detail: &ShortDetail, segment: &str) -> DesktopResult<String> {
    detail
        .segments
        .iter()
        .find(|s| s.segment_id == segment)
        .map(|s| s.clip_id.clone())
        .or_else(|| clip_of_segment(segment))
        .ok_or_else(|| {
            DesktopError::new(
                ErrorCode::NotFound,
                format!("segment {segment} has no clip"),
            )
        })
}

/// Inverse of the api's `segment_id(clip, idx)`: the clip id before the last `-s<digits>`.
pub fn clip_of_segment(segment: &str) -> Option<String> {
    let (clip, idx) = segment.rsplit_once("-s")?;
    let digits = !idx.is_empty() && idx.bytes().all(|b| b.is_ascii_digit());
    (digits && !clip.is_empty()).then(|| clip.to_owned())
}

/// Local media for one clip: its path and whether it is the original.
#[derive(Debug, Clone)]
pub struct LocalMedia {
    /// Library metadata.
    pub clip: SyncClip,
    /// Absolute path.
    pub path: String,
    /// True for the original, false for the 720p proxy.
    pub is_original: bool,
}

fn media(local: &LocalMedia) -> Media {
    let (w, h) = (
        local.clip.width.unwrap_or(1080),
        local.clip.height.unwrap_or(1920),
    );
    let ((width, height), fps) = if local.is_original {
        ((w, h), local.clip.fps)
    } else {
        (proxy_size(w, h), Some(PROXY_FPS))
    };
    Media {
        name: local.clip.title.clone(),
        path: local.path.clone(),
        width,
        height,
        rate: FrameRate::from_fps(fps),
        duration_s: local.clip.duration_s.unwrap_or(f64::MAX),
    }
}

/// Builds the FCPXML project from the clips that have local media. Shots whose clip is not in
/// `local` (deleted from the library) are left out and named in a to-do marker at the start.
///
/// # Errors
/// `NOT_FOUND` as [`clip_ids`], or when no shot has media.
pub fn project(detail: &ShortDetail, local: &[LocalMedia]) -> DesktopResult<Project> {
    let version = best(detail)?;
    let mut shots = Vec::new();
    let mut skipped = 0;
    for shot in &version.timeline.clips {
        let id = segment_clip(detail, shot.segment_id.as_str())?;
        let Some(media) = local.iter().position(|m| m.clip.clip_id == id) else {
            skipped += 1;
            continue;
        };
        shots.push(Shot {
            media,
            in_s: shot.in_s,
            out_s: shot.out_s,
            reason: shot.reason.clone(),
        });
    }
    if shots.is_empty() {
        return Err(DesktopError::new(
            ErrorCode::NotFound,
            "none of the cut's clips are in the library",
        ));
    }
    let prompt = detail.short.prompt.trim();
    let (width, height) = frame_size(version.timeline.aspect);
    Ok(Project {
        name: if prompt.is_empty() {
            detail.short.short_id.clone()
        } else {
            prompt.to_owned()
        },
        width,
        height,
        media: local.iter().map(media).collect(),
        shots,
        notes: notes(version, skipped),
    })
}

/// Critique notes as to-do markers, plus one at the start naming shots left out.
fn notes(version: &nimbytes_contracts::shorts::ShortVersion, skipped: usize) -> Vec<Note> {
    let mut notes: Vec<Note> = version
        .critique
        .iter()
        .flat_map(|c| c.notes.iter())
        .map(|n| Note {
            at_s: n.at,
            text: format!("{} → {}", n.issue, n.fix),
        })
        .collect();
    if skipped > 0 {
        let text = format!("{skipped} shot(s) left out: their clip is no longer in the library");
        notes.insert(0, Note { at_s: 0.0, text });
    }
    notes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxies_keep_the_aspect_with_a_1280_long_edge() {
        assert_eq!(proxy_size(1440, 1920), (960, 1280));
        assert_eq!(proxy_size(3024, 4032), (960, 1280));
        assert_eq!(proxy_size(1920, 1080), (1280, 720));
        assert_eq!(proxy_size(720, 960), (720, 960));
    }

    #[test]
    fn a_segment_id_names_its_clip_as_the_api_builds_it() {
        let clip =
            nimbytes_core::domain::ids::ClipId::parse("01a179c0-1f2b-72da-a041-dc704dee27dd")
                .unwrap();
        let segment = nimbytes_core::domain::segment::segment_id(&clip, 12).unwrap();
        assert_eq!(
            clip_of_segment(segment.as_str()).as_deref(),
            Some(clip.as_str())
        );
        assert_eq!(clip_of_segment("abc-sx"), None);
        assert_eq!(clip_of_segment("abc"), None);
    }

    #[test]
    fn short_frames_are_1080_wide() {
        assert_eq!(frame_size(Aspect::Portrait), (1080, 1350));
        assert_eq!(frame_size(Aspect::Square), (1080, 1080));
    }
}
