//! iListen: any sound file, video or clip, transcribed, every line's language named and
//! translated into the output language the owner picked, summarised, then checked by a second
//! pass that scores each line until the translation passes. The pure rules: what may be
//! uploaded, the output languages, the language shares, the parts long transcripts are sent in,
//! the title, and (in [`check`] and [`numbers`]) the scoring, the number check and the versions.

mod check;
pub mod coverage;
mod numbers;

use std::ops::Range;

use serde::{Deserialize, Serialize};

use crate::domain::ids::{ClipId, ListenId, UserId};
use crate::domain::text_enum::text_enum;
use crate::domain::title::owner_title;
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;

pub use check::{
    best_version, checker_notes, fixed_draft, fixed_in, fixer_notes, flagged_turns, scored,
    tidied_draft,
};
pub use numbers::{numbers_kept, original_numbers, translation_numbers};

/// Largest file accepted, bytes (300 MB).
pub const MAX_BYTES: u64 = 300 * 1024 * 1024;
/// Longest recording listened to, seconds (2 hours).
pub const MAX_DURATION_S: f64 = 7_200.0;
/// Longest client file name, bytes.
pub const MAX_FILENAME_BYTES: usize = 255;
/// Longest title, characters.
pub const MAX_TITLE_CHARS: usize = 80;
/// Most key points kept.
pub const MAX_KEY_POINTS: usize = 5;
/// Most versions made by the check loop (the first translation and up to two fixes).
pub const MAX_VERSIONS: u32 = 3;
/// Lowest score a line and the summary need to pass.
pub const PASS_SCORE: u32 = 90;
/// The score a line is capped at when a number of the original is missing from its translation.
pub const NUMBER_CAP: u32 = 60;
/// Most turns sent to Spark in one call.
pub const PART_TURNS: usize = 120;
/// Most transcript characters sent to Spark in one call.
pub const PART_CHARS: usize = 24_000;
/// The title when Spark gives none.
pub const FALLBACK_TITLE: &str = "Recording";

/// Sound types accepted besides any `video/*`.
pub const AUDIO_TYPES: [&str; 9] = [
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/flac",
    "audio/webm",
];

/// File extensions accepted (lower case).
pub const EXTENSIONS: [&str; 10] = [
    "mp3", "m4a", "aac", "wav", "ogg", "flac", "webm", "mp4", "mov", "m4v",
];

/// An output language: its code and the name it is given to Spark and shown under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutputLanguage {
    /// ISO 639-1 code.
    pub code: &'static str,
    /// Its own name.
    pub name: &'static str,
}

/// The languages a summary can be written in, in the order the picker shows them.
pub const OUTPUT_LANGUAGES: [OutputLanguage; 12] = [
    OutputLanguage {
        code: "en",
        name: "English",
    },
    OutputLanguage {
        code: "zh",
        name: "中文",
    },
    OutputLanguage {
        code: "ja",
        name: "日本語",
    },
    OutputLanguage {
        code: "ko",
        name: "한국어",
    },
    OutputLanguage {
        code: "tl",
        name: "Tagalog",
    },
    OutputLanguage {
        code: "es",
        name: "Español",
    },
    OutputLanguage {
        code: "fr",
        name: "Français",
    },
    OutputLanguage {
        code: "de",
        name: "Deutsch",
    },
    OutputLanguage {
        code: "id",
        name: "Bahasa Indonesia",
    },
    OutputLanguage {
        code: "vi",
        name: "Tiếng Việt",
    },
    OutputLanguage {
        code: "th",
        name: "ไทย",
    },
    OutputLanguage {
        code: "hi",
        name: "हिन्दी",
    },
];

/// The only output language the summary is spoken in on the server (MMS-TTS speaks English).
pub const SPOKEN_TARGET: &str = "en";

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// The output language with `code`.
///
/// # Errors
/// `VALIDATION_FAILED` for a code outside [`OUTPUT_LANGUAGES`].
pub fn output_language(code: &str) -> Result<OutputLanguage, AppError> {
    OUTPUT_LANGUAGES
        .iter()
        .copied()
        .find(|l| l.code == code.trim())
        .ok_or_else(|| invalid("pick an output language from the list"))
}

text_enum!(
    /// Where a listen is.
    ListenStatus {
        /// Created from a file; the client is uploading it.
        Uploading => "uploading",
        /// The `listen` job is running.
        Listening => "listening",
        /// Summarised and checked.
        Ready => "ready",
        /// The job gave up; see the error.
        Failed => "failed",
    }
);

text_enum!(
    /// Where the transcript came from.
    HeardBy {
        /// The clip's own transcript, made at ingest.
        Clip => "clip",
        /// One pass over the whole recording (speakers kept).
        Full => "full",
        /// The window pass, which heard clearly more (no speakers).
        Windows => "windows",
    }
);

