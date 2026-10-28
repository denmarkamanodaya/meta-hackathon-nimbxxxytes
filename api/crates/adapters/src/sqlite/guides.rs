//! [`GuideStore`] on SQLite: `guides` (one per clip) and `guide_steps` (one per step number).

use nimbytes_core::AppError;
use nimbytes_core::domain::guide::{Guide, GuideStage, GuideStatus, GuideStep, Safety};
use nimbytes_core::domain::ids::{ClipId, GuideId, UserId};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{GuideProgress, GuideStore, GuideVerdict, PortResult};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::db_err;

/// Guide rows in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteGuideStore {
    pool: SqlitePool,
}

macro_rules! guide_columns {
    () => {
        "id, user_id, clip_id, title, status, stage, safety, safety_reason, \
     language, error, created_at, updated_at"
    };
}

macro_rules! step_columns {
    () => {
        "n, title, instruction, start_s, end_s, key_s, control, highlight, \
     image_key, audio_key, audio_text, clip_key"
    };
}

fn opt<T>(
    raw: Option<String>,
    parse: impl Fn(&str) -> Result<T, AppError>,
) -> Result<Option<T>, AppError> {
    raw.as_deref().map(parse).transpose()
}

fn guide_from(row: &SqliteRow) -> Result<Guide, AppError> {
    let get = |c: &str| row.try_get::<String, _>(c).map_err(db_err);
    let maybe = |c: &str| row.try_get::<Option<String>, _>(c).map_err(db_err);
    Ok(Guide {
        id: GuideId::parse(get("id")?)?,
        user_id: UserId::parse(get("user_id")?)?,
        clip_id: ClipId::parse(get("clip_id")?)?,
        title: get("title")?,
        status: GuideStatus::parse(&get("status")?)?,
        stage: opt(maybe("stage")?, GuideStage::parse)?,
        safety: opt(maybe("safety")?, Safety::parse)?,
        safety_reason: maybe("safety_reason")?,
        language: get("language")?,
        error: maybe("error")?,
        created_at: get("created_at")?,
        updated_at: get("updated_at")?,
    })
}

fn step_from(row: &SqliteRow) -> Result<GuideStep, AppError> {
    let maybe = |c: &str| row.try_get::<Option<String>, _>(c).map_err(db_err);
    let key = |c: &str| Ok::<_, AppError>(maybe(c)?.map(ObjectKey::from_stored));
    let n: i64 = row.try_get("n").map_err(db_err)?;
    Ok(GuideStep {
        n: u32::try_from(n).unwrap_or(0),
        title: row.try_get("title").map_err(db_err)?,
        instruction: row.try_get("instruction").map_err(db_err)?,
        start_s: row.try_get("start_s").map_err(db_err)?,
        end_s: row.try_get("end_s").map_err(db_err)?,
        key_s: row.try_get("key_s").map_err(db_err)?,
        control: maybe("control")?,
        highlight: maybe("highlight")?,
        image_key: key("image_key")?,
        audio_key: key("audio_key")?,
        audio_text: maybe("audio_text")?,
        clip_key: key("clip_key")?,
    })
}

fn key_text(key: Option<&ObjectKey>) -> Option<&str> {
    key.map(ObjectKey::as_str)
}

impl SqliteGuideStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert(&self, g: &Guide) -> Result<bool, AppError> {
        let done = sqlx::query(
            "INSERT INTO guides (id, user_id, clip_id, title, status, stage, safety, \
             safety_reason, language, error, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (clip_id) DO NOTHING",
        )
        .bind(g.id.as_str())
        .bind(g.user_id.as_str())
        .bind(g.clip_id.as_str())
        .bind(&g.title)
        .bind(g.status.as_str())
        .bind(g.stage.map(GuideStage::as_str))
        .bind(g.safety.map(Safety::as_str))
        .bind(&g.safety_reason)
        .bind(&g.language)
        .bind(&g.error)
        .bind(&g.created_at)
        .bind(&g.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(done.rows_affected() == 1)
    }

    async fn one(&self, sql: &'static str, value: &str) -> Result<Option<Guide>, AppError> {
        let row = sqlx::query(sql)
            .bind(value)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(guide_from).transpose()
    }

    async fn of_user(&self, user: &UserId) -> Result<Vec<Guide>, AppError> {
        let sql = concat!(
            "SELECT ",
            guide_columns!(),
            " FROM guides WHERE user_id = ? ORDER BY created_at DESC, id DESC"
        );
        let rows = sqlx::query(sql)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(guide_from).collect()
    }

