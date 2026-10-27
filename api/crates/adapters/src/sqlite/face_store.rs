//! [`FaceMatchStore`] on SQLite: `users.face_matching`, the sqlite-vec `face_vectors` table
//! (cosine, partitioned by user) and `face_matches` (Spark's verdict per pair, `track_a < track_b`).

use std::collections::{BTreeMap, BTreeSet};

use nimbytes_core::AppError;
use nimbytes_core::domain::face_match::{FaceLink, FaceVerdict, NamedTrack};
use nimbytes_core::domain::ids::{ClipId, PersonId, TrackId, UserId};
use nimbytes_core::ports::{FaceMatchStore, FacePair, FaceToEmbed, PortResult};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

use super::db_err;
use super::vectors::blob;

/// Visible tracks with a crop, of one user, outside duplicate clips: `f` is the track, `c` its clip.
macro_rules! eligible {
    () => {
        "FROM face_tracks f JOIN clips c ON c.id = f.clip_id \
         WHERE c.user_id = ? AND f.hidden = 0 AND c.status != 'duplicate' AND f.crop_key IS NOT NULL"
    };
}

/// Deletes the vectors of every track of `clip` (its verdicts go with the tracks, or are deleted
/// here too when the tracks stay).
pub(crate) async fn forget_clip_faces(
    tx: &mut Transaction<'_, Sqlite>,
    clip: &ClipId,
) -> Result<(), AppError> {
    for sql in [
        "DELETE FROM face_vectors WHERE track_id IN (SELECT id FROM face_tracks WHERE clip_id = ?)",
        "DELETE FROM face_matches WHERE track_a IN (SELECT id FROM face_tracks WHERE clip_id = ?) \
         OR track_b IN (SELECT id FROM face_tracks WHERE clip_id = ?)",
    ] {
        sqlx::query(sql)
            .bind(clip.as_str())
            .bind(clip.as_str())
            .bind(clip.as_str())
            .execute(&mut **tx)
            .await
            .map_err(db_err)?;
    }
    Ok(())
}

/// Deletes one track's vector and verdicts.
pub(crate) async fn forget_track_face(
    tx: &mut Transaction<'_, Sqlite>,
    track: &TrackId,
) -> Result<(), AppError> {
    for sql in [
        "DELETE FROM face_vectors WHERE track_id = ?",
        "DELETE FROM face_matches WHERE track_a = ? OR track_b = ?",
    ] {
        sqlx::query(sql)
            .bind(track.as_str())
            .bind(track.as_str())
            .execute(&mut **tx)
            .await
            .map_err(db_err)?;
    }
    Ok(())
}

/// Face matching state in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteFaceStore {
    pool: SqlitePool,
}

impl SqliteFaceStore {
    /// Wraps a migrated pool (sqlite-vec registered).
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn is_on(&self, user: &UserId) -> Result<bool, AppError> {
        let on: Option<bool> = sqlx::query_scalar("SELECT face_matching FROM users WHERE id = ?")
            .bind(user.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(on.unwrap_or(false))
    }

    async fn switch(&self, user: &UserId, on: bool) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query("UPDATE users SET face_matching = ? WHERE id = ?")
            .bind(on)
            .bind(user.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        if !on {
            for sql in [
                "DELETE FROM face_vectors WHERE user_id = ?",
                "DELETE FROM face_matches WHERE user_id = ?",
            ] {
                sqlx::query(sql)
                    .bind(user.as_str())
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
            }
        }
        tx.commit().await.map_err(db_err)
    }

    async fn to_embed(&self, user: &UserId) -> Result<Vec<FaceToEmbed>, AppError> {
        let rows = sqlx::query(concat!(
            "SELECT f.id, f.clip_id, f.crop_key ",
            eligible!(),
            " AND f.id NOT IN (SELECT track_id FROM face_vectors WHERE user_id = ?) \
             ORDER BY c.created_at, f.ordinal"
        ))
        .bind(user.as_str())
        .bind(user.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(FaceToEmbed {
                    track: TrackId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?,
                    clip: ClipId::parse(r.try_get::<String, _>(1).map_err(db_err)?)?,
                    crop_key: r.try_get(2).map_err(db_err)?,
                })
            })
            .collect()
    }