text_enum!(
    /// What was listened to.
    ListenSource {
        /// A file from the device.
        File => "file",
        /// A clip already in the library.
        Clip => "clip",
    }
);

/// One language heard and its share of the speaking time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeardShare {
    /// ISO 639-1 code.
    pub code: String,
    /// Whole percent; the shares of a listen add up to 100.
    pub share: u32,
}

/// A stored listen.
#[derive(Debug, Clone, PartialEq)]
pub struct Listen {
    /// Id.
    pub id: ListenId,
    /// Owner.
    pub user_id: UserId,
    /// A file or a clip.
    pub source: ListenSource,
    /// The clip, for [`ListenSource::Clip`].
    pub clip_id: Option<ClipId>,
    /// The file name, or the clip's title.
    pub source_name: String,
    /// The file's declared type; empty for a clip.
    pub content_type: String,
    /// The file's extension (one of [`EXTENSIONS`]); empty for a clip.
    pub ext: String,
    /// The file's declared size; 0 for a clip.
    pub size_bytes: u64,
    /// Where it is.
    pub status: ListenStatus,
    /// The step running while listening.
    pub step: Option<String>,
    /// The version being checked, or the final one; 0 before the first translation.
    pub version: u32,
    /// Output language code.
    pub target: String,
    /// In the output language; empty until understood.
    pub title: String,
    /// In the output language; empty until understood.
    pub summary: String,
    /// In the output language, at most [`MAX_KEY_POINTS`].
    pub key_points: Vec<String>,
    /// Languages heard, largest share first.
    pub languages: Vec<HeardShare>,
    /// Audio length; `None` before the audio step.
    pub duration_ms: Option<u64>,
    /// Distinct speakers.
    pub speakers: u32,
    /// Where the transcript came from; `None` before it.
    pub heard_by: Option<HeardBy>,
    /// Lowest score of the final version.
    pub confidence: Option<u32>,
    /// Whether the final version passed.
    pub passed: bool,
    /// The summary spoken (English only).
    pub summary_audio_key: Option<ObjectKey>,
    /// Why it failed.
    pub error: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// What a new listen starts from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenStart {
    /// A file or a clip.
    pub source: ListenSource,
    /// The clip, for a clip.
    pub clip_id: Option<ClipId>,
    /// File name or clip title.
    pub source_name: String,
    /// Declared type (file only).
    pub content_type: String,
    /// Extension (file only).
    pub ext: String,
    /// Declared size (file only).
    pub size_bytes: u64,
    /// Output language code, checked.
    pub target: String,
}

impl Listen {
    /// A new listen of `user` in `status`, with nothing heard yet; created and updated `at`.
    pub fn new(
        (id, user): (ListenId, UserId),
        start: ListenStart,
        status: ListenStatus,
        at: &str,
    ) -> Self {
        Self {
            id,
            user_id: user,
            source: start.source,
            clip_id: start.clip_id,
            source_name: start.source_name,
            content_type: start.content_type,
            ext: start.ext,
            size_bytes: start.size_bytes,
            status,
            step: None,
            version: 0,
            target: start.target,
            title: String::new(),
            summary: String::new(),
            key_points: Vec::new(),
            languages: Vec::new(),
            duration_ms: None,
            speakers: 0,
            heard_by: None,
            confidence: None,
            passed: false,
            summary_audio_key: None,
            error: None,
            created_at: at.to_owned(),
            updated_at: at.to_owned(),
        }
    }
}

/// One spoken line and what the check loop made of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListenTurn {
    /// 0-based.
    pub index: u32,
    /// Start within the audio.
    pub start_ms: u64,
    /// End within the audio.
    pub end_ms: u64,
    /// Speaker label.
    pub speaker: Option<String>,
    /// As transcribed.
    pub text: String,
    /// ISO 639-1; empty until understood.
    pub lang: String,
    /// In the output language; empty until understood.
    pub translation: String,
    /// Check score in the final version.
    pub score: Option<u32>,
    /// The checker's note; empty when none.
    pub issue: String,
    /// The version that last changed the translation (1 = never fixed).
    pub fixed_in: u32,
}

impl ListenTurn {
    /// A transcribed line, not yet understood.
    pub fn heard(
        index: u32,
        (start_ms, end_ms): (u64, u64),
        speaker: Option<String>,
        text: &str,
    ) -> Self {
        Self {
            index,
            start_ms,
            end_ms,
            speaker,
            text: text.trim().to_owned(),
            lang: String::new(),
            translation: String::new(),
            score: None,
            issue: String::new(),
            fixed_in: 1,
        }
    }
}

