//! MyWay guides: one clip turned into 3 to 12 numbered steps. The pure rules that turn Spark's
//! answer into steps (clamped to the clip, ordered, non-overlapping, word limits), the safety
//! refusal, the step edit rule and the sentence each step speaks.

use crate::domain::ids::{ClipId, GuideId, UserId};
use crate::domain::sam::SamRecord;
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;

/// Fewest steps a guide may have.
pub const MIN_STEPS: usize = 3;
/// Most steps a guide may have.
pub const MAX_STEPS: usize = 12;
/// Longest step (and guide) title, words.
pub const TITLE_WORDS: usize = 6;
/// Longest step instruction, words.
pub const INSTRUCTION_WORDS: usize = 18;
/// Longest control name SAM looks for, words.
pub const CONTROL_WORDS: usize = 4;
/// Longest title or instruction an edit may send, characters.
pub const MAX_TEXT_CHARS: usize = 160;
/// Longest clip a guide is made from, seconds.
pub const MAX_CLIP_S: f64 = 300.0;
/// Shortest step span kept after clamping, seconds.
pub const MIN_STEP_S: f64 = 0.5;
/// Language of the guide text and voice.
pub const LANGUAGE: &str = "en";
/// The voice every step is spoken in (Meta MMS-TTS English).
pub const VOICE: &str = "mms-tts-eng";
/// Lowest SAM confidence a step's control is circled at; below it the plain frame is shown, so a
/// wrong thing is never circled.
pub const MIN_HIGHLIGHT_CONF: f64 = 0.5;
/// Frame rate of a step's replay clip.
pub const CLIP_FPS: u32 = 30;
/// Title used when Spark gives none.
pub const FALLBACK_TITLE: &str = "My guide";
/// Longest guide title the owner may give, in characters.
pub const MAX_GUIDE_TITLE_CHARS: usize = 60;

/// What Spark says about doing the task from a guide. Serialised lower snake case.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Safety {
    /// Safe to follow from a guide.
    Everyday,
    /// Fine, with care (hot water, sharp blades).
    Caution,
    /// Medication, electrical, gas, driving: no guide is made.
    NotSupported,
}

impl Safety {
    /// Stored and wire text: `everyday`, `caution`, `not_supported`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Everyday => "everyday",
            Self::Caution => "caution",
            Self::NotSupported => "not_supported",
        }
    }

    /// Parses stored or model text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::Everyday, Self::Caution, Self::NotSupported]
            .into_iter()
            .find(|s| s.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad safety {raw}")))
    }
}

/// Where a guide is. `refused` = Spark labelled the task `not_supported`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuideStatus {
    /// Waiting for a worker.
    Queued,
    /// A worker is making it.
    Running,
    /// Every step is made.
    Ready,
    /// The job gave up; see the guide's error.
    Failed,
    /// Not an everyday task; no steps.
    Refused,
}

impl GuideStatus {
    /// Stored and wire text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Refused => "refused",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [
            Self::Queued,
            Self::Running,
            Self::Ready,
            Self::Failed,
            Self::Refused,
        ]
        .into_iter()
        .find(|s| s.as_str() == raw)
        .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad guide status {raw}")))
    }
}

/// The stage of a guide being made; each is one step of its `guide` job, in this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuideStage {
    /// Spark writes the steps.
    Steps,
    /// A frame and a replay clip per step.
    Frames,
    /// SAM circles each step's control.
    Highlight,
    /// MMS-TTS speaks each step.
    Voice,
    /// Done.
    Ready,
}

impl GuideStage {
    /// Every stage in order.
    pub const ALL: [Self; 5] = [
        Self::Steps,
        Self::Frames,
        Self::Highlight,
        Self::Voice,
        Self::Ready,
    ];