    /// Runs `write` in a transaction only while the user's switch is on, so a job still running
    /// when the owner turns matching off cannot write vectors or verdicts back.
    async fn while_on(
        &self,
        user: &UserId,
        writes: &[(&'static str, Vec<Bind>)],
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        let on: Option<bool> = sqlx::query_scalar("SELECT face_matching FROM users WHERE id = ?")
            .bind(user.as_str())
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_err)?;
        if on != Some(true) {
            return Ok(());
        }
        for (sql, binds) in writes {
            let mut q = sqlx::query(*sql);
            for b in binds {
                q = match b {
                    Bind::Text(t) => q.bind(t.clone()),
                    Bind::Real(r) => q.bind(*r),
                    Bind::Blob(v) => q.bind(v.clone()),
                };
            }
            q.execute(&mut *tx).await.map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }

    async fn eligible_crops(&self, user: &UserId) -> Result<BTreeMap<String, String>, AppError> {
        let rows = sqlx::query(concat!("SELECT f.id, f.crop_key ", eligible!()))
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter()
            .map(|r| Ok((r.try_get(0).map_err(db_err)?, r.try_get(1).map_err(db_err)?)))
            .collect()
    }

    async fn judged(&self, user: &UserId) -> Result<BTreeSet<(String, String)>, AppError> {
        let rows = sqlx::query("SELECT track_a, track_b FROM face_matches WHERE user_id = ?")
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter()
            .map(|r| Ok((r.try_get(0).map_err(db_err)?, r.try_get(1).map_err(db_err)?)))
            .collect()
    }

    async fn nearest(
        &self,
        user: &UserId,
        embedding: &[u8],
        k: u32,
    ) -> Result<Vec<(String, f64)>, AppError> {
        let rows = sqlx::query(
            "SELECT track_id, distance FROM face_vectors \
             WHERE embedding MATCH ? AND k = ? AND user_id = ? ORDER BY distance",
        )
        .bind(embedding)
        .bind(k)
        .bind(user.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|r| Ok((r.try_get(0).map_err(db_err)?, r.try_get(1).map_err(db_err)?)))
            .collect()
    }

    async fn propose(
        &self,
        user: &UserId,
        min_similarity: f64,
        k: u32,
    ) -> Result<Vec<FacePair>, AppError> {
        let crops = self.eligible_crops(user).await?;
        let judged = self.judged(user).await?;
        let mine = sqlx::query("SELECT track_id, embedding FROM face_vectors WHERE user_id = ?")
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        let mut seen = BTreeMap::new();
        for r in &mine {
            let (me, embedding): (String, Vec<u8>) =
                (r.try_get(0).map_err(db_err)?, r.try_get(1).map_err(db_err)?);
            // k + 1: the face itself is its own nearest neighbour.
            for (other, distance) in self.nearest(user, &embedding, k + 1).await? {
                let similarity = 1.0 - distance;
                let pair = if me < other {
                    (me.clone(), other)
                } else {
                    (other, me.clone())
                };
                let open = pair.0 != pair.1 && !judged.contains(&pair);
                if open && similarity >= min_similarity {
                    seen.insert(pair, similarity);
                }
            }
        }
        let mut pairs = Vec::new();
        for ((a, b), similarity) in seen {
            if let (Some(ka), Some(kb)) = (crops.get(&a), crops.get(&b)) {
                pairs.push(FacePair {
                    a: (TrackId::parse(a.clone())?, ka.clone()),
                    b: (TrackId::parse(b.clone())?, kb.clone()),
                    similarity,
                });
            }
        }
        pairs.sort_by(|x, y| y.similarity.total_cmp(&x.similarity));
        Ok(pairs)
    }

    async fn confirmed(&self, user: &UserId, min: f64) -> Result<Vec<FaceLink>, AppError> {
        let rows = sqlx::query(
            "SELECT m.track_a, m.track_b, m.confidence FROM face_matches m \
             JOIN face_tracks a ON a.id = m.track_a JOIN clips ca ON ca.id = a.clip_id \
             JOIN face_tracks b ON b.id = m.track_b JOIN clips cb ON cb.id = b.clip_id \
             WHERE m.user_id = ? AND m.same = 1 AND m.confidence >= ? \
             AND a.hidden = 0 AND b.hidden = 0 \
             AND ca.status != 'duplicate' AND cb.status != 'duplicate' \
             ORDER BY m.track_a, m.track_b",
        )
        .bind(user.as_str())
        .bind(min)
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter().map(link_from_row).collect()
    }

    async fn named(&self, user: &UserId) -> Result<Vec<NamedTrack>, AppError> {
        let rows = sqlx::query(
            "SELECT f.id, p.id, p.name FROM face_tracks f JOIN people p ON p.id = f.person_id \
             JOIN clips c ON c.id = f.clip_id \
             WHERE c.user_id = ? AND f.hidden = 0 AND c.status != 'duplicate' ORDER BY f.id",
        )
        .bind(user.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                Ok(NamedTrack {
                    track: TrackId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?,
                    person_id: PersonId::parse(r.try_get::<String, _>(1).map_err(db_err)?)?,
                    name: r.try_get(2).map_err(db_err)?,
                })
            })
            .collect()
    }
}

fn link_from_row(r: &SqliteRow) -> Result<FaceLink, AppError> {
    Ok(FaceLink {
        a: TrackId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?,
        b: TrackId::parse(r.try_get::<String, _>(1).map_err(db_err)?)?,
        confidence: r.try_get(2).map_err(db_err)?,
    })
}

/// A value bound into a conditional write.
enum Bind {
    Text(String),
    Real(f64),
    Blob(Vec<u8>),
}

impl FaceMatchStore for SqliteFaceStore {
    fn matching<'a>(&'a self, user: &'a UserId) -> PortResult<'a, bool> {
        Box::pin(self.is_on(user))
    }

