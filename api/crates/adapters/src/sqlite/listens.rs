//! [`ListenStore`] on SQLite: `listens` (key points and languages as JSON), `listen_turns` (one
//! per line, holding the kept version's translation), `listen_versions` (draft and check as JSON)
//! and `listen_voices` (every voice file made, for deleting).

use nimbytes_core::domain::ids::{ClipId, ListenId, UserId};
use nimbytes_core::domain::listen::{
    HeardBy, Listen, ListenSource, ListenStatus, ListenTurn, ListenVersion, speaker_count,
};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{ListenProgress, ListenResult, ListenStore, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::{db_err, to_i64, to_u64};

/// Listen rows in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteListenStore {
    pool: SqlitePool,
}

macro_rules! listen_columns {
    () => {
        "id, user_id, source, clip_id, source_name, content_type, ext, size_bytes, status, step, \
         version, target, title, summary, key_points, languages, duration_ms, speakers, \
         heard_by, confidence, passed, summary_audio_key, cover_key, error, created_at, updated_at"
    };
}

/// A JSON column written or read: serde_json's error as `INTERNAL`.
fn json<T>(r: Result<T, serde_json::Error>, column: &str) -> Result<T, AppError> {
    r.map_err(|e| AppError::new(ErrorCode::Internal, format!("bad {column}: {e}")))
}

fn small(raw: Option<i64>) -> Option<u32> {
    raw.and_then(|n| u32::try_from(n).ok())
}

fn listen_from(row: &SqliteRow) -> Result<Listen, AppError> {
    let get = |c: &str| row.try_get::<String, _>(c).map_err(db_err);
    let maybe = |c: &str| row.try_get::<Option<String>, _>(c).map_err(db_err);
    let int = |c: &str| row.try_get::<i64, _>(c).map_err(db_err);
    let maybe_int = |c: &str| row.try_get::<Option<i64>, _>(c).map_err(db_err);
    Ok(Listen {
        id: ListenId::parse(get("id")?)?,
        user_id: UserId::parse(get("user_id")?)?,
        source: ListenSource::parse(&get("source")?)?,
        clip_id: maybe("clip_id")?.map(ClipId::parse).transpose()?,
        source_name: get("source_name")?,
        content_type: get("content_type")?,
        ext: get("ext")?,
        size_bytes: to_u64(int("size_bytes")?, "size_bytes")?,
        status: ListenStatus::parse(&get("status")?)?,
        step: maybe("step")?,
        version: small(Some(int("version")?)).unwrap_or(0),
        target: get("target")?,
        title: get("title")?,
        summary: get("summary")?,
        key_points: json(serde_json::from_str(&get("key_points")?), "key_points")?,
        languages: json(serde_json::from_str(&get("languages")?), "languages")?,
        duration_ms: maybe_int("duration_ms")?
            .map(|n| to_u64(n, "duration_ms"))
            .transpose()?,
        speakers: small(Some(int("speakers")?)).unwrap_or(0),
        heard_by: maybe("heard_by")?.map(|h| HeardBy::parse(&h)).transpose()?,
        confidence: small(maybe_int("confidence")?),
        passed: int("passed")? == 1,
        summary_audio_key: maybe("summary_audio_key")?.map(ObjectKey::from_stored),
        cover_key: maybe("cover_key")?.map(ObjectKey::from_stored),
        error: maybe("error")?,
        created_at: get("created_at")?,
        updated_at: get("updated_at")?,
    })
}

fn turn_from(row: &SqliteRow) -> Result<ListenTurn, AppError> {
    let int = |c: &str| row.try_get::<i64, _>(c).map_err(db_err);
    let get = |c: &str| row.try_get::<String, _>(c).map_err(db_err);
    Ok(ListenTurn {
        index: small(Some(int("idx")?)).unwrap_or(0),
        start_ms: to_u64(int("start_ms")?, "start_ms")?,
        end_ms: to_u64(int("end_ms")?, "end_ms")?,
        speaker: row.try_get("speaker").map_err(db_err)?,
        text: get("text")?,
        lang: get("lang")?,
        translation: get("translation")?,
        score: small(row.try_get("score").map_err(db_err)?),
        issue: get("issue")?,
        fixed_in: small(Some(int("fixed_in")?)).unwrap_or(1),
    })
}