    async fn read_steps(&self, id: &GuideId) -> Result<Vec<GuideStep>, AppError> {
        let sql = concat!(
            "SELECT ",
            step_columns!(),
            " FROM guide_steps WHERE guide_id = ? ORDER BY n"
        );
        let rows = sqlx::query(sql)
            .bind(id.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(step_from).collect()
    }

    async fn progress(&self, id: &GuideId, p: GuideProgress<'_>) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE guides SET status = ?, stage = ?, error = ?, updated_at = ? WHERE id = ?",
        )
        .bind(p.status.as_str())
        .bind(p.stage.map(GuideStage::as_str))
        .bind(p.error)
        .bind(p.at)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }
}

/// Inserts or replaces one step row inside `tx`.
async fn upsert_step(
    tx: &mut sqlx::SqliteConnection,
    id: &GuideId,
    s: &GuideStep,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT OR REPLACE INTO guide_steps (guide_id, n, title, instruction, start_s, end_s, \
         key_s, control, highlight, image_key, audio_key, audio_text, clip_key) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id.as_str())
    .bind(i64::from(s.n))
    .bind(&s.title)
    .bind(&s.instruction)
    .bind(s.start_s)
    .bind(s.end_s)
    .bind(s.key_s)
    .bind(&s.control)
    .bind(&s.highlight)
    .bind(key_text(s.image_key.as_ref()))
    .bind(key_text(s.audio_key.as_ref()))
    .bind(&s.audio_text)
    .bind(key_text(s.clip_key.as_ref()))
    .execute(tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

impl SqliteGuideStore {
    async fn plan(
        &self,
        id: &GuideId,
        v: GuideVerdict<'_>,
        steps: &[GuideStep],
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query("UPDATE guides SET title = ?, safety = ?, safety_reason = ? WHERE id = ?")
            .bind(v.title)
            .bind(v.safety.as_str())
            .bind(v.reason)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        sqlx::query("DELETE FROM guide_steps WHERE guide_id = ?")
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        for s in steps {
            upsert_step(&mut tx, id, s).await?;
        }
        tx.commit().await.map_err(db_err)
    }

    async fn one_step(&self, id: &GuideId, s: &GuideStep) -> Result<(), AppError> {
        let mut conn = self.pool.acquire().await.map_err(db_err)?;
        upsert_step(&mut conn, id, s).await
    }

    async fn remove(&self, id: &GuideId) -> Result<(), AppError> {
        sqlx::query("DELETE FROM guides WHERE id = ?")
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}

impl GuideStore for SqliteGuideStore {
    fn create<'a>(&'a self, guide: &'a Guide) -> PortResult<'a, bool> {
        Box::pin(self.insert(guide))
    }

    fn get<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, Option<Guide>> {
        let sql = concat!("SELECT ", guide_columns!(), " FROM guides WHERE id = ?");
        Box::pin(self.one(sql, id.as_str()))
    }

    fn for_clip<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, Option<Guide>> {
        let sql = concat!(
            "SELECT ",
            guide_columns!(),
            " FROM guides WHERE clip_id = ?"
        );
        Box::pin(self.one(sql, clip.as_str()))
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Guide>> {
        Box::pin(self.of_user(user))
    }

    fn steps<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, Vec<GuideStep>> {
        Box::pin(self.read_steps(id))
    }

    fn set_progress<'a>(
        &'a self,
        id: &'a GuideId,
        progress: GuideProgress<'a>,
    ) -> PortResult<'a, ()> {
        Box::pin(self.progress(id, progress))
    }

    fn set_plan<'a>(
        &'a self,
        id: &'a GuideId,
        verdict: GuideVerdict<'a>,
        steps: &'a [GuideStep],
    ) -> PortResult<'a, ()> {
        Box::pin(self.plan(id, verdict, steps))
    }

    fn set_title<'a>(&'a self, id: &'a GuideId, title: &'a str, at: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("UPDATE guides SET title = ?, updated_at = ? WHERE id = ?")
                .bind(title)
                .bind(at)
                .bind(id.as_str())
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        })
    }

    fn put_step<'a>(&'a self, id: &'a GuideId, step: &'a GuideStep) -> PortResult<'a, ()> {
        Box::pin(self.one_step(id, step))
    }

    fn delete<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, ()> {
        Box::pin(self.remove(id))
    }
}

#[cfg(test)]
mod tests;
