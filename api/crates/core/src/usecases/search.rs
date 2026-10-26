//! Hybrid search: rewrite → keyword leg + vector leg → fusion → filters → rerank, with a
//! fallback at every model step so a search always answers.

use std::time::Duration;

use crate::domain::ids::{SegmentId, UserId};
use crate::domain::search::{
    Candidate, LEG_DEPTH, RERANK_POOL, RESULTS, Rewritten, known_only, matches, raw_rewrite, rrf,
};
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{
    BlobStore, Catalogue, Clock, Embedder, PeopleStore, Reasoner, RewriteRequest, TextIndex,
    VectorIndex,
};
use crate::time::day_with_weekday;

/// Longest accepted query, characters.
pub const MAX_QUERY_CHARS: usize = 300;

/// Ports search needs.
pub struct SearchDeps<'a> {
    /// Candidate rows.
    pub catalogue: &'a dyn Catalogue,
    /// Known names for the rewrite.
    pub people: &'a dyn PeopleStore,
    /// Rewrite and rerank.
    pub reasoner: &'a dyn Reasoner,
    /// Keyword leg.
    pub text: &'a dyn TextIndex,
    /// Query embedding for the vector leg.
    pub embedder: &'a dyn Embedder,
    /// Vector leg.
    pub vectors: &'a dyn VectorIndex,
    /// Thumbnail URLs.
    pub blobs: &'a dyn BlobStore,
    /// Today's date for relative dates.
    pub clock: &'a dyn Clock,
    /// Lifetime of thumbnail URLs.
    pub url_ttl: Duration,
}

/// One result.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    /// The segment and its clip facts.
    pub candidate: Candidate,
    /// Fused score (higher is better).
    pub score: f64,
    /// Rerank reason; `None` when rerank did not run.
    pub reason: Option<String>,
    /// Presigned thumbnail.
    pub thumb_url: String,
}

/// A search answer.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchOutcome {
    /// What the query was turned into (the raw words when the rewrite failed).
    pub rewritten: Rewritten,
    /// Up to 10 results.
    pub results: Vec<Hit>,
    /// Whether the reranker ordered and explained the results.
    pub reranked: bool,
}

/// Runs a search for `user`.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long query; catalogue, keyword-index and signing
/// errors. Model failures and a missing vector leg never
/// fail a search: they fall back to raw keywords, BM25 only, or fused order.
pub async fn search(
    deps: &SearchDeps<'_>,
    user: &UserId,
    query: &str,
) -> Result<SearchOutcome, AppError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "query must be 1 to 300 characters",
        ));
    }
    let rewritten = rewrite(deps, user, query).await?;
    let fused = fuse(deps, user, query, &rewritten).await?;
    let ids: Vec<SegmentId> = fused.iter().map(|(id, _)| id.clone()).collect();
    let rows = deps.catalogue.candidates(user, &ids).await?;
    let pool: Vec<(Candidate, f64)> = fused
        .into_iter()
        .filter_map(|(id, score)| {
            rows.iter()
                .find(|c| c.segment_id == id)
                .map(|c| (c.clone(), score))
        })
        .filter(|(c, _)| matches(&rewritten.filters, c))
        .take(RERANK_POOL)
        .collect();
    let (ranked, reranked) = rerank(deps, query, pool).await;
    let mut results = Vec::with_capacity(ranked.len());
    for (candidate, score, reason) in ranked {
        let key = keys::thumb(user, &candidate.clip_id, &candidate.segment_id);
        let thumb_url = deps.blobs.presign_get(&key, deps.url_ttl).await?;
        results.push(Hit {
            candidate,
            score,
            reason,
            thumb_url,
        });
    }
    Ok(SearchOutcome {
        rewritten,
        results,
        reranked,
    })
}

async fn rewrite(deps: &SearchDeps<'_>, user: &UserId, query: &str) -> Result<Rewritten, AppError> {
    let (people, speakers) = deps.people.known_names(user).await?;
    let today = day_with_weekday(deps.clock.now_millis());
    let request = RewriteRequest {
        query: query.to_owned(),
        today,
        people: people.clone(),
        speakers: speakers.clone(),
    };
    Ok(match deps.reasoner.rewrite(&request).await {
        Ok(r) if !r.keywords.is_empty() => known_only(r, &people, &speakers),
        _ => raw_rewrite(query),
    })
}

async fn fuse(
    deps: &SearchDeps<'_>,
    user: &UserId,
    query: &str,
    r: &Rewritten,
) -> Result<Vec<(SegmentId, f64)>, AppError> {
    let mut words = r.keywords.clone();
    words.extend(r.filters.people.iter().cloned());
    words.extend(r.filters.speakers.iter().cloned());
    let keyword: Vec<SegmentId> = deps
        .text
        .search(user, &words.join(" "), LEG_DEPTH)
        .await?
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    // A missing vector leg (no embedder answer or no vectors yet) leaves keyword search alone.
    let vector: Vec<SegmentId> = match deps.embedder.embed_text(query).await {
        Ok(v) => deps
            .vectors
            .nearest(user, &v, LEG_DEPTH)
            .await
            .map(|hits| hits.into_iter().map(|(id, _)| id).collect())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    Ok(rrf(&[keyword, vector]))
}

/// The fused order without reasons (rerank failed, timed out or kept nothing).
fn fused_order(pool: Vec<(Candidate, f64)>) -> (Vec<(Candidate, f64, Option<String>)>, bool) {
    (
        pool.into_iter()
            .take(RESULTS)
            .map(|(c, s)| (c, s, None))
            .collect(),
        false,
    )
}

/// Rerank order with reasons, or the fused order without them when rerank fails or keeps
/// nothing. Ids the model
/// invents, or repeats, are dropped.
async fn rerank(
    deps: &SearchDeps<'_>,
    query: &str,
    pool: Vec<(Candidate, f64)>,
) -> (Vec<(Candidate, f64, Option<String>)>, bool) {
    let candidates: Vec<Candidate> = pool.iter().map(|(c, _)| c.clone()).collect();
    if candidates.is_empty() {
        return (Vec::new(), false);
    }
    match deps.reasoner.rerank(query, &candidates).await {
        Ok(picks) => {
            let mut out: Vec<(Candidate, f64, Option<String>)> = Vec::new();
            for (id, reason) in picks {
                let already = out.iter().any(|(c, _, _)| c.segment_id == id);
                if let Some((c, s)) = pool
                    .iter()
                    .find(|(c, _)| c.segment_id == id)
                    .filter(|_| !already)
                {
                    out.push((c.clone(), *s, Some(reason)));
                }
            }
            out.truncate(RESULTS);
            if out.is_empty() {
                // The reranker keeps nothing even for literal keyword or speech hits ("what
                // city" said on camera); showing the fused hits beats showing none.
                fused_order(pool)
            } else {
                (out, true)
            }
        }
        Err(_) => fused_order(pool),
    }
}
