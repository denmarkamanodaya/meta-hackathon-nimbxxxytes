//! `POST /api/search`.

use std::time::Instant;

use axum::Json;
use axum::extract::State;
use nimbytes_contracts::search::{
    FaceRef, Rewritten, SearchFilters, SearchRequest, SearchResponse, SearchResult,
};
use nimbytes_core::domain::photo::wire_key;
use nimbytes_core::domain::search::Found;
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

/// The wire shape of a search answer; both search endpoints send it.
pub(super) fn wire(o: SearchOutcome) -> SearchResponse {
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
        took_ms: o.took_ms,
        cached: o.cached,
        cost_usd: o.cost_usd,
    }
}

/// A result with the fields both kinds share; the kind's own fields are filled by [`result`].
fn shared(
    score: f64,
    thumb_url: String,
    reason: Option<String>,
    faces: Vec<FaceRef>,
) -> SearchResult {
    SearchResult {
        kind: "moment".into(),
        photo_id: None,
        segment_id: String::new(),
        clip_id: String::new(),
        start_s: 0.0,
        end_s: 0.0,
        score,
        thumb_url: Some(thumb_url),
        reason,
        clip_filename: String::new(),
        clip_title: String::new(),
        recorded_at: None,
        faces,
    }
}

fn result(h: Hit) -> SearchResult {
    let faces = h
        .faces
        .into_iter()
        .map(|f| FaceRef {
            name: f.name,
            crop_url: f.crop_url,
        })
        .collect();
    let base = shared(h.score, h.thumb_url, h.reason, faces);
    match h.candidate {
        Found::Moment(c) => SearchResult {
            segment_id: c.segment_id.to_string(),
            clip_id: c.clip_id.to_string(),
            start_s: c.start_s,
            end_s: c.end_s,
            clip_filename: c.clip_filename,
            clip_title: c.clip_title,
            recorded_at: c.recorded_at,
            ..base
        },
        Found::Photo(p) => SearchResult {
            kind: "photo".into(),
            segment_id: wire_key(&p.photo.id),
            photo_id: Some(p.photo.id.to_string()),
            clip_title: p.photo.shown_title().to_owned(),
            clip_filename: p.photo.filename,
            recorded_at: p.photo.taken_at,
            ..base
        },
    }
}
