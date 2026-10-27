//! [`ShortStore`] on SQLite: `shorts`, `short_segments`, `short_versions` and `agent_steps`.
//! Version and step rows get ids derived from the short (`{short}-v{n}`, `{short}-s{seq}`), so a
//! rerun step can never add a second copy.

use nimbytes_core::AppError;
use nimbytes_core::domain::captions::SpokenTurn;
use nimbytes_core::domain::critique::Critique;
use nimbytes_core::domain::ids::{ClipId, SegmentId, ShortId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::short::{
    NewStep, Short, ShortSegment, ShortStatus, Step, StepKind, Version,
};
use nimbytes_core::domain::timeline::{Aspect, Timeline};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{PortResult, ShortStore};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::db_err;

/// Shorts on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteShortStore {
    pool: SqlitePool,
}

fn u32_of(raw: i64) -> Result<u32, AppError> {
    u32::try_from(raw).map_err(|_| AppError::new(nimbytes_core::ErrorCode::Internal, "bad count"))
}

fn json_err(e: serde_json::Error) -> AppError {
    AppError::new(
        nimbytes_core::ErrorCode::Internal,
        format!("stored timeline: {e}"),
    )
}

fn short_from(r: &SqliteRow) -> Result<Short, AppError> {
    let get_opt = |c: &str| r.try_get::<Option<i64>, _>(c).map_err(db_err);
    let render_key: Option<String> = r.try_get("render_key").map_err(db_err)?;
    let render = match (render_key, get_opt("render_version")?) {
        (Some(key), Some(n)) => Some((ObjectKey::from_stored(key), u32_of(n)?)),
        _ => None,
    };
    Ok(Short {
        id: ShortId::parse(r.try_get::<String, _>("id").map_err(db_err)?)?,
        user_id: UserId::parse(r.try_get::<String, _>("user_id").map_err(db_err)?)?,
        prompt: r.try_get("prompt").map_err(db_err)?,
        aspect: Aspect::parse(r.try_get("aspect").map_err(db_err)?)?,
        target_s: r.try_get("target_s").map_err(db_err)?,
        status: ShortStatus::parse(r.try_get("status").map_err(db_err)?)?,
        best_version: get_opt("best_version")?.map(u32_of).transpose()?,
        render,
        created_at: r.try_get("created_at").map_err(db_err)?,
    })
}

fn score(raw: Option<i64>) -> Option<u8> {
    raw.and_then(|q| u8::try_from(q).ok())
}

/// Columns a moment is read from (`s` = segments, `c` = clips); a macro so the SQL stays a
/// compile-time literal.
macro_rules! moment_columns {
    () => {
        "s.id, s.clip_id, c.ext, s.start_s, s.end_s, s.description, s.hook_score, s.quality"
    };
}

/// `seq, kind, tool, version, summary, at` of an `agent_steps` row.
type StepRow = (i64, String, Option<String>, Option<i64>, String, String);

