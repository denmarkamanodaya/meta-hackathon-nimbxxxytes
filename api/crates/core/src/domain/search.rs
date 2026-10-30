//! Search: the structured query, candidate filtering and reciprocal rank fusion.

use std::collections::HashMap;

use crate::domain::ids::{ClipId, SegmentId};
use crate::domain::photo::Photo;

/// RRF constant: a rank-r item scores `1 / (k + r)`.
pub const RRF_K: f64 = 60.0;
/// Hits taken from each leg before fusion.
pub const LEG_DEPTH: u32 = 60;
/// Fused candidates sent to the reranker.
pub const RERANK_POOL: usize = 30;
/// Results returned.
pub const RESULTS: usize = 10;
/// Most keywords kept from a query.
pub const MAX_KEYWORDS: usize = 8;

/// Structured filters from the query rewrite; empty or `None` means no filter.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SearchFilters {
    /// Names that must appear in the shot.
    pub people: Vec<String>,
    /// Names that must be heard.
    pub speakers: Vec<String>,
    /// Place phrase.
    pub place: Option<String>,
    /// First day, `YYYY-MM-DD`, inclusive.
    pub from: Option<String>,
    /// Last day, `YYYY-MM-DD`, inclusive.
    pub to: Option<String>,
    /// Lowest quality 0–10.
    pub min_quality: Option<u8>,
}

/// The rewritten query.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Rewritten {
    /// Keyword-index terms.
    pub keywords: Vec<String>,
    /// Filters.
    pub filters: SearchFilters,
}

/// The query as the model calls see it, so their cache keys match: trimmed, lower case, every
/// run of whitespace one space. "Dog " and "dog" are one search.
pub fn normalise_query(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Fallback rewrite: the raw query's words (lower case, at most 8), no filters.
pub fn raw_rewrite(query: &str) -> Rewritten {
    let keywords = query
        .split_whitespace()
        .map(str::to_lowercase)
        .take(MAX_KEYWORDS)
        .collect();
    Rewritten {
        keywords,
        filters: SearchFilters::default(),
    }
}

/// Keeps only filter names the user actually has (the model must not invent people), matched
/// case-insensitively and spelled as stored.
pub fn known_only(mut r: Rewritten, people: &[String], speakers: &[String]) -> Rewritten {
    let keep = |names: Vec<String>, known: &[String]| -> Vec<String> {
        names
            .iter()
            .filter_map(|n| {
                known
                    .iter()
                    .find(|k| k.eq_ignore_ascii_case(n.trim()))
                    .cloned()
            })
            .collect()
    };
    r.filters.people = keep(r.filters.people, people);
    r.filters.speakers = keep(r.filters.speakers, speakers);
    r
}

/// One searchable segment with what filters and the reranker need.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// Segment.
    pub segment_id: SegmentId,
    /// Clip.
    pub clip_id: ClipId,
    /// Clip file name.
    pub clip_filename: String,
    /// Clip title as shown (the file name without extension until a title is written).
    pub clip_title: String,
    /// Span start, clip seconds.
    pub start_s: f64,
    /// Span end, clip seconds.
    pub end_s: f64,
    /// Recording time (ISO-8601 UTC).
    pub recorded_at: Option<String>,
    /// Facts description.
    pub description: String,
    /// Place.
    pub place: String,
    /// Visible named people.
    pub people: Vec<String>,
    /// Named speakers heard.
    pub speakers: Vec<String>,
    /// Speech text.
    pub speech: String,
    /// Quality 0–10.
    pub quality: Option<u8>,
    /// Named, visible face tracks seen in the segment, biggest face first (may repeat a name).
    pub faces: Vec<FaceSeen>,
}

/// A named face seen in a segment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceSeen {
    /// The person's name.
    pub name: String,
    /// Stored key of the track's face crop.
    pub crop_key: Option<String>,
}

/// Most faces shown on one result.
pub const RESULT_FACES: usize = 3;

/// The faces a result shows: the first (biggest) track of each person, at most [`RESULT_FACES`].
pub fn result_faces(seen: &[FaceSeen]) -> Vec<FaceSeen> {
    let mut out: Vec<FaceSeen> = Vec::new();
    for f in seen {
        if out.len() == RESULT_FACES {
            break;
        }
        if !out.iter().any(|o| o.name.eq_ignore_ascii_case(&f.name)) {
            out.push(f.clone());
        }
    }
    out
}

