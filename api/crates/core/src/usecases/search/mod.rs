//! Hybrid search in two stages, with a fallback at every model step so a search always answers.
//!
//! - Local: the keyword leg on the raw words and the vector leg on the raw query, fused. No model
//!   call is waited on.
//! - Ranked: the Muse Spark rewrite, started together with the local stage, refines the keyword
//!   leg and the filters; then Muse Spark reranks and explains.
//!
//! Both model calls see the normalised query, so their cache keys ignore case and spacing.

mod stages;

use std::time::Duration;

use crate::domain::ids::UserId;
use crate::domain::search::{Candidate, Rewritten, normalise_query, raw_rewrite};
use crate::error::{AppError, ErrorCode};
use crate::join::join;
use crate::ports::{
    BlobStore, Catalogue, Clock, Embedder, ModelLedger, PeopleStore, Reasoner, TextIndex,
    VectorIndex,
};

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
    /// Model call log: what this search's rewrite and rerank cost.
    pub ledger: &'a dyn ModelLedger,
}

/// A face shown on a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FaceRef {
    /// The person's name.
    pub name: String,
    /// Presigned face crop.
    pub crop_url: Option<String>,
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
    /// Named people seen in the segment, one each, at most three.
    pub faces: Vec<FaceRef>,
}

/// A search answer.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchOutcome {
    /// What the query was turned into (the raw words when the rewrite failed or had not run).
    pub rewritten: Rewritten,
    /// Up to 10 results.
    pub results: Vec<Hit>,
    /// Whether the reranker ordered and explained the results.
    pub reranked: bool,
    /// Wall time from the start of the search to this answer, milliseconds.
    pub took_ms: u64,
    /// True only when every model call of this search finished so far was answered from the
    /// model cache.
    pub cached: bool,
    /// What this search's model calls finished so far cost, USD (0 when cached).
    pub cost_usd: f64,
}

/// Runs a search for `user` and returns the ranked answer.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long query; catalogue, keyword-index and signing
/// errors. Model failures and a missing vector leg never fail a search: they fall back to raw
/// keywords, BM25 only, or fused order.
pub async fn search(
    deps: &SearchDeps<'_>,
    user: &UserId,
    query: &str,
) -> Result<SearchOutcome, AppError> {
    // The local answer overlaps the rewrite, so building and dropping it adds no wait.
    search_in_stages(deps, user, query, |_| {}).await
}

/// Runs a search for `user`, handing `on_local` the local answer (raw words, fused order, no
/// reasons) as soon as it is ready, while the rewrite is still running; then returns the ranked
/// answer, exactly what [`search`] returns. `on_local` is not called when the search fails before
/// the local answer.
///
/// # Errors
/// As [`search`].
pub async fn search_in_stages(
    deps: &SearchDeps<'_>,
    user: &UserId,
    query: &str,
    on_local: impl FnOnce(SearchOutcome) + Send,
) -> Result<SearchOutcome, AppError> {
    let started = deps.clock.now_millis();
    let query = checked_query(query)?;
    let key = normalise_query(query);
    let local_stage = async {
        let local = stages::local(deps, user, query).await?;
        let (ranked, reranked) = stages::fused_order(local.pool.clone());
        let results = stages::hits(deps, user, ranked).await?;
        on_local(stages::outcome(deps, started, raw_rewrite(query), (results, reranked)).await?);
        Ok::<_, AppError>(local)
    };
    // The local stage is polled first, so it never waits behind the rewrite.
    let (local, rewritten) = join(local_stage, stages::rewrite(deps, user, &key)).await;
    let (local, rewritten) = (local?, rewritten?);
    let pool = stages::pool(deps, user, &rewritten, &local.vector).await?;
    let (ranked, reranked) = stages::rerank(deps, &key, pool).await;
    let results = stages::hits(deps, user, ranked).await?;
    stages::outcome(deps, started, rewritten, (results, reranked)).await
}

/// The query trimmed.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long query.
fn checked_query(query: &str) -> Result<&str, AppError> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "query must be 1 to 300 characters",
        ));
    }
    Ok(query)
}

/// The local stage alone: the raw words on the keyword leg and the raw query on the vector leg,
/// fused and filtered to `user`'s moments outside duplicate clips, best first. No model call.
///
/// # Errors
/// As [`search`], without the model fallbacks (there is no model call).
pub async fn local_candidates(
    deps: &SearchDeps<'_>,
    user: &UserId,
    query: &str,
) -> Result<Vec<Candidate>, AppError> {
    let local = stages::local(deps, user, checked_query(query)?).await?;
    Ok(local.pool.into_iter().map(|(c, _)| c).collect())
}
