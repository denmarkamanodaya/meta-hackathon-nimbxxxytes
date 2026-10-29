//! [`ClipLinkStore`] on the `clip_links` table (one row per ordered clip pair; rows go with
//! either clip).

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ClipId, UserId};
use nimbytes_core::domain::similar::{ClipLink, LinkKind};
use nimbytes_core::ports::{ClipLinkStore, PortResult};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::db_err;

/// Clip links in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteClipLinks {
    pool: SqlitePool,
}

impl SqliteClipLinks {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// The links matching `filter`, a condition with one `?` for `id` per `binds`.
    async fn rows(
        &self,
        filter: &'static str,
        id: &str,
        binds: usize,
    ) -> Result<Vec<ClipLink>, AppError> {
        let sql = format!(
            "SELECT clip_id, other_id, kind, score FROM clip_links WHERE {filter} \
             ORDER BY score DESC, clip_id, other_id"
        );
        let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
        for _ in 0..binds {
            q = q.bind(id);
        }
        let rows = q.fetch_all(&self.pool).await.map_err(db_err)?;
        rows.iter().map(link).collect()
    }
}

fn link(r: &SqliteRow) -> Result<ClipLink, AppError> {
    Ok(ClipLink {
        clip: ClipId::parse(r.try_get::<String, _>("clip_id").map_err(db_err)?)?,
        other: ClipId::parse(r.try_get::<String, _>("other_id").map_err(db_err)?)?,
        kind: LinkKind::parse(&r.try_get::<String, _>("kind").map_err(db_err)?)?,
        score: r.try_get("score").map_err(db_err)?,
    })
}

impl ClipLinkStore for SqliteClipLinks {
    fn save<'a>(
        &'a self,
        user: &'a UserId,
        links: &'a [ClipLink],
        now: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut tx = self.pool.begin().await.map_err(db_err)?;
            for l in links {
                sqlx::query(
                    "INSERT INTO clip_links (user_id, clip_id, other_id, kind, score, created_at) \
                     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (clip_id, other_id) \
                     DO UPDATE SET kind = excluded.kind, score = excluded.score",
                )
                .bind(user.as_str())
                .bind(l.clip.as_str())
                .bind(l.other.as_str())
                .bind(l.kind.as_str())
                .bind(l.score)
                .bind(now)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
            }
            tx.commit().await.map_err(db_err)
        })
    }

    fn of_clip<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, Vec<ClipLink>> {
        Box::pin(self.rows("clip_id = ? OR other_id = ?", clip.as_str(), 2))
    }

    fn of_user<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<ClipLink>> {
        Box::pin(self.rows("user_id = ?", user.as_str(), 1))
    }

    fn keep<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query(
                "UPDATE clip_links SET kind = 'kept' WHERE clip_id = ? AND kind = 'near_copy_of'",
            )
            .bind(clip.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> SqliteClipLinks {
        let pool = test_pool().await;
        for sql in [
            "INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1', 't'), ('u2', 'u2', 't')",
            "INSERT INTO clips (id, user_id, filename, ext, size_bytes, status, created_at) VALUES \
             ('a', 'u1', 'a.mp4', 'mp4', 1, 'ready', 't'), \
             ('b', 'u1', 'b.mp4', 'mp4', 1, 'near_copy', 't'), \
             ('c', 'u1', 'c.mp4', 'mp4', 1, 'ready', 't'), \
             ('z', 'u2', 'z.mp4', 'mp4', 1, 'ready', 't')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        SqliteClipLinks::new(pool)
    }

    fn id(s: &str) -> ClipId {
        ClipId::parse(s).unwrap()
    }

    fn copy(of: &str, from: &str, score: f64) -> ClipLink {
        ClipLink {
            clip: id(from),
            other: id(of),
            kind: LinkKind::NearCopyOf,
            score,
        }
    }

    #[tokio::test]
    async fn links_are_read_both_ways_and_replaced_per_pair() {
        let s = store().await;
        let u1 = UserId::parse("u1").unwrap();
        s.save(&u1, &[copy("a", "b", 0.9)], "t").await.unwrap();
        s.save(
            &u1,
            &[
                copy("a", "b", 0.95),
                ClipLink::same_moment(&id("c"), &id("a"), 0.88),
            ],
            "t",
        )
        .await
        .unwrap();
        s.save(
            &UserId::parse("u2").unwrap(),
            &[ClipLink::same_moment(&id("z"), &id("z2"), 0.9)],
            "t",
        )
        .await
        .unwrap_err();

        let of_a = s.of_clip(&id("a")).await.unwrap();
        assert_eq!(s.of_user(&u1).await.unwrap().len(), 2);
        assert_eq!(
            of_a,
            [
                copy("a", "b", 0.95),
                ClipLink::same_moment(&id("a"), &id("c"), 0.88)
            ],
            "replaced, not doubled; strongest first"
        );
        assert!(
            s.of_user(&UserId::parse("u2").unwrap())
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn keep_turns_the_copys_near_copy_links_into_kept_pairs() {
        let s = store().await;
        let u1 = UserId::parse("u1").unwrap();
        let same = ClipLink::same_moment(&id("b"), &id("c"), 0.9);
        s.save(&u1, &[copy("a", "b", 0.95), same.clone()], "t")
            .await
            .unwrap();

        s.keep(&id("b")).await.unwrap();
        let kinds: Vec<LinkKind> = s
            .of_clip(&id("b"))
            .await
            .unwrap()
            .iter()
            .map(|l| l.kind)
            .collect();
        assert_eq!(
            kinds,
            [LinkKind::Kept, LinkKind::SameMoment],
            "only the near-copy link"
        );
    }
}
