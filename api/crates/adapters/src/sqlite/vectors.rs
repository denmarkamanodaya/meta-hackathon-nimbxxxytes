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
fn blob(v: &[f32]) -> Vec<u8> {
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
