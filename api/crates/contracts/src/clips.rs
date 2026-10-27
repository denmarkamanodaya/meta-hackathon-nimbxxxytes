//! `GET /api/clips`.

use nimbytes_core::domain::clip::ClipStatus;
pub use nimbytes_core::domain::job::StepStatus;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One library row. Fields unknown until processing are `null`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ClipSummary {
    /// Clip id.
    pub clip_id: String,
    /// File name on the phone.
    pub filename: String,
    /// Short title written from the clip's moments; the file name without extension until then.
    pub title: String,
    /// Length in seconds.
    pub duration_s: Option<f64>,
    /// Recording time, ISO-8601 UTC.
    pub recorded_at: Option<String>,
    /// Lifecycle status.
    #[schemars(with = "String")]
    pub status: ClipStatus,
    /// Presigned thumbnail URL.
    pub thumb_url: Option<String>,
    /// Number of segments.
    pub segment_count: u32,
    /// Names of the people seen in the clip.
    pub people: Vec<String>,
    /// The clip this one copies, when `status` is `duplicate`.
    pub duplicate_of: Option<String>,
}

/// One 5–10 s window of a clip. Fact fields are null until the describe step has run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Segment {
    /// Segment id.
    pub segment_id: String,
    /// 0-based order within the clip.
    pub idx: u32,
    /// Start, seconds from clip start (inclusive).
    pub start_s: f64,
    /// End, seconds from clip start (exclusive).
    pub end_s: f64,
    /// One or two sentences.
    pub description: Option<String>,
    /// Short action phrases; `[]` when none.
    pub actions: Vec<String>,
    /// Visible objects; `[]` when none.
    pub objects: Vec<String>,
    /// Place.
    pub place: Option<String>,
    /// Mood.
    pub mood: Option<String>,
    /// Visual quality 0–10.
    pub quality: Option<u8>,
    /// Opening-shot strength 0–10.
    pub hook_score: Option<u8>,
    /// Presigned thumbnail URL.
    pub thumb_url: Option<String>,
}

/// One transcript turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Turn {
    /// Turn id.
    pub turn_id: String,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// What was said.
    pub text: String,
    /// The speaker row, when diarization assigned one.
    pub speaker_id: Option<String>,
}

/// A speaker in one clip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Speaker {
    /// Speaker id.
    pub speaker_id: String,
    /// Raw diarization label from Voice Transcribe: a letter, `"A"`, `"B"`, ….
    pub label: String,
    /// Name the user gave; null until named.
    pub display_name: Option<String>,
}

/// A face track: one detected person across the clip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct Track {
    /// Track id.
    pub track_id: String,
    /// Presigned URL of the best face crop.
    pub crop_url: Option<String>,
    /// First appearance, clip seconds.
    pub first_s: f64,
    /// Last appearance, clip seconds.
    pub last_s: f64,
    /// Linked person's name.
    pub person_name: Option<String>,
    /// Marked as a bystander.
    pub hidden: bool,
}

/// `GET /api/clips/{id}`. Lists are `[]` when empty; `segments` and `turns` sorted by `start_s`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct ClipDetail {
    /// The clip row.
    pub clip: ClipSummary,
    /// Presigned GET URL of the 720p proxy (S3 serves byte ranges); null until made.
    pub proxy_url: Option<String>,
    /// Segments.
    pub segments: Vec<Segment>,
    /// Transcript turns.
    pub turns: Vec<Turn>,
    /// Speakers.
    pub speakers: Vec<Speaker>,
    /// Face tracks.
    pub tracks: Vec<Track>,
}

/// `data` of one unnamed SSE event on `GET /api/clips/{id}/events`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ClipEvent {
    /// One of the ingest steps (`nimbytes_core::domain::job::INGEST_STEPS`).
    pub step: String,
    /// Step state: `running`, `done` or `failed`.
    #[schemars(with = "String")]
    pub status: StepStatus,
}

#[cfg(test)]
mod tests;
