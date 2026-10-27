//! A clip: one uploaded video file and its processing status.

use serde::{Deserialize, Serialize};

use crate::domain::ids::{ClipId, UserId};
use crate::domain::media::MediaExt;
use crate::domain::probe::ProbeInfo;
use crate::error::{AppError, ErrorCode};

/// Lifecycle of a clip, from first byte to fully understood. Serialised lower case, the same
/// text as the stored column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipStatus {
    /// Multipart upload created, parts still arriving.
    Uploading,
    /// Upload completed and verified; ingest job queued.
    Uploaded,
    /// Ingest pipeline running.
    Processing,
    /// Searchable.
    Ready,
    /// Ingest gave up; see the clip's error code.
    Failed,
    /// A byte-for-byte copy of another clip of the same owner; not ingested, hidden from search,
    /// people and storage until removed.
    Duplicate,
}

impl ClipStatus {
    /// Stored and wire text: `uploading`, `uploaded`, `processing`, `ready`, `failed`,
    /// `duplicate`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uploading => "uploading",
            Self::Uploaded => "uploaded",
            Self::Processing => "processing",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Duplicate => "duplicate",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text (only this module writes the column).
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [
            Self::Uploading,
            Self::Uploaded,
            Self::Processing,
            Self::Ready,
            Self::Failed,
            Self::Duplicate,
        ]
        .into_iter()
        .find(|s| s.as_str() == raw)
        .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad clip status {raw}")))
    }
}

/// One uploaded video file.
#[derive(Debug, Clone, PartialEq)]
pub struct Clip {
    /// Clip id (UUIDv7 text).
    pub id: ClipId,
    /// Owner.
    pub user_id: UserId,
    /// File name as the phone sent it (display only, never part of a key).
    pub filename: String,
    /// Container extension of the original.
    pub ext: MediaExt,
    /// Size of the original in bytes.
    pub size_bytes: u64,
    /// Where the clip is in its lifecycle.
    pub status: ClipStatus,
    /// Probe facts; known after the probe step.
    pub probe: Option<ProbeInfo>,
    /// Creation time of the row (ISO-8601 UTC).
    pub created_at: String,
    /// Short title written from the clip's segment descriptions; `None` until made.
    pub title: Option<String>,
    /// When the owner last opened the clip (ISO-8601 UTC); `None` until first opened.
    pub last_viewed_at: Option<String>,
    /// SHA-256 of the original, lower-case hex; `None` until hashed.
    pub content_sha256: Option<String>,
    /// The clip this one copies, when its status is `duplicate`.
    pub duplicate_of: Option<ClipId>,
}

/// Of two clips with the same content, the one that counts as the copy: the later upload (the
/// higher id on a tie, ids sort by time).
pub fn newer<'a>(a: &'a Clip, b: &'a Clip) -> &'a Clip {
    if (b.created_at.as_str(), b.id.as_str()) > (a.created_at.as_str(), a.id.as_str()) {
        b
    } else {
        a
    }
}

/// Longest clip title, characters.
pub const TITLE_MAX_CHARS: usize = 32;

/// A model's title made safe to show: one line, single spaces, no surrounding quotes or trailing
/// full stop, at most [`TITLE_MAX_CHARS`] (cut at a word boundary). `None` when nothing is left.
pub fn clean_title(raw: &str) -> Option<String> {
    let one_line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let quotes = ['"', '\'', '\u{201c}', '\u{201d}', '\u{2018}', '\u{2019}'];
    let trimmed = one_line
        .trim_matches(|c| quotes.contains(&c))
        .trim_end_matches('.')
        .trim();
    if trimmed.chars().count() <= TITLE_MAX_CHARS {
        return Some(trimmed.to_owned()).filter(|t| !t.is_empty());
    }
    let mut out = String::new();
    for word in trimmed.split(' ') {
        let next = if out.is_empty() {
            word.to_owned()
        } else {
            format!("{out} {word}")
        };
        if next.chars().count() > TITLE_MAX_CHARS {
            break;
        }
        out = next;
    }
    Some(out).filter(|t| !t.is_empty())
}

impl Clip {
    /// The title to show: the written one, else the file name without its extension.
    pub fn display_title(&self) -> String {
        if let Some(t) = self.title.as_deref().filter(|t| !t.trim().is_empty()) {
            return t.to_owned();
        }
        let stem = self
            .filename
            .rsplit_once('.')
            .map_or(self.filename.as_str(), |(s, _)| s);
        if stem.is_empty() {
            self.filename.clone()
        } else {
            stem.to_owned()
        }
    }

    /// Recording time: the container's creation time, else the upload time once probed, else
    /// unknown (`None`) before probing.
    pub fn recorded_at(&self) -> Option<&str> {
        self.probe
            .as_ref()
            .map(|p| p.recorded_at.as_deref().unwrap_or(self.created_at.as_str()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_are_one_short_line_cut_at_a_word() {
        assert_eq!(
            clean_title("  \"Morning   coffee\npour.\" ").as_deref(),
            Some("Morning coffee pour")
        );
        assert_eq!(
            clean_title("A very long walk along the sunny harbour front").as_deref(),
            Some("A very long walk along the sunny")
        );
        assert_eq!(clean_title(" \"\" "), None);
        assert_eq!(
            clean_title("Supercalifragilisticexpialidociousnessly long"),
            None
        );
    }

    #[test]
    fn the_display_title_falls_back_to_the_file_name_without_extension() {
        let mut clip = Clip {
            id: crate::domain::ids::ClipId::parse("c1").unwrap(),
            user_id: crate::domain::ids::UserId::parse("u1").unwrap(),
            filename: "beach.walk.MOV".into(),
            ext: MediaExt::Mov,
            size_bytes: 1,
            status: ClipStatus::Ready,
            probe: None,
            created_at: "2026-10-27T00:00:00.000Z".into(),
            title: None,
            last_viewed_at: None,
            content_sha256: None,
            duplicate_of: None,
        };
        assert_eq!(clip.display_title(), "beach.walk");
        clip.title = Some("Beach walk".into());
        assert_eq!(clip.display_title(), "Beach walk");
        clip.title = Some("  ".into());
        assert_eq!(clip.display_title(), "beach.walk");
    }

    #[test]
    fn status_text_round_trips() {
        for s in [
            ClipStatus::Uploading,
            ClipStatus::Uploaded,
            ClipStatus::Processing,
            ClipStatus::Ready,
            ClipStatus::Failed,
            ClipStatus::Duplicate,
        ] {
            assert_eq!(ClipStatus::parse(s.as_str()).unwrap(), s);
        }
        assert_eq!(
            ClipStatus::parse("x").unwrap_err().code,
            ErrorCode::Internal
        );
    }
}
