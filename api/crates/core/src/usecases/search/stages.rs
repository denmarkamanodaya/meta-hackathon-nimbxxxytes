//! The steps both search stages share: the query rewrite, the two legs fused into a filtered
//! pool, the rerank, signed results and the search's cost summary.

use crate::domain::ids::{PhotoId, SegmentId, UserId};
use crate::domain::photo::photo_of;
use crate::domain::search::{
    Candidate, Found, LEG_DEPTH, PhotoCandidate, RERANK_POOL, RESULTS, Rewritten, found_matches,
    known_only, raw_rewrite, result_faces, rrf,
};
use crate::error::AppError;
use crate::keys::{self, ObjectKey};
use crate::ports::{EpochMillis, RewriteRequest, VectorIndex, purpose};
use crate::time::{day_with_weekday, format_utc};

use super::{FaceRef, Hit, SearchDeps, SearchOutcome};

/// The model calls a search makes, as the cost log names them.
const SEARCH_PURPOSES: [&str; 2] = [purpose::QUERY_REWRITE, purpose::RERANK];

/// Fused candidates with their scores, best first.
pub(super) type Pool = Vec<(Found, f64)>;

/// Ranked candidates with their scores and rerank reasons.
pub(super) type Ranked = Vec<(Found, f64, Option<String>)>;

/// What the local stage found without any model call.
pub(super) struct Local {
    /// Vector-leg hits for the raw query (moments, then photos when searched); the ranked stage
    /// reuses them.
    pub(super) vector: Vec<Vec<SegmentId>>,
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

/// The `k` nearest keys of `user` in `index`; empty when the index fails.
async fn nearest(index: &dyn VectorIndex, user: &UserId, v: &[f32]) -> Vec<SegmentId> {
    index
        .nearest(user, v, LEG_DEPTH)
        .await
        .map(|hits| hits.into_iter().map(|(id, _)| id).collect())
        .unwrap_or_default()
}

/// Vector-leg hits: one list for moments and, when photos are searched, one for photos (PE's
/// text tower against both). A missing leg (no embedder answer or no vectors yet) is empty,
/// which leaves keyword search alone.
async fn vector_leg(deps: &SearchDeps<'_>, user: &UserId, query: &str) -> Vec<Vec<SegmentId>> {
    let Ok(v) = deps.embedder.embed_text(query).await else {
        return Vec::new();
    };
    let mut lists = vec![nearest(deps.vectors, user, &v).await];
    if let Some(photos) = deps.photos {
        lists.push(nearest(photos.vectors, user, &v).await);
    }
    lists
}

/// The fused keys as moments and photos of `user`, in fused order (unknown keys left out, and
/// every photo key when photos are not searched).
async fn hydrate(
    deps: &SearchDeps<'_>,
    user: &UserId,
    fused: Vec<(SegmentId, f64)>,
) -> Result<Pool, AppError> {
    let photo_ids: Vec<PhotoId> = fused.iter().filter_map(|(id, _)| photo_of(id)).collect();
    let moment_ids: Vec<SegmentId> = fused
        .iter()
        .filter(|(id, _)| photo_of(id).is_none())
        .map(|(id, _)| id.clone())
        .collect();
    let rows = deps.catalogue.candidates(user, &moment_ids).await?;
    let photos = match (deps.photos, photo_ids.is_empty()) {
        (Some(p), false) => p.store.many(user, &photo_ids).await?,
        _ => Vec::new(),
    };
    Ok(fused
        .into_iter()
        .filter_map(|(id, score)| {
            let found = match photo_of(&id) {
                Some(pid) => photos.iter().find(|p| p.id == pid).map(|p| {
                    Found::Photo(PhotoCandidate {
                        key: id.clone(),
                        photo: p.clone(),
                    })
                }),
                None => rows
                    .iter()
                    .find(|c| c.segment_id == id)
                    .map(|c| Found::Moment(c.clone())),
            };
            found.map(|f| (f, score))
        })
        .collect())
}

/// The keyword leg for `r`'s words and names fused with the `vector` lists, as moments and
/// photos that pass `r`'s filters, at most [`RERANK_POOL`].
pub(super) async fn pool(
    deps: &SearchDeps<'_>,
    user: &UserId,
    r: &Rewritten,
    vector: &[Vec<SegmentId>],
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
    let mut lists = vec![keyword];
    lists.extend(vector.iter().cloned());
    let pool = hydrate(deps, user, rrf(&lists)).await?;
    Ok(pool
        .into_iter()
        .filter(|(f, _)| found_matches(&r.filters, f))
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
    let candidates: Vec<Found> = pool.iter().map(|(c, _)| c.clone()).collect();
    if candidates.is_empty() {
        return (Vec::new(), false);
    }
    match deps.reasoner.rerank(key, &candidates).await {
        Ok(picks) => {
            let mut out: Ranked = Vec::new();
            for (id, reason) in picks {
                let already = out.iter().any(|(c, _, _)| c.key() == &id);
                if let Some((c, s)) = pool
                    .iter()
                    .find(|(c, _)| c.key() == &id)
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

/// Ranked candidates as results with signed thumbnails and (for moments) faces.
pub(super) async fn hits(
    deps: &SearchDeps<'_>,
    user: &UserId,
    ranked: Ranked,
) -> Result<Vec<Hit>, AppError> {
    let mut results = Vec::with_capacity(ranked.len());
    for (candidate, score, reason) in ranked {
        let (key, faces) = match &candidate {
            Found::Moment(c) => (
                keys::thumb(user, &c.clip_id, &c.segment_id),
                face_refs(deps, c).await?,
            ),
            Found::Photo(p) => (keys::photo_thumb(user, &p.photo.id), Vec::new()),
        };
        let thumb_url = deps.blobs.presign_get(&key, deps.url_ttl).await?;
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