/// Whether `c` passes every filter. Names compare case-insensitively; place matches as a
/// case-insensitive substring of the place label or description; dates compare the UTC day.
pub fn matches(f: &SearchFilters, c: &Candidate) -> bool {
    let has = |list: &[String], name: &String| list.iter().any(|x| x.eq_ignore_ascii_case(name));
    let people_ok = f.people.iter().all(|p| has(&c.people, p));
    let speakers_ok = f.speakers.iter().all(|s| has(&c.speakers, s));
    let place_ok = f.place.as_ref().is_none_or(|p| {
        let p = p.to_lowercase();
        c.place.to_lowercase().contains(&p) || c.description.to_lowercase().contains(&p)
    });
    let day = c.recorded_at.as_deref().and_then(|r| r.get(..10));
    let from_ok = f
        .from
        .as_deref()
        .is_none_or(|from| day.is_some_and(|d| d >= from));
    let to_ok =
        f.to.as_deref()
            .is_none_or(|to| day.is_some_and(|d| d <= to));
    let quality_ok = f
        .min_quality
        .is_none_or(|q| c.quality.is_some_and(|cq| cq >= q));
    people_ok && speakers_ok && place_ok && from_ok && to_ok && quality_ok
}

/// A photo found by search, under its search key.
#[derive(Debug, Clone, PartialEq)]
pub struct PhotoCandidate {
    /// The photo's search key (`photo_{id}`).
    pub key: SegmentId,
    /// The photo and its facts.
    pub photo: Photo,
}

/// Something search found: a moment of a clip, or a photo.
#[derive(Debug, Clone, PartialEq)]
pub enum Found {
    /// A stretch of a video clip.
    Moment(Candidate),
    /// A photo.
    Photo(PhotoCandidate),
}

impl Found {
    /// The key both indexes use.
    pub fn key(&self) -> &SegmentId {
        match self {
            Self::Moment(c) => &c.segment_id,
            Self::Photo(p) => &p.key,
        }
    }

    /// The moment, if it is one.
    pub fn moment(&self) -> Option<&Candidate> {
        match self {
            Self::Moment(c) => Some(c),
            Self::Photo(_) => None,
        }
    }
}

/// Whether a photo passes every filter: it has no named people, speakers or quality, so any
/// of those filters leaves it out; place matches its place or description; dates compare the
/// UTC day taken.
pub fn photo_matches(f: &SearchFilters, p: &Photo) -> bool {
    if !f.people.is_empty() || !f.speakers.is_empty() || f.min_quality.is_some() {
        return false;
    }
    let place_ok = f.place.as_ref().is_none_or(|place| {
        let place = place.to_lowercase();
        p.facts.place.to_lowercase().contains(&place)
            || p.facts.description.to_lowercase().contains(&place)
    });
    let day = p.taken_at.as_deref().and_then(|t| t.get(..10));
    let from_ok = f
        .from
        .as_deref()
        .is_none_or(|from| day.is_some_and(|d| d >= from));
    let to_ok =
        f.to.as_deref()
            .is_none_or(|to| day.is_some_and(|d| d <= to));
    place_ok && from_ok && to_ok
}

/// Whether `found` passes every filter ([`matches`] for a moment, [`photo_matches`] for a photo).
pub fn found_matches(f: &SearchFilters, found: &Found) -> bool {
    match found {
        Found::Moment(c) => matches(f, c),
        Found::Photo(p) => photo_matches(f, &p.photo),
    }
}

/// Reciprocal rank fusion over ranked id lists: score = Σ 1 / (60 + rank), rank from 1. Ties keep
/// the order of first appearance (list order, then rank).
pub fn rrf(lists: &[Vec<SegmentId>]) -> Vec<(SegmentId, f64)> {
    let mut scores: HashMap<&SegmentId, f64> = HashMap::new();
    let mut order: Vec<&SegmentId> = Vec::new();
    for list in lists {
        for (rank, id) in list.iter().enumerate() {
            let entry = scores.entry(id).or_insert_with(|| {
                order.push(id);
                0.0
            });
            *entry += 1.0 / (RRF_K + (rank + 1) as f64);
        }
    }
    let mut fused: Vec<(SegmentId, f64)> = order
        .into_iter()
        .map(|id| (id.clone(), scores[id]))
        .collect();
    // A stable sort keeps first-appearance order between equal scores.
    fused.sort_by(|a, b| b.1.total_cmp(&a.1));
    fused
}

#[cfg(test)]
mod tests;
