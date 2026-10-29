//! [`VectorIndex`] on the sqlite-vec `segment_vectors` table (cosine distance, partitioned by
//! user, so a KNN query only scans that user's vectors).

use nimbytes_core::domain::ids::{SegmentId, UserId};
use nimbytes_core::ports::{PortResult, VectorIndex};
use sqlx::{Row, SqlitePool};

use super::db_err;

/// Segment vectors in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteVectorIndex {
    pool: SqlitePool,
}

impl SqliteVectorIndex {
    /// Wraps a migrated pool (sqlite-vec registered).
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

/// sqlite-vec reads a float32 vector from a little-endian BLOB.
pub(crate) fn blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

impl VectorIndex for SqliteVectorIndex {
    fn remove<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut tx = self.pool.begin().await.map_err(db_err)?;
            for s in segments {
                sqlx::query("DELETE FROM segment_vectors WHERE segment_id = ?")
                    .bind(s.as_str())
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
            tx.commit().await.map_err(db_err)
        })
    }

    fn upsert<'a>(
        &'a self,
        segment: &'a SegmentId,
        user: &'a UserId,
        vector: &'a [f32],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            // vec0 tables have no upsert, so replace inside one transaction.
            let mut tx = self.pool.begin().await.map_err(db_err)?;
            sqlx::query("DELETE FROM segment_vectors WHERE segment_id = ?")
                .bind(segment.as_str())
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            sqlx::query(
                "INSERT INTO segment_vectors (segment_id, user_id, embedding) VALUES (?, ?, ?)",
            )
            .bind(segment.as_str())
            .bind(user.as_str())
            .bind(blob(vector))
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
            tx.commit().await.map_err(db_err)
        })
    }

    fn similar_to<'a>(
        &'a self,
        segment: &'a SegmentId,
        skip: &'a [SegmentId],
        k: u32,
    ) -> PortResult<'a, Vec<(SegmentId, f64)>> {
        Box::pin(async move {
            let own: Option<(Vec<u8>, String)> = sqlx::query_as(
                "SELECT embedding, user_id FROM segment_vectors WHERE segment_id = ?",
            )
            .bind(segment.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
            let Some((query, user)) = own else {
                return Ok(Vec::new());
            };
            // Over-fetch by the skipped segments (and the segment itself), then drop them.
            let wanted = usize::try_from(k).unwrap_or(usize::MAX);
            let extra = u32::try_from(skip.len()).unwrap_or(u32::MAX);
            let rows = sqlx::query(
                "SELECT segment_id, distance FROM segment_vectors \
                 WHERE embedding MATCH ? AND k = ? AND user_id = ? ORDER BY distance",
            )
            .bind(query)
            .bind(k.saturating_add(extra).saturating_add(1))
            .bind(user)
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
            let mut out = Vec::with_capacity(wanted.min(rows.len()));
            for r in &rows {
                let id = SegmentId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?;
                if &id == segment || skip.contains(&id) {
                    continue;
                }
                let distance: f64 = r.try_get(1).map_err(db_err)?;
                out.push((id, 1.0 - distance));
                if out.len() == wanted {
                    break;
                }
            }
            Ok(out)
        })
    }

    fn nearest<'a>(
        &'a self,
        user: &'a UserId,
        vector: &'a [f32],
        k: u32,
    ) -> PortResult<'a, Vec<(SegmentId, f64)>> {
        Box::pin(async move {
            let rows = sqlx::query(
                "SELECT segment_id, distance FROM segment_vectors \
                 WHERE embedding MATCH ? AND k = ? AND user_id = ? ORDER BY distance",
            )
            .bind(blob(vector))
            .bind(k)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
            rows.iter()
                .map(|r| {
                    let id: String = r.try_get(0).map_err(db_err)?;
                    Ok((
                        SegmentId::parse(id)?,
                        r.try_get::<f64, _>(1).map_err(db_err)?,
                    ))
                })
                .collect()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    fn unit(i: usize) -> Vec<f32> {
        let mut v = vec![0.0; 1024];
        v[i] = 1.0;
        v
    }

    #[tokio::test]
    async fn nearest_is_per_user_and_upsert_replaces() {
        let idx = SqliteVectorIndex::new(test_pool().await);
        let (a, b) = (UserId::parse("a").unwrap(), UserId::parse("b").unwrap());
        let (s1, s2, s3) = (
            SegmentId::parse("s1").unwrap(),
            SegmentId::parse("s2").unwrap(),
            SegmentId::parse("s3").unwrap(),
        );
        idx.upsert(&s1, &a, &unit(0)).await.unwrap();
        idx.upsert(&s2, &a, &unit(1)).await.unwrap();
        idx.upsert(&s3, &b, &unit(0)).await.unwrap();

        let hits = idx.nearest(&a, &unit(0), 5).await.unwrap();
        assert_eq!(
            hits.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(),
            ["s1", "s2"]
        );
        assert!(
            hits[0].1 < 1e-6 && (hits[1].1 - 1.0).abs() < 1e-6,
            "{hits:?}"
        );

        idx.upsert(&s1, &a, &unit(1)).await.unwrap();
        let hits = idx.nearest(&a, &unit(0), 5).await.unwrap();
        assert_eq!(hits.len(), 2, "replaced, not duplicated");
    }

    #[tokio::test]
    async fn similar_to_is_the_k_nearest_of_other_clips_with_cosine_similarity() {
        let idx = SqliteVectorIndex::new(test_pool().await);
        let (a, b) = (UserId::parse("a").unwrap(), UserId::parse("b").unwrap());
        let seg = |s: &str| SegmentId::parse(s).unwrap();
        // The new clip's two moments, two near moments of another clip, a far one, and the same
        // vector of another user.
        let mut near = unit(0);
        near[1] = 0.1;
        let mut nearer = unit(0);
        nearer[1] = 0.05;
        for (s, u, v) in [
            ("new-s0", &a, unit(0)),
            ("new-s1", &a, unit(0)),
            ("old-s0", &a, near),
            ("old-s1", &a, nearer),
            ("old-s2", &a, unit(2)),
            ("theirs-s0", &b, unit(0)),
        ] {
            idx.upsert(&seg(s), u, &v).await.unwrap();
        }
        let own = [seg("new-s0"), seg("new-s1")];

        let hits = idx.similar_to(&own[0], &own, 2).await.unwrap();

        assert_eq!(
            hits.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(),
            ["old-s1", "old-s0"],
            "own moments and other users never come back; nearest first"
        );
        let expect = 1.0 / (1.0f64 + 0.05 * 0.05).sqrt();
        assert!((hits[0].1 - expect).abs() < 1e-4, "{hits:?}");
        let all = idx.similar_to(&own[0], &own, 5).await.unwrap();
        assert_eq!(all.len(), 3, "only three other moments exist");
        assert!(all[2].1.abs() < 1e-6, "an orthogonal moment is 0");
        let none = idx.similar_to(&seg("gone"), &own, 5).await.unwrap();
        assert!(
            none.is_empty(),
            "a segment without a vector has no neighbours"
        );
    }

    #[tokio::test]
    async fn removed_segments_are_never_returned_again() {
        let idx = SqliteVectorIndex::new(test_pool().await);
        let a = UserId::parse("a").unwrap();
        let (s1, s2) = (
            SegmentId::parse("s1").unwrap(),
            SegmentId::parse("s2").unwrap(),
        );
        idx.upsert(&s1, &a, &unit(0)).await.unwrap();
        idx.upsert(&s2, &a, &unit(1)).await.unwrap();

        idx.remove(&[s1, SegmentId::parse("unknown").unwrap()])
            .await
            .unwrap();

        let hits = idx.nearest(&a, &unit(0), 5).await.unwrap();
        assert_eq!(
            hits.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(),
            ["s2"]
        );
    }
}