/// One line of a draft: its language and translation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftTurn {
    /// The turn's index.
    pub index: u32,
    /// ISO 639-1 code Spark named.
    pub lang: String,
    /// In the output language.
    pub translation: String,
}

/// A translation and summary (what understand returns, and what each fix makes).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Draft {
    /// Short title.
    pub title: String,
    /// One per turn, by index.
    pub turns: Vec<DraftTurn>,
    /// Two to four sentences.
    pub summary: String,
    /// At most [`MAX_KEY_POINTS`].
    pub key_points: Vec<String>,
}

impl Draft {
    /// The translation of turn `index` (empty when missing).
    pub fn translation(&self, index: u32) -> &str {
        self.turns
            .iter()
            .find(|t| t.index == index)
            .map_or("", |t| t.translation.as_str())
    }

    /// The language of turn `index` (empty when missing).
    pub fn lang(&self, index: u32) -> &str {
        self.turns
            .iter()
            .find(|t| t.index == index)
            .map_or("", |t| t.lang.as_str())
    }
}

/// The title, summary and key points made from several parts' summaries.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Overview {
    /// Short title.
    pub title: String,
    /// Two to four sentences.
    pub summary: String,
    /// At most [`MAX_KEY_POINTS`].
    pub key_points: Vec<String>,
}

/// The checker's verdict on one line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnCheck {
    /// The turn's index.
    pub index: u32,
    /// The draft translated back into the turn's language.
    pub back_translation: String,
    /// 0-100.
    pub score: u32,
    /// What is wrong, or empty.
    pub issue: String,
}

/// The checker's answer on a draft.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CheckAnswer {
    /// One per checked turn.
    pub turns: Vec<TurnCheck>,
    /// 0-100: how faithful the summary and key points are.
    pub summary_score: u32,
    /// What is wrong with the summary.
    pub summary_issues: Vec<String>,
}

/// One line the fixer translated again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixTurn {
    /// The turn's index.
    pub index: u32,
    /// The new translation.
    pub translation: String,
}

/// The fixer's answer.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FixAnswer {
    /// Every turn it was sent, flagged ones translated again.
    pub turns: Vec<FixTurn>,
    /// The summary, rewritten where the notes said.
    pub summary: String,
    /// The key points, rewritten where the notes said.
    pub key_points: Vec<String>,
}

/// One line's final check: its score (after the number check) and issue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineScore {
    /// The turn's index.
    pub index: u32,
    /// 0-100.
    pub score: u32,
    /// What is wrong, or empty.
    pub issue: String,
}

/// A checked version: every line's score, the summary's, the notes and the verdict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scored {
    /// One per turn, in turn order.
    pub lines: Vec<LineScore>,
    /// 0-100.
    pub summary_score: u32,
    /// What the checker said about the summary.
    pub summary_issues: Vec<String>,
    /// Lowest of every line and the summary.
    pub confidence: u32,
    /// Every line and the summary at least [`PASS_SCORE`].
    pub passed: bool,
}

/// One version of the translation and its check (`None` while checking).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenVersion {
    /// 1 to [`MAX_VERSIONS`].
    pub version: u32,
    /// The translation and summary.
    pub draft: Draft,
    /// Its check.
    pub check: Option<Scored>,
}

/// What a client declares before uploading a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewListenFile {
    /// Its name on the device.
    pub filename: String,
    /// Its MIME type.
    pub content_type: String,
    /// Its size, bytes.
    pub size_bytes: u64,
}