fn version_from(row: &SqliteRow) -> Result<ListenVersion, AppError> {
    let version: i64 = row.try_get("version").map_err(db_err)?;
    let draft: String = row.try_get("draft").map_err(db_err)?;
    let checked: Option<String> = row.try_get("checked").map_err(db_err)?;
    Ok(ListenVersion {
        version: small(Some(version)).unwrap_or(0),
        draft: json(serde_json::from_str(&draft), "draft")?,
        check: checked
            .map(|c| json(serde_json::from_str(&c), "checked"))
            .transpose()?,
    })
}

impl SqliteListenStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert(&self, l: &Listen) -> Result<(), AppError> {
        sqlx::query(concat!(
            "INSERT INTO listens (",
            listen_columns!(),
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(l.id.as_str())
        .bind(l.user_id.as_str())
        .bind(l.source.as_str())
        .bind(l.clip_id.as_ref().map(ClipId::as_str))
        .bind(&l.source_name)
        .bind(&l.content_type)
        .bind(&l.ext)
        .bind(to_i64(l.size_bytes, "size_bytes")?)
        .bind(l.status.as_str())
        .bind(&l.step)
        .bind(i64::from(l.version))
        .bind(&l.target)
        .bind(&l.title)
        .bind(&l.summary)
        .bind(json(serde_json::to_string(&l.key_points), "key_points")?)
        .bind(json(serde_json::to_string(&l.languages), "languages")?)
        .bind(l.duration_ms.map(|d| to_i64(d, "duration_ms")).transpose()?)
        .bind(i64::from(l.speakers))
        .bind(l.heard_by.map(HeardBy::as_str))
        .bind(l.confidence.map(i64::from))
        .bind(i64::from(l.passed))
        .bind(l.summary_audio_key.as_ref().map(ObjectKey::as_str))
        .bind(l.cover_key.as_ref().map(ObjectKey::as_str))
        .bind(&l.error)
        .bind(&l.created_at)
        .bind(&l.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn one(&self, id: &ListenId) -> Result<Option<Listen>, AppError> {
        let sql = concat!("SELECT ", listen_columns!(), " FROM listens WHERE id = ?");
        let row = sqlx::query(sql)
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(listen_from).transpose()
    }

    async fn of_user(&self, user: &UserId) -> Result<Vec<Listen>, AppError> {
        let sql = concat!(
            "SELECT ",
            listen_columns!(),
            " FROM listens WHERE user_id = ? ORDER BY created_at DESC, id DESC"
        );
        let rows = sqlx::query(sql)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(listen_from).collect()
    }

    async fn write_turns(
        &self,
        id: &ListenId,
        turns: &[ListenTurn],
        heard_by: HeardBy,
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query("DELETE FROM listen_turns WHERE listen_id = ?")
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        for t in turns {
            sqlx::query(
                "INSERT INTO listen_turns (listen_id, idx, start_ms, end_ms, speaker, text, lang, \
                 translation, score, issue, fixed_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id.as_str())
            .bind(i64::from(t.index))
            .bind(to_i64(t.start_ms, "start_ms")?)
            .bind(to_i64(t.end_ms, "end_ms")?)
            .bind(&t.speaker)
            .bind(&t.text)
            .bind(&t.lang)
            .bind(&t.translation)
            .bind(t.score.map(i64::from))
            .bind(&t.issue)
            .bind(i64::from(t.fixed_in))
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        }
        sqlx::query("UPDATE listens SET speakers = ?, heard_by = ? WHERE id = ?")
            .bind(i64::from(speaker_count(turns)))
            .bind(heard_by.as_str())
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)
    }

    async fn read_turns(&self, id: &ListenId) -> Result<Vec<ListenTurn>, AppError> {
        let rows = sqlx::query(
            "SELECT idx, start_ms, end_ms, speaker, text, lang, translation, score, issue, \
             fixed_in FROM listen_turns WHERE listen_id = ? ORDER BY idx",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter().map(turn_from).collect()
    }

    async fn write_result(&self, id: &ListenId, r: &ListenResult) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query(
            "UPDATE listens SET version = ?, title = ?, summary = ?, key_points = ?, \
             languages = ?, confidence = ?, passed = ? WHERE id = ?",
        )
        .bind(i64::from(r.version))
        .bind(&r.overview.title)
        .bind(&r.overview.summary)
        .bind(json(
            serde_json::to_string(&r.overview.key_points),
            "key_points",
        )?)
        .bind(json(serde_json::to_string(&r.languages), "languages")?)
        .bind(r.confidence.map(i64::from))
        .bind(i64::from(r.passed))
        .bind(id.as_str())
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        for t in &r.turns {
            sqlx::query(
                "UPDATE listen_turns SET lang = ?, translation = ?, score = ?, issue = ?, \
                 fixed_in = ? WHERE listen_id = ? AND idx = ?",
            )
            .bind(&t.lang)
            .bind(&t.translation)
            .bind(t.score.map(i64::from))
            .bind(&t.issue)
            .bind(i64::from(t.fixed_in))
            .bind(id.as_str())
            .bind(i64::from(t.index))
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }

    async fn upsert_version(&self, id: &ListenId, v: &ListenVersion) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO listen_versions (listen_id, version, draft, checked) VALUES (?, ?, ?, ?) \
             ON CONFLICT (listen_id, version) DO UPDATE SET draft = excluded.draft, \
             checked = excluded.checked",
        )
        .bind(id.as_str())
        .bind(i64::from(v.version))
        .bind(json(serde_json::to_string(&v.draft), "draft")?)
        .bind(
            v.check
                .as_ref()
                .map(|c| json(serde_json::to_string(c), "checked"))
                .transpose()?,
        )
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn read_versions(&self, id: &ListenId) -> Result<Vec<ListenVersion>, AppError> {
        let rows = sqlx::query(
            "SELECT version, draft, checked FROM listen_versions WHERE listen_id = ? \
             ORDER BY version",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        rows.iter().map(version_from).collect()
    }

    async fn forget_understanding(&self, id: &ListenId) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        let statements = [
            "DELETE FROM listen_versions WHERE listen_id = ?",
            "UPDATE listen_turns SET lang = '', translation = '', score = NULL, issue = '', \
             fixed_in = 1 WHERE listen_id = ?",
            "UPDATE listens SET version = 0, title = '', summary = '', key_points = '[]', \
             languages = '[]', confidence = NULL, passed = 0, summary_audio_key = NULL \
             WHERE id = ?",
        ];
        for sql in statements {
            sqlx::query(sql)
                .bind(id.as_str())
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }

    /// Runs one `UPDATE listens SET … WHERE id = ?` with `values` bound in order, then the id.
    async fn update(
        &self,
        sql: &'static str,
        values: Vec<Option<String>>,
        id: &ListenId,
    ) -> Result<(), AppError> {
        let mut q = sqlx::query(sql);
        for v in values {
            q = q.bind(v);
        }
        q.bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn read_voices(&self, id: &ListenId) -> Result<Vec<ObjectKey>, AppError> {
        let keys: Vec<String> =
            sqlx::query_scalar("SELECT key FROM listen_voices WHERE listen_id = ? ORDER BY key")
                .bind(id.as_str())
                .fetch_all(&self.pool)
                .await
                .map_err(db_err)?;
        Ok(keys.into_iter().map(ObjectKey::from_stored).collect())
    }

    async fn exec(&self, sql: &'static str, id: &ListenId, other: &str) -> Result<(), AppError> {
        sqlx::query(sql)
            .bind(id.as_str())
            .bind(other)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}

fn owned(s: Option<&str>) -> Option<String> {
    s.map(str::to_owned)
}

impl ListenStore for SqliteListenStore {
    fn create<'a>(&'a self, listen: &'a Listen) -> PortResult<'a, ()> {
        Box::pin(self.insert(listen))
    }

    fn get<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Option<Listen>> {
        Box::pin(self.one(id))
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Listen>> {
        Box::pin(self.of_user(user))
    }

    fn set_progress<'a>(&'a self, id: &'a ListenId, p: ListenProgress<'a>) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE listens SET status = ?, error = ?, updated_at = ? WHERE id = ?",
            vec![
                owned(Some(p.status.as_str())),
                owned(p.error),
                owned(Some(p.at)),
            ],
            id,
        ))
    }

    fn set_step<'a>(
        &'a self,
        id: &'a ListenId,
        step: Option<&'a str>,
        version: u32,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("UPDATE listens SET step = ?, version = ? WHERE id = ?")
                .bind(step)
                .bind(i64::from(version))
                .bind(id.as_str())
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        })
    }

