//! `POST /api/search`.

use std::time::Instant;

use axum::Json;
use axum::extract::State;
use nimbytes_contracts::search::{
    Rewritten, SearchFilters, SearchRequest, SearchResponse, SearchResult,
};
use nimbytes_core::usecases::search::{Hit, SearchOutcome, search};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// Hybrid search over the signed-in user's library; logs latency.
pub async fn run(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<SearchRequest>,
) -> Result<Json<SearchResponse>, ApiError> {
    let started = Instant::now();
    let out = search(&state.ports.search_deps(), &user, &body.query).await?;
    tracing::info!(
        latency_ms = started.elapsed().as_millis() as u64,
        results = out.results.len(),
        reranked = out.reranked,
        "search"
    );
    Ok(Json(wire(out)))
}

fn wire(o: SearchOutcome) -> SearchResponse {
    let f = o.rewritten.filters;
    SearchResponse {
        rewritten: Rewritten {
            keywords: o.rewritten.keywords,
            filters: SearchFilters {
                people: f.people,
                speakers: f.speakers,
                place: f.place,
                from: f.from,
                to: f.to,
                min_quality: f.min_quality,
            },
        },
        results: o.results.into_iter().map(result).collect(),
        reranked: o.reranked,
    }
}

fn result(h: Hit) -> SearchResult {
    let c = h.candidate;
    SearchResult {
        segment_id: c.segment_id.to_string(),
        clip_id: c.clip_id.to_string(),
        start_s: c.start_s,
        end_s: c.end_s,
        score: h.score,
        thumb_url: Some(h.thumb_url),
        reason: h.reason,
        clip_filename: c.clip_filename,
        recorded_at: c.recorded_at,
    }
}
