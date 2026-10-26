//! `POST /api/search`.

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
    /// Recording time.
    pub recorded_at: Option<String>,
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
}
