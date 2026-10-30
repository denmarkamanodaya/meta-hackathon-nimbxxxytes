//! Memory Lane: `POST /api/memories`, `GET /api/memories`, `GET /api/memories/{id}` and
//! `DELETE /api/memories/{id}`. Every key is always present; empty values are `null`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `POST /api/memories` body: exactly one of `person_id` and `clip_id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateMemoryRequest {
    /// One of the caller's named people to remember.
    pub person_id: Option<String>,
    /// Or one of the caller's clips (a day) to remember.
    pub clip_id: Option<String>,
    /// Who watches: one of the caller's named people; `null` when nobody is named.
    pub viewer_id: Option<String>,
}

/// `POST /api/memories` (201).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CreateMemoryResponse {
    /// The new session.
    pub memory_id: String,
    /// `making`.
    pub status: String,
}

/// One session in the list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct MemorySummary {
    /// Id.
    pub id: String,
    /// Title; `""` until written.
    pub title: String,
    /// `person` or `clip`.
    pub subject_kind: String,
    /// The person's name or the clip's title.
    pub subject_name: String,
    /// Who watches; `null` when nobody is named.
    pub viewer_name: Option<String>,
    /// `making`, `ready` or `failed`.
    pub status: String,
    /// `find`, `write`, `check` or `cover` while making; else `null`.
    pub step: Option<String>,
    /// Moments in the session.
    pub moment_count: u32,
    /// Lines the check rewrote or dropped.
    pub fixed_count: u32,
    /// The cover, signed; `null` before it is drawn or when it could not be.
    pub cover_url: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// Why it failed; else `null`.
    pub error: Option<String>,
}

/// A named person seen in a moment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct MemoryPerson {
    /// The caller's person (`""` when the name no longer matches one).
    pub person_id: String,
    /// Their name.
    pub name: String,
    /// One of their face crops, signed; else `null`.
    pub crop_url: Option<String>,
}

/// One moment of a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct MemoryMoment {
    /// 0-based order in the session.
    pub index: u32,
    /// The clip.
    pub clip_id: String,
    /// The clip's title.
    pub clip_title: String,
    /// When the clip was recorded (ISO-8601 UTC); else `null`.
    pub recorded_at: Option<String>,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// The clip's 720p proxy, signed.
    pub proxy_url: Option<String>,
    /// A frame of the moment, signed.
    pub thumb_url: Option<String>,
    /// The named people present.
    pub people: Vec<MemoryPerson>,
    /// The caption line read aloud.
    pub line: String,
    /// The gentle question to the viewer.
    pub prompt: String,
    /// Whether the check ran on the line.
    pub checked: bool,
    /// What the check changed; else `null`.
    pub fixed_note: Option<String>,
}

/// `GET /api/memories/{id}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct MemoryDetail {
    /// The list row.
    pub summary: MemorySummary,
    /// The moments, in session order; `[]` until found.
    pub moments: Vec<MemoryMoment>,
}
