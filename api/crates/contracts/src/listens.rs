//! iListen: `POST /api/listens`, `PUT /api/listens/{id}/source`, `POST /api/listens/{id}/complete`,
//! `GET /api/listens`, `GET/PATCH/DELETE /api/listens/{id}` and
//! `POST /api/listens/{id}/language`. Every key is always present; empty values are `null`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `POST /api/listens` body: a file from the device, or a clip already in the library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateListenRequest {
    /// The file's name on the device; `null` with `clip_id`.
    pub filename: Option<String>,
    /// `audio/*` (mpeg, mp4, x-m4a, aac, wav, x-wav, ogg, flac, webm) or `video/*`; `null` with
    /// `clip_id`.
    pub content_type: Option<String>,
    /// The file's size, at most 300 MB; `null` with `clip_id`.
    pub size_bytes: Option<u64>,
    /// A clip of this user to listen to instead of a file.
    pub clip_id: Option<String>,
    /// Output language code from `OUTPUT_LANGUAGES` (`en`, `zh`, `ja`, `ko`, `tl`, `es`, `fr`,
    /// `de`, `id`, `vi`, `th`, `hi`).
    pub target: String,
}

/// `POST /api/listens` (201).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateListenResponse {
    /// The new listen.
    pub listen_id: String,
    /// `uploading` for a file (PUT the source, then complete), `listening` for a clip.
    pub status: String,
}

/// `POST /api/listens/{id}/complete` (202), after `PUT /api/listens/{id}/source`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CompleteListenResponse {
    /// The listen.
    pub listen_id: String,
    /// `listening`.
    pub status: String,
}

/// One language heard, with its share of the speech by time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct HeardLanguage {
    /// ISO 639-1 code (`zh`, `ja`, `en`, …).
    pub code: String,
    /// Whole percent of the speaking time; the shares add up to 100.
    pub share: u32,
}

/// One row of `GET /api/listens`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ListenSummary {
    /// Listen id.
    pub id: String,
    /// In the output language; `""` until understood.
    pub title: String,
    /// The file name, or the clip's title.
    pub source_name: String,
    /// `file` or `clip`.
    pub source_kind: String,
    /// The clip, for `source_kind = clip`.
    pub clip_id: Option<String>,
    /// `uploading`, `listening`, `ready` or `failed`.
    pub status: String,
    /// The step running while `listening`: `audio`, `transcribe`, `understand`, `check` or `voice`.
    pub step: Option<String>,
    /// The version being checked or fixed during `check`; the final version once ready.
    pub version: u32,
    /// Output language code.
    pub target: String,
    /// Languages heard, largest share first; empty until understood.
    pub languages: Vec<HeardLanguage>,
    /// Audio length; `null` before the audio step.
    pub duration_ms: Option<u64>,
    /// Distinct speakers; `0` before transcription.
    pub speakers: u32,
    /// Lowest check score of the final version (0–100); `null` until checked.
    pub confidence: Option<u32>,
    /// `true` when the final version passed (every line and the summary ≥ 90).
    pub passed: bool,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// Why it failed; `null` unless failed.
    pub error: Option<String>,
}

/// One spoken line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ListenTurn {
    /// 0-based.
    pub index: u32,
    /// Start within the audio.
    pub start_ms: u64,
    /// End within the audio.
    pub end_ms: u64,
    /// Speaker label (`A`, `B`, …); `null` when unknown.
    pub speaker: Option<String>,
    /// Language spoken (ISO 639-1); `""` until understood.
    pub lang: String,
    /// What was said, as transcribed.
    pub text: String,
    /// In the output language; `""` until understood.
    pub translation: String,
    /// Check score of this line in the final version; `null` until checked.
    pub score: Option<u32>,
    /// The checker's note on this line; `""` when none.
    pub issue: String,
    /// The version that last changed this line's translation (1 = never fixed).
    pub fixed_in: u32,
}

/// One version of the translation and summary, with its check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ListenVersion {
    /// 1, 2 or 3.
    pub version: u32,
    /// Lowest score of the lines and the summary (0–100); `null` while checking.
    pub confidence: Option<u32>,
    /// Summary score (0–100); `null` while checking.
    pub summary_score: Option<u32>,
    /// `true` when every line and the summary scored ≥ 90.
    pub passed: bool,
    /// Short notes: flagged lines and summary issues.
    pub notes: Vec<String>,
}

/// `GET /api/listens/{id}`, `PATCH /api/listens/{id}` and `POST /api/listens/{id}/language`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ListenDetail {
    /// Every summary field.
    #[serde(flatten)]
    pub summary_row: ListenSummary,
    /// In the output language, two to four sentences; `""` until understood.
    pub summary: String,
    /// In the output language, at most five.
    pub key_points: Vec<String>,
    /// Every line in order.
    pub turns: Vec<ListenTurn>,
    /// Every version made, oldest first.
    pub versions: Vec<ListenVersion>,
    /// The summary spoken (WAV, English only); `null` otherwise.
    pub summary_audio_url: Option<String>,
}

/// `PATCH /api/listens/{id}` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct RenameListen {
    /// 1–80 characters after tidying.
    pub title: String,
}

/// `POST /api/listens/{id}/language` body: re-runs understand, check and voice only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ChangeListenLanguage {
    /// Output language code from `OUTPUT_LANGUAGES`.
    pub target: String,
}