    /// Stored and wire text (also the job step name).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Steps => "steps",
            Self::Frames => "frames",
            Self::Highlight => "highlight",
            Self::Voice => "voice",
            Self::Ready => "ready",
        }
    }

    /// Parses stored text or a job step name.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        Self::ALL
            .into_iter()
            .find(|s| s.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad guide stage {raw}")))
    }
}

/// One step as Spark wrote it, before the rules run. Times are clip seconds.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftStep {
    /// Short title.
    pub title: String,
    /// One imperative action.
    pub instruction: String,
    /// Start of the step.
    pub start_s: f64,
    /// End of the step.
    pub end_s: f64,
    /// The second that best shows the step.
    pub key_s: f64,
    /// The thing to circle, or empty.
    pub control: String,
}

/// Spark's whole answer.
#[derive(Debug, Clone, PartialEq)]
pub struct GuideDraft {
    /// Whether a guide may be made.
    pub safety: Safety,
    /// Why, in a sentence.
    pub safety_reason: String,
    /// The task's title.
    pub title: String,
    /// The steps in any order.
    pub steps: Vec<DraftStep>,
}

/// A step after the rules: numbered from 1, inside the clip, after the step before it.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedStep {
    /// 1-based number.
    pub n: u32,
    /// At most [`TITLE_WORDS`] words.
    pub title: String,
    /// At most [`INSTRUCTION_WORDS`] words.
    pub instruction: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds (after start by at least [`MIN_STEP_S`]).
    pub end_s: f64,
    /// Inside `[start_s, end_s]`.
    pub key_s: f64,
    /// At most [`CONTROL_WORDS`] words; `None` when there is nothing to circle.
    pub control: Option<String>,
}

/// What the rules make of Spark's answer.
#[derive(Debug, Clone, PartialEq)]
pub enum GuidePlan {
    /// The task is not an everyday one: no steps.
    Refused {
        /// Spark's reason.
        reason: String,
    },
    /// The guide's steps.
    Steps {
        /// At most [`TITLE_WORDS`] words.
        title: String,
        /// `everyday` or `caution`.
        safety: Safety,
        /// Spark's reason.
        reason: String,
        /// 3 to 12 steps.
        steps: Vec<PlannedStep>,
    },
}

/// The first `max` words of `text`, single-spaced.
pub fn limit_words(text: &str, max: usize) -> String {
    text.split_whitespace()
        .take(max)
        .collect::<Vec<_>>()
        .join(" ")
}

fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

/// A draft step with its texts cut to their limits and its times clamped into `[0, duration_s]`;
/// `None` when a time is not a number or a text is empty.
fn cleaned(s: &DraftStep, duration_s: f64) -> Option<PlannedStep> {
    if !(s.start_s.is_finite() && s.end_s.is_finite()) {
        return None;
    }
    let title = limit_words(&s.title, TITLE_WORDS);
    let instruction = limit_words(&s.instruction, INSTRUCTION_WORDS);
    if title.is_empty() || instruction.is_empty() {
        return None;
    }
    let control = Some(limit_words(&s.control, CONTROL_WORDS)).filter(|c| !c.is_empty());
    Some(PlannedStep {
        n: 0,
        title,
        instruction,
        start_s: s.start_s.clamp(0.0, duration_s),
        end_s: s.end_s.clamp(0.0, duration_s),
        key_s: s.key_s,
        control,
    })
}

/// Steps ordered by start, each starting no earlier than the previous one ends; a step left
/// shorter than [`MIN_STEP_S`] is dropped, the key second is pulled inside its step (the middle
/// when it is not a number), and at most [`MAX_STEPS`] are kept, numbered from 1.
fn ordered(mut steps: Vec<PlannedStep>) -> Vec<PlannedStep> {
    steps.sort_by(|a, b| {
        a.start_s
            .total_cmp(&b.start_s)
            .then(a.end_s.total_cmp(&b.end_s))
    });
    let mut out: Vec<PlannedStep> = Vec::with_capacity(steps.len().min(MAX_STEPS));
    let mut prev_end = 0.0_f64;
    for mut s in steps {
        s.start_s = s.start_s.max(prev_end);
        if s.end_s - s.start_s < MIN_STEP_S {
            continue;
        }
        s.key_s = if s.key_s.is_finite() {
            s.key_s.clamp(s.start_s, s.end_s)
        } else {
            (s.start_s + s.end_s) / 2.0
        };
        prev_end = s.end_s;
        s.n = u32::try_from(out.len() + 1).unwrap_or(u32::MAX);
        out.push(s);
        if out.len() == MAX_STEPS {
            break;
        }
    }
    out
}

