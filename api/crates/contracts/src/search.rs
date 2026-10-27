//! `POST /api/search` and `POST /api/search/stream`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Search request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SearchRequest {
    /// What the user typed.
    pub query: String,
}

/// Filters the rewrite extracted; empty lists and nulls mean no filter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SearchFilters {
    /// People that must be in the shot.
    pub people: Vec<String>,
    /// Speakers that must be heard.
    pub speakers: Vec<String>,
    /// Place phrase.
    pub place: Option<String>,
    /// First day `YYYY-MM-DD`.
    pub from: Option<String>,
    /// Last day `YYYY-MM-DD`.
    pub to: Option<String>,
    /// Lowest quality 0–10.
    pub min_quality: Option<u8>,
}

/// What the query became.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Rewritten {
    /// Keyword terms.
    pub keywords: Vec<String>,
    /// Filters.
    pub filters: SearchFilters,
}

/// One result; `reason` is always present and null when rerank did not run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SearchResult {
    /// Segment.
    pub segment_id: String,
    /// Clip.
    pub clip_id: String,
    /// Start, clip seconds (deep link `?t=`).
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// Fused score, higher is better.
    pub score: f64,
    /// Presigned thumbnail.
    pub thumb_url: Option<String>,
    /// One-line reason from the reranker.
    pub reason: Option<String>,
    /// Clip file name.
    pub clip_filename: String,
    /// Clip title (the file name without extension until a title is written).
    pub clip_title: String,
    /// Recording time.
    pub recorded_at: Option<String>,
    /// Named people seen in the segment, one each, at most 3.
    pub faces: Vec<FaceRef>,
}

/// A named face on a search result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct FaceRef {
    /// The person's name.
    pub name: String,
    /// Presigned face crop.
    pub crop_url: Option<String>,
}

/// Search response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct SearchResponse {
    /// The rewritten query.
    pub rewritten: Rewritten,
    /// Up to 10 results.
    pub results: Vec<SearchResult>,
    /// Whether the reranker ran.
    pub reranked: bool,
    /// Wall time of the whole search, milliseconds.
    pub took_ms: u64,
    /// True only when every model call of this search was a model-cache hit.
    pub cached: bool,
    /// Spend of this search's model calls, USD (0 when cached).
    pub cost_usd: f64,
}

/// Event names of `POST /api/search/stream`, in the order they are sent. `local` and `ranked`
/// carry a [`SearchResponse`]; `error` (sent instead of `ranked`) carries the error envelope;
/// `done` carries [`STREAM_DONE_DATA`] and ends the stream.
pub mod stream_event {
    /// The instant answer: raw words, fused order, no reasons.
    pub const LOCAL: &str = "local";
    /// The answer `POST /api/search` gives.
    pub const RANKED: &str = "ranked";
    /// The ranked stage failed; the local answer stands.
    pub const ERROR: &str = "error";
    /// Last event.
    pub const DONE: &str = "done";
}

/// Data of the `done` event: an empty object, because an event with empty data is never
/// dispatched by a standard SSE reader.
pub const STREAM_DONE_DATA: &str = "{}";