    fn set_duration<'a>(&'a self, id: &'a ListenId, duration_ms: u64) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("UPDATE listens SET duration_ms = ? WHERE id = ?")
                .bind(to_i64(duration_ms, "duration_ms")?)
                .bind(id.as_str())
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        })
    }

    fn set_turns<'a>(
        &'a self,
        id: &'a ListenId,
        turns: &'a [ListenTurn],
        heard_by: HeardBy,
    ) -> PortResult<'a, ()> {
        Box::pin(self.write_turns(id, turns, heard_by))
    }

    fn turns<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ListenTurn>> {
        Box::pin(self.read_turns(id))
    }

    fn set_result<'a>(&'a self, id: &'a ListenId, r: &'a ListenResult) -> PortResult<'a, ()> {
        Box::pin(self.write_result(id, r))
    }

    fn put_version<'a>(&'a self, id: &'a ListenId, v: &'a ListenVersion) -> PortResult<'a, ()> {
        Box::pin(self.upsert_version(id, v))
    }

    fn versions<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ListenVersion>> {
        Box::pin(self.read_versions(id))
    }

    fn clear_understanding<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, ()> {
        Box::pin(self.forget_understanding(id))
    }

    fn set_target<'a>(
        &'a self,
        id: &'a ListenId,
        target: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE listens SET target = ?, updated_at = ? WHERE id = ?",
            vec![owned(Some(target)), owned(Some(at))],
            id,
        ))
    }

    fn set_title<'a>(
        &'a self,
        id: &'a ListenId,
        title: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE listens SET title = ?, updated_at = ? WHERE id = ?",
            vec![owned(Some(title)), owned(Some(at))],
            id,
        ))
    }

    fn set_summary_audio<'a>(
        &'a self,
        id: &'a ListenId,
        key: Option<&'a ObjectKey>,
    ) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE listens SET summary_audio_key = ? WHERE id = ?",
            vec![owned(key.map(ObjectKey::as_str))],
            id,
        ))
    }

    fn set_cover<'a>(&'a self, id: &'a ListenId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE listens SET cover_key = ? WHERE id = ?",
            vec![owned(Some(key.as_str()))],
            id,
        ))
    }

    fn add_voice<'a>(&'a self, id: &'a ListenId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        Box::pin(self.exec(
            "INSERT OR IGNORE INTO listen_voices (listen_id, key) VALUES (?, ?)",
            id,
            key.as_str(),
        ))
    }

    fn voices<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ObjectKey>> {
        Box::pin(self.read_voices(id))
    }

    fn delete<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("DELETE FROM listens WHERE id = ?")
                .bind(id.as_str())
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests;