/// Turns Spark's answer for a `duration_s` clip into the guide: `not_supported` is refused with
/// no steps; otherwise the steps are cleaned, clamped, ordered and limited (see [`ordered`]).
///
/// # Errors
/// `MODEL_UNAVAILABLE` when fewer than [`MIN_STEPS`] steps survive the rules.
pub fn plan_guide(draft: &GuideDraft, duration_s: f64) -> Result<GuidePlan, AppError> {
    let reason = draft.safety_reason.trim().to_owned();
    if draft.safety == Safety::NotSupported {
        return Ok(GuidePlan::Refused { reason });
    }
    let duration_s = duration_s.max(0.0);
    let steps = ordered(
        draft
            .steps
            .iter()
            .filter_map(|s| cleaned(s, duration_s))
            .collect(),
    );
    if steps.len() < MIN_STEPS {
        return Err(AppError::new(
            ErrorCode::ModelUnavailable,
            format!(
                "only {} usable steps were found; a guide needs at least {MIN_STEPS}",
                steps.len()
            ),
        ));
    }
    let title = Some(limit_words(&draft.title, TITLE_WORDS))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| FALLBACK_TITLE.to_owned());
    Ok(GuidePlan::Steps {
        title,
        safety: draft.safety,
        reason,
        steps,
    })
}

/// One edited text checked: trimmed, single-spaced, not empty, within `max_words` words and
/// [`MAX_TEXT_CHARS`] characters.
fn checked_text(name: &str, raw: &str, max_words: usize) -> Result<String, AppError> {
    let text = limit_words(raw, usize::MAX);
    let invalid = |msg: String| AppError::new(ErrorCode::ValidationFailed, msg);
    if text.is_empty() {
        return Err(invalid(format!("{name} cannot be empty")));
    }
    if word_count(&text) > max_words {
        return Err(invalid(format!("{name} is at most {max_words} words")));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(format!(
            "{name} is at most {MAX_TEXT_CHARS} characters"
        )));
    }
    Ok(text)
}

/// The step's title and instruction after an edit that sends either or both.
///
/// # Errors
/// `VALIDATION_FAILED` when neither is sent, or one is empty or over its limit.
pub fn edited_step(
    (title, instruction): (&str, &str),
    (new_title, new_instruction): (Option<&str>, Option<&str>),
) -> Result<(String, String), AppError> {
    if new_title.is_none() && new_instruction.is_none() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "send a title or an instruction",
        ));
    }
    let title = match new_title {
        Some(t) => checked_text("title", t, TITLE_WORDS)?,
        None => title.to_owned(),
    };
    let instruction = match new_instruction {
        Some(i) => checked_text("instruction", i, INSTRUCTION_WORDS)?,
        None => instruction.to_owned(),
    };
    Ok((title, instruction))
}

/// A guide title the owner typed: spaces collapsed and trimmed, 1–[`MAX_GUIDE_TITLE_CHARS`]
/// characters.
///
/// # Errors
/// `VALIDATION_FAILED` when it is empty or too long.
pub fn guide_title(raw: &str) -> Result<String, AppError> {
    let title = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "a guide needs a title",
        ));
    }
    if title.chars().count() > MAX_GUIDE_TITLE_CHARS {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "a guide title is at most 60 characters",
        ));
    }
    Ok(title)
}

