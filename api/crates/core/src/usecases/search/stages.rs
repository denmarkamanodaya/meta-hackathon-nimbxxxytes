//! The steps both search stages share: the query rewrite, the two legs fused into a filtered
//! pool, the rerank, signed results and the search's cost summary.

use crate::domain::ids::{SegmentId, UserId};
use crate::domain::search::{
    Candidate, LEG_DEPTH, RERANK_POOL, RESULTS, Rewritten, known_only, matches, raw_rewrite,
    result_faces, rrf,
};
use crate::error::AppError;
use crate::keys::{self, ObjectKey};
use crate::ports::{EpochMillis, RewriteRequest, purpose};
use crate::time::{day_with_weekday, format_utc};

use super::{FaceRef, Hit, SearchDeps, SearchOutcome};

/// The model calls a search makes, as the cost log names them.
const SEARCH_PURPOSES: [&str; 2] = [purpose::QUERY_REWRITE, purpose::RERANK];

/// Fused candidates with their scores, best first.
pub(super) type Pool = Vec<(Candidate, f64)>;

/// Ranked candidates with their scores and rerank reasons.
pub(super) type Ranked = Vec<(Candidate, f64, Option<String>)>;

/// What the local stage found without any model call.
pub(super) struct Local {
    /// Vector-leg hits for the raw query; the ranked stage reuses them.
    pub(super) vector: Vec<SegmentId>,
    /// Both legs fused on the raw words.
    pub(super) pool: Pool,
}

/// The local stage: the raw words on the keyword leg, the raw query on the vector leg, fused.
pub(super) async fn local(
    deps: &SearchDeps<'_>,
    user: &UserId,
    query: &str,
) -> Result<Local, AppError> {
    let vector = vector_leg(deps, user, query).await;
    let pool = pool(deps, user, &raw_rewrite(query), &vector).await?;
    Ok(Local { vector, pool })
}

/// The rewrite of the normalised query `key`, keeping only names the user has; the raw words of
/// `key` when the model fails or returns no keywords.
pub(super) async fn rewrite(
    deps: &SearchDeps<'_>,
    user: &UserId,
    key: &str,
) -> Result<Rewritten, AppError> {
    let (people, speakers) = deps.people.known_names(user).await?;
    let today = day_with_weekday(deps.clock.now_millis());
    let request = RewriteRequest {
        query: key.to_owned(),
        today,
        people: people.clone(),
        speakers: speakers.clone(),
    };
    Ok(match deps.reasoner.rewrite(&request).await {
        Ok(r) if !r.keywords.is_empty() => known_only(r, &people, &speakers),
        _ => raw_rewrite(key),
    })
}

/// Vector-leg hits; a missing leg (no embedder answer or no vectors yet) is empty, which leaves
/// keyword search alone.
async fn vector_leg(deps: &SearchDeps<'_>, user: &UserId, query: &str) -> Vec<SegmentId> {
    match deps.embedder.embed_text(query).await {
        Ok(v) => deps
            .vectors
            .nearest(user, &v, LEG_DEPTH)
            .await
            .map(|hits| hits.into_iter().map(|(id, _)| id).collect())
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// The keyword leg for `r`'s words and names fused with `vector`, as candidates that pass `r`'s
/// filters, at most [`RERANK_POOL`].
pub(super) async fn pool(
    deps: &SearchDeps<'_>,
    user: &UserId,
    r: &Rewritten,
    vector: &[SegmentId],
) -> Result<Pool, AppError> {
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
    let fused = rrf(&[keyword, vector.to_vec()]);
    let ids: Vec<SegmentId> = fused.iter().map(|(id, _)| id.clone()).collect();
    let rows = deps.catalogue.candidates(user, &ids).await?;
    Ok(fused
        .into_iter()
        .filter_map(|(id, score)| {
            rows.iter()
                .find(|c| c.segment_id == id)
                .map(|c| (c.clone(), score))
        })
        .filter(|(c, _)| matches(&r.filters, c))
        .take(RERANK_POOL)
        .collect())
}

/// The fused order without reasons (rerank failed, timed out or kept nothing).
pub(super) fn fused_order(pool: Pool) -> (Ranked, bool) {
    (
        pool.into_iter()
            .take(RESULTS)
            .map(|(c, s)| (c, s, None))
            .collect(),
        false,
    )
}

/// Rerank order with reasons for the normalised query `key`, or the fused order without them
/// when rerank fails or keeps nothing. Ids the model invents, or repeats, are dropped.
pub(super) async fn rerank(deps: &SearchDeps<'_>, key: &str, pool: Pool) -> (Ranked, bool) {
    let candidates: Vec<Candidate> = pool.iter().map(|(c, _)| c.clone()).collect();
    if candidates.is_empty() {
        return (Vec::new(), false);
    }
    match deps.reasoner.rerank(key, &candidates).await {
        Ok(picks) => {
            let mut out: Ranked = Vec::new();
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

/// Ranked candidates as results with signed thumbnails and faces.
pub(super) async fn hits(
    deps: &SearchDeps<'_>,
    user: &UserId,
    ranked: Ranked,
) -> Result<Vec<Hit>, AppError> {
    let mut results = Vec::with_capacity(ranked.len());
    for (candidate, score, reason) in ranked {
        let key = keys::thumb(user, &candidate.clip_id, &candidate.segment_id);
        let thumb_url = deps.blobs.presign_get(&key, deps.url_ttl).await?;
        let faces = face_refs(deps, &candidate).await?;
        results.push(Hit {
            candidate,
            score,
            reason,
            thumb_url,
            faces,
        });
    }
    Ok(results)
}

/// The faces a result shows, with signed crops.
async fn face_refs(deps: &SearchDeps<'_>, c: &Candidate) -> Result<Vec<FaceRef>, AppError> {
    let mut out = Vec::new();
    for f in result_faces(&c.faces) {
        let crop_url = match f.crop_key {
            Some(k) => Some(
                deps.blobs
                    .presign_get(&ObjectKey::from_stored(k), deps.url_ttl)
                    .await?,
            ),
            None => None,
        };
        out.push(FaceRef {
            name: f.name,
            crop_url,
        });
    }
    Ok(out)
}

/// An answer with its wall time since `started` and the spend of this search's model calls
/// finished so far.
pub(super) async fn outcome(
    deps: &SearchDeps<'_>,
    started: EpochMillis,
    rewritten: Rewritten,
    (results, reranked): (Vec<Hit>, bool),
) -> Result<SearchOutcome, AppError> {
    let usage = deps
        .ledger
        .usage_since(&format_utc(started), &SEARCH_PURPOSES)
        .await?;
    Ok(SearchOutcome {
        rewritten,
        results,
        reranked,
        took_ms: u64::try_from(deps.clock.now_millis() - started).unwrap_or(0),
        cached: usage.calls > 0 && usage.cache_hits == usage.calls,
        cost_usd: usage.cost_usd,
    })
}