    fn set_matching<'a>(&'a self, user: &'a UserId, on: bool) -> PortResult<'a, ()> {
        Box::pin(self.switch(user, on))
    }

    fn unembedded<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<FaceToEmbed>> {
        Box::pin(self.to_embed(user))
    }

    fn put_vector<'a>(
        &'a self,
        track: &'a TrackId,
        user: &'a UserId,
        vector: &'a [f32],
    ) -> PortResult<'a, ()> {
        let id = || Bind::Text(track.to_string());
        let writes = vec![
            ("DELETE FROM face_vectors WHERE track_id = ?", vec![id()]),
            (
                "INSERT INTO face_vectors (track_id, user_id, embedding) VALUES (?, ?, ?)",
                vec![id(), Bind::Text(user.to_string()), Bind::Blob(blob(vector))],
            ),
        ];
        Box::pin(async move { self.while_on(user, &writes).await })
    }

    fn proposals<'a>(
        &'a self,
        user: &'a UserId,
        min_similarity: f64,
        k: u32,
    ) -> PortResult<'a, Vec<FacePair>> {
        Box::pin(self.propose(user, min_similarity, k))
    }

    fn put_verdict<'a>(
        &'a self,
        user: &'a UserId,
        (x, y): (&'a TrackId, &'a TrackId),
        verdict: &'a FaceVerdict,
    ) -> PortResult<'a, ()> {
        let (a, b) = if x < y { (x, y) } else { (y, x) };
        let binds = vec![
            Bind::Text(a.to_string()),
            Bind::Text(b.to_string()),
            Bind::Text(user.to_string()),
            Bind::Text(i32::from(verdict.same).to_string()),
            Bind::Real(verdict.confidence),
            Bind::Text(verdict.kind.as_str().to_owned()),
        ];
        let writes = vec![(
            "INSERT INTO face_matches (track_a, track_b, user_id, same, confidence, kind) \
             VALUES (?, ?, ?, CAST(? AS INTEGER), ?, ?) ON CONFLICT (track_a, track_b) DO UPDATE \
             SET same = excluded.same, confidence = excluded.confidence, kind = excluded.kind",
            binds,
        )];
        Box::pin(async move { self.while_on(user, &writes).await })
    }

    fn links<'a>(&'a self, user: &'a UserId, min_confidence: f64) -> PortResult<'a, Vec<FaceLink>> {
        Box::pin(self.confirmed(user, min_confidence))
    }

    fn named_tracks<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<NamedTrack>> {
        Box::pin(self.named(user))
    }
}

#[cfg(test)]
mod tests;