/// The sentence step `n` speaks: `Step 3. Turn the dial to Quick Wash.`
pub fn narration(n: u32, instruction: &str) -> String {
    let instruction = instruction.trim();
    let end = if instruction.ends_with(['.', '!', '?']) {
        ""
    } else {
        "."
    };
    format!("Step {n}. {instruction}{end}")
}

/// A short stable fingerprint of what a voice speaks (FNV-1a, 64-bit, lower-case hex), so a
/// sentence spoken once is found again and a changed sentence gets a new file.
pub fn narration_hash(voice: &str, text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in voice.bytes().chain([0]).chain(text.bytes()) {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// The SAM record to circle for a step: the most confident one with a mask at or above
/// [`MIN_HIGHLIGHT_CONF`] (the larger on a tie); `None` when there is none.
pub fn best_highlight(records: &[SamRecord]) -> Option<&SamRecord> {
    records
        .iter()
        .filter(|r| r.mask.is_some() && r.conf >= MIN_HIGHLIGHT_CONF)
        .fold(None, |best: Option<&SamRecord>, r| match best {
            Some(b) if (b.conf, b.area()) >= (r.conf, r.area()) => Some(b),
            _ => Some(r),
        })
}

/// The reason shown with a guide's safety label: Spark's reason for `caution` and
/// `not_supported`, `None` for an everyday task (nothing to warn about) or an empty reason.
pub fn shown_reason(safety: Option<Safety>, reason: Option<&str>) -> Option<String> {
    let reason = reason.map(str::trim).filter(|r| !r.is_empty())?;
    match safety? {
        Safety::Everyday => None,
        Safety::Caution | Safety::NotSupported => Some(reason.to_owned()),
    }
}

/// A stored guide.
#[derive(Debug, Clone, PartialEq)]
pub struct Guide {
    /// Guide id.
    pub id: GuideId,
    /// Owner.
    pub user_id: UserId,
    /// The clip it is made from (one guide per clip).
    pub clip_id: ClipId,
    /// Title; empty until the steps are written.
    pub title: String,
    /// Where it is.
    pub status: GuideStatus,
    /// The stage in flight while running; `ready` once done.
    pub stage: Option<GuideStage>,
    /// Spark's safety label, once known.
    pub safety: Option<Safety>,
    /// Spark's reason for the label.
    pub safety_reason: Option<String>,
    /// Language of the text and voice.
    pub language: String,
    /// Why it failed (only when failed).
    pub error: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// A stored step and the files made for it.
#[derive(Debug, Clone, PartialEq)]
pub struct GuideStep {
    /// 1-based number.
    pub n: u32,
    /// Title.
    pub title: String,
    /// Instruction.
    pub instruction: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// Key second.
    pub key_s: f64,
    /// What SAM looks for; `None` when nothing.
    pub control: Option<String>,
    /// The circled control's label; `None` when SAM found nothing (the image is the plain frame).
    pub highlight: Option<String>,
    /// The step image (the circled still, else the frame).
    pub image_key: Option<ObjectKey>,
    /// The spoken instruction (WAV).
    pub audio_key: Option<ObjectKey>,
    /// The sentence `audio_key` speaks.
    pub audio_text: Option<String>,
    /// The replay clip (MP4 of `start_s`–`end_s`).
    pub clip_key: Option<ObjectKey>,
}

impl GuideStep {
    /// A planned step with no files yet.
    pub fn planned(p: &PlannedStep) -> Self {
        Self {
            n: p.n,
            title: p.title.clone(),
            instruction: p.instruction.clone(),
            start_s: p.start_s,
            end_s: p.end_s,
            key_s: p.key_s,
            control: p.control.clone(),
            highlight: None,
            image_key: None,
            audio_key: None,
            audio_text: None,
            clip_key: None,
        }
    }
}

#[cfg(test)]
mod tests;