/// The MIME type without parameters, lower case.
fn essence(content_type: &str) -> String {
    content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

/// Whether iListen takes a file of `content_type`: one of [`AUDIO_TYPES`] or any `video/*`.
pub fn accepted_type(content_type: &str) -> bool {
    let e = essence(content_type);
    AUDIO_TYPES.contains(&e.as_str()) || (e.starts_with("video/") && e.len() <= 100)
}

/// The extension of a file iListen takes.
///
/// # Errors
/// `VALIDATION_FAILED` when it is not one of [`EXTENSIONS`].
pub fn listen_ext(filename: &str) -> Result<String, AppError> {
    let ext = filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    if EXTENSIONS.contains(&ext.as_str()) {
        Ok(ext)
    } else {
        Err(invalid(
            "only sound (mp3, m4a, aac, wav, ogg, flac, webm) or video (mp4, mov, m4v) files",
        ))
    }
}

/// The extension of a file the client may upload.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long name, another extension or type, an empty file
/// or one over [`MAX_BYTES`].
pub fn checked_file(f: &NewListenFile) -> Result<String, AppError> {
    if f.filename.trim().is_empty() || f.filename.len() > MAX_FILENAME_BYTES {
        return Err(invalid("the file needs a name of at most 255 bytes"));
    }
    let ext = listen_ext(&f.filename)?;
    if !accepted_type(&f.content_type) {
        return Err(invalid("only a sound file or a video can be listened to"));
    }
    if f.size_bytes == 0 {
        return Err(invalid("the file is empty"));
    }
    if f.size_bytes > MAX_BYTES {
        return Err(invalid("the file is larger than 300 MB"));
    }
    Ok(ext)
}

/// Checks a recording's length.
///
/// # Errors
/// `VALIDATION_FAILED` past [`MAX_DURATION_S`]; `MEDIA_FAILED` for no length.
pub fn checked_duration(duration_s: f64) -> Result<u64, AppError> {
    if !(duration_s.is_finite() && duration_s > 0.0) {
        return Err(AppError::new(
            ErrorCode::MediaFailed,
            "the recording has no length",
        ));
    }
    if duration_s > MAX_DURATION_S {
        return Err(invalid("the recording is longer than 2 hours"));
    }
    // Checked above: positive and at most 7 200 s, so the product fits.
    Ok((duration_s * 1000.0).round() as u64)
}

/// A title the owner typed.
///
/// # Errors
/// `VALIDATION_FAILED` when it is empty or over [`MAX_TITLE_CHARS`].
pub fn listen_title(raw: &str) -> Result<String, AppError> {
    owner_title(raw, MAX_TITLE_CHARS, "a recording")
}

/// Distinct speaker labels.
pub fn speaker_count(turns: &[ListenTurn]) -> u32 {
    let mut seen: Vec<&str> = Vec::new();
    for s in turns.iter().filter_map(|t| t.speaker.as_deref()) {
        if !seen.contains(&s) {
            seen.push(s);
        }
    }
    u32::try_from(seen.len()).unwrap_or(u32::MAX)
}

/// Speaking time per language in first-heard order (each turn counts 1 when none has a length).
fn language_weights(turns: &[ListenTurn]) -> Vec<(String, u64)> {
    let named: Vec<&ListenTurn> = turns.iter().filter(|t| !t.lang.is_empty()).collect();
    let timed = named.iter().any(|t| t.end_ms > t.start_ms);
    let mut weights: Vec<(String, u64)> = Vec::new();
    for t in named {
        let w = if timed {
            t.end_ms.saturating_sub(t.start_ms)
        } else {
            1
        };
        match weights.iter_mut().find(|(c, _)| *c == t.lang) {
            Some((_, total)) => *total += w,
            None => weights.push((t.lang.clone(), w)),
        }
    }
    weights
}

/// The share of speaking time per language: whole percents that add up to 100 (largest
/// remainder), largest first, then by code. Turns without a language are left out; when no turn
/// has a length, each turn counts once.
pub fn language_shares(turns: &[ListenTurn]) -> Vec<HeardShare> {
    let weights = language_weights(turns);
    let total: u64 = weights.iter().map(|(_, w)| w).sum();
    if total == 0 {
        return Vec::new();
    }
    let mut parts: Vec<(String, u64, u64, u64)> = weights
        .into_iter()
        .map(|(c, w)| (c, w, w * 100 / total, w * 100 % total))
        .collect();
    let given: u64 = parts.iter().map(|p| p.2).sum();
    let mut by_remainder: Vec<usize> = (0..parts.len()).collect();
    by_remainder.sort_by(|&a, &b| {
        (parts[b].3, parts[b].1)
            .cmp(&(parts[a].3, parts[a].1))
            .then_with(|| parts[a].0.cmp(&parts[b].0))
    });
    for &i in by_remainder
        .iter()
        .take(usize::try_from(100 - given).unwrap_or(0))
    {
        parts[i].2 += 1;
    }
    parts.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    parts
        .into_iter()
        .filter(|p| p.2 > 0)
        .map(|(code, _, share, _)| HeardShare {
            code,
            share: u32::try_from(share).unwrap_or(100),
        })
        .collect()
}

/// The turns sent per Spark call: consecutive runs of at most [`PART_TURNS`] turns and about
/// [`PART_CHARS`] characters of text (a longer single turn is a part of its own).
pub fn parts(turns: &[ListenTurn]) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let (mut start, mut chars) = (0, 0);
    for (i, t) in turns.iter().enumerate() {
        let n = t.text.chars().count();
        if i > start && (i - start >= PART_TURNS || chars + n > PART_CHARS) {
            out.push(start..i);
            start = i;
            chars = 0;
        }
        chars += n;
    }
    if start < turns.len() {
        out.push(start..turns.len());
    }
    out
}

/// How a part is named to the checker: the whole recording, or part `n` of `of`.
pub fn part_label(n: usize, of: usize) -> String {
    if of <= 1 {
        "the whole recording".to_owned()
    } else {
        format!("part {} of {of} of the recording", n + 1)
    }
}

#[cfg(test)]
mod tests;