impl SqliteShortStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn exec(&self, sql: &'static str, binds: &[Option<&str>]) -> Result<(), AppError> {
        let mut q = sqlx::query(sql);
        for b in binds {
            q = q.bind(*b);
        }
        q.execute(&self.pool).await.map_err(db_err)?;
        Ok(())
    }

    async fn owners(&self, ids: &[SegmentId]) -> Result<Vec<(SegmentId, UserId)>, AppError> {
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let owner: Option<String> = sqlx::query_scalar(
                "SELECT c.user_id FROM segments s JOIN clips c ON c.id = s.clip_id WHERE s.id = ?",
            )
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
            if let Some(owner) = owner {
                out.push((id.clone(), UserId::parse(owner)?));
            }
        }
        Ok(out)
    }

    async fn insert(&self, s: &Short, segments: &[SegmentId]) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query(
            "INSERT INTO shorts (id, user_id, prompt, aspect, target_s, status, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(s.id.as_str())
        .bind(s.user_id.as_str())
        .bind(&s.prompt)
        .bind(s.aspect.as_str())
        .bind(s.target_s)
        .bind(s.status.as_str())
        .bind(&s.created_at)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        for (ord, seg) in segments.iter().enumerate() {
            sqlx::query("INSERT INTO short_segments (short_id, ord, segment_id) VALUES (?, ?, ?)")
                .bind(s.id.as_str())
                .bind(i64::try_from(ord).unwrap_or(i64::MAX))
                .bind(seg.as_str())
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }

    async fn one(&self, id: &ShortId) -> Result<Option<Short>, AppError> {
        let row = sqlx::query("SELECT * FROM shorts WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(short_from).transpose()
    }

    async fn picked(&self, id: &ShortId) -> Result<Vec<ShortSegment>, AppError> {
        let sql = concat!(
            "SELECT ",
            moment_columns!(),
            " FROM short_segments ss JOIN segments s ON s.id = ss.segment_id \
             JOIN clips c ON c.id = s.clip_id WHERE ss.short_id = ? ORDER BY ss.ord"
        );
        let rows = sqlx::query(sql)
            .bind(id.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        self.moments_from(&rows).await
    }

    async fn of_user(
        &self,
        user: &UserId,
        ids: &[SegmentId],
    ) -> Result<Vec<ShortSegment>, AppError> {
        let sql = concat!(
            "SELECT ",
            moment_columns!(),
            " FROM segments s JOIN clips c ON c.id = s.clip_id \
             WHERE c.user_id = ? AND c.status != 'duplicate' AND s.id = ?"
        );
        let mut rows = Vec::with_capacity(ids.len());
        for id in ids {
            let row = sqlx::query(sql)
                .bind(user.as_str())
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(db_err)?;
            rows.extend(row);
        }
        self.moments_from(&rows).await
    }

    /// Rows of [`MOMENT_COLUMNS`] as moments with their overlapping turns.
    async fn moments_from(&self, rows: &[SqliteRow]) -> Result<Vec<ShortSegment>, AppError> {
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let clip_id = ClipId::parse(r.try_get::<String, _>(1).map_err(db_err)?)?;
            let span = Span {
                start_s: r.try_get(3).map_err(db_err)?,
                end_s: r.try_get(4).map_err(db_err)?,
            };
            let turns = self.turns(&clip_id, span).await?;
            out.push(ShortSegment {
                segment_id: SegmentId::parse(r.try_get::<String, _>(0).map_err(db_err)?)?,
                clip_id,
                clip_ext: MediaExt::parse(r.try_get(2).map_err(db_err)?)?,
                span,
                description: r.try_get(5).map_err(db_err)?,
                hook_score: score(r.try_get(6).map_err(db_err)?),
                quality: score(r.try_get(7).map_err(db_err)?),
                turns,
            });
        }
        Ok(out)
    }

    async fn library_ids(&self, user: &UserId) -> Result<Vec<SegmentId>, AppError> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT s.id FROM segments s JOIN clips c ON c.id = s.clip_id \
             WHERE c.user_id = ? AND c.status != 'duplicate' ORDER BY c.created_at, s.idx",
        )
        .bind(user.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        ids.into_iter().map(SegmentId::parse).collect()
    }

    async fn append_picks(&self, id: &ShortId, segments: &[SegmentId]) -> Result<(), AppError> {
        for seg in segments {
            sqlx::query(
                "INSERT INTO short_segments (short_id, ord, segment_id) \
                 SELECT ?, COALESCE(MAX(ord) + 1, 0), ? FROM short_segments WHERE short_id = ? \
                 ON CONFLICT DO NOTHING",
            )
            .bind(id.as_str())
            .bind(seg.as_str())
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        }
        Ok(())
    }

    /// Turns of `clip` that overlap `span` (touching edges do not count).
    async fn turns(&self, clip: &ClipId, span: Span) -> Result<Vec<SpokenTurn>, AppError> {
        let rows: Vec<(f64, f64, String)> = sqlx::query_as(
            "SELECT start_s, end_s, text FROM transcript_turns \
             WHERE clip_id = ? AND start_s < ? AND end_s > ? ORDER BY start_s",
        )
        .bind(clip.as_str())
        .bind(span.end_s)
        .bind(span.start_s)
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(rows
            .into_iter()
            .map(|(start_s, end_s, text)| SpokenTurn {
                span: Span { start_s, end_s },
                text,
            })
            .collect())
    }

    async fn insert_version(&self, id: &ShortId, n: u32, t: &Timeline) -> Result<(), AppError> {
        let json = serde_json::to_string(t).map_err(json_err)?;
        sqlx::query("INSERT INTO short_versions (id, short_id, n, timeline) VALUES (?, ?, ?, ?)")
            .bind(format!("{id}-v{n}"))
            .bind(id.as_str())
            .bind(n)
            .bind(json)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn all_versions(&self, id: &ShortId) -> Result<Vec<Version>, AppError> {
        let rows: Vec<(i64, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT n, timeline, preview_key, critique FROM short_versions \
             WHERE short_id = ? ORDER BY n",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.into_iter()
            .map(|(n, timeline, preview, critique)| {
                Ok(Version {
                    n: u32_of(n)?,
                    timeline: serde_json::from_str(&timeline).map_err(json_err)?,
                    preview_key: preview.map(ObjectKey::from_stored),
                    critique: critique
                        .map(|c| serde_json::from_str(&c))
                        .transpose()
                        .map_err(json_err)?,
                })
            })
            .collect()
    }

    async fn append(&self, id: &ShortId, s: &NewStep) -> Result<u32, AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        let next: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(seq) + 1, 0) FROM agent_steps WHERE short_id = ?",
        )
        .bind(id.as_str())
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        sqlx::query(
            "INSERT INTO agent_steps (id, short_id, seq, kind, tool, version, summary, at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("{id}-s{next}"))
        .bind(id.as_str())
        .bind(next)
        .bind(s.kind.as_str())
        .bind(s.tool.as_deref())
        .bind(s.version)
        .bind(&s.summary)
        .bind(&s.at)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
        u32_of(next)
    }

    async fn log(&self, id: &ShortId) -> Result<Vec<Step>, AppError> {
        let rows: Vec<StepRow> = sqlx::query_as(
            "SELECT seq, kind, tool, version, summary, at FROM agent_steps \
                 WHERE short_id = ? ORDER BY seq",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.into_iter()
            .map(|(seq, kind, tool, version, summary, at)| {
                Ok(Step {
                    seq: u32_of(seq)?,
                    step: NewStep {
                        kind: StepKind::parse(&kind)?,
                        tool,
                        version: version.map(u32_of).transpose()?,
                        summary,
                        at,
                    },
                })
            })
            .collect()
    }
}

impl ShortStore for SqliteShortStore {
    fn segment_owners<'a>(
        &'a self,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<(SegmentId, UserId)>> {
        Box::pin(self.owners(ids))
    }

    fn create<'a>(&'a self, short: &'a Short, segments: &'a [SegmentId]) -> PortResult<'a, ()> {
        Box::pin(self.insert(short, segments))
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Short>> {
        Box::pin(async move {
            let rows = sqlx::query(
                "SELECT * FROM shorts WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            )
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
            rows.iter().map(short_from).collect()
        })
    }

    fn get<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Option<Short>> {
        Box::pin(self.one(id))
    }

    fn segments<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<ShortSegment>> {
        Box::pin(self.picked(id))
    }

    fn moments<'a>(
        &'a self,
        user: &'a UserId,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<ShortSegment>> {
        Box::pin(self.of_user(user, ids))
    }

    fn library<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<SegmentId>> {
        Box::pin(self.library_ids(user))
    }

    fn add_segments<'a>(
        &'a self,
        id: &'a ShortId,
        segments: &'a [SegmentId],
    ) -> PortResult<'a, ()> {
        Box::pin(self.append_picks(id, segments))
    }

    fn add_version<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        timeline: &'a Timeline,
    ) -> PortResult<'a, ()> {
        Box::pin(self.insert_version(id, n, timeline))
    }

    fn versions<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<Version>> {
        Box::pin(self.all_versions(id))
    }

    fn set_preview<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        key: &'a ObjectKey,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let n = n.to_string();
            self.exec(
                "UPDATE short_versions SET preview_key = ? WHERE short_id = ? AND n = ?",
                &[Some(key.as_str()), Some(id.as_str()), Some(&n)],
            )
            .await
        })
    }

    fn set_critique<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        critique: &'a Critique,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let json = serde_json::to_string(critique).map_err(json_err)?;
            sqlx::query(
                "UPDATE short_versions SET critique = ?, score_total = ? \
                 WHERE short_id = ? AND n = ?",
            )
            .bind(json)
            .bind(critique.total)
            .bind(id.as_str())
            .bind(n)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }

    fn set_status<'a>(&'a self, id: &'a ShortId, status: ShortStatus) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.exec(
                "UPDATE shorts SET status = ? WHERE id = ?",
                &[Some(status.as_str()), Some(id.as_str())],
            )
            .await
        })
    }

    fn set_best_version<'a>(&'a self, id: &'a ShortId, n: u32) -> PortResult<'a, ()> {
        Box::pin(async move {
            let n = n.to_string();
            self.exec(
                "UPDATE shorts SET best_version = ? WHERE id = ?",
                &[Some(&n), Some(id.as_str())],
            )
            .await
        })
    }

    fn set_render<'a>(
        &'a self,
        id: &'a ShortId,
        render: Option<(&'a ObjectKey, u32)>,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let n = render.map(|(_, n)| n.to_string());
            self.exec(
                "UPDATE shorts SET render_key = ?, render_version = ? WHERE id = ?",
                &[
                    render.map(|(k, _)| k.as_str()),
                    n.as_deref(),
                    Some(id.as_str()),
                ],
            )
            .await
        })
    }

    fn add_step<'a>(&'a self, id: &'a ShortId, step: &'a NewStep) -> PortResult<'a, u32> {
        Box::pin(self.append(id, step))
    }

    fn steps<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<Step>> {
        Box::pin(self.log(id))
    }

    fn delete<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, ()> {
        Box::pin(self.remove(id))
    }
}

mod remove;
#[cfg(test)]
mod tests;
