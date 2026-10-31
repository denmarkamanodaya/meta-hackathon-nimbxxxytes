//! [`MemoryStore`] on SQLite: one `memories` row per session, its moments as one JSON array.

use nimbytes_core::domain::ids::{ClipId, MemoryId, PersonId, UserId};
use nimbytes_core::domain::memory::{Memory, MemoryStatus, SubjectKind};
use nimbytes_core::ports::{MemoryStore, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::{db_err, to_i64, to_u64};

/// Session rows in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteMemoryStore {
    pool: SqlitePool,
}

macro_rules! memory_columns {
    () => {
        "id, user_id, subject_kind, person_id, clip_id, subject_name, viewer_id, viewer_name, \
         title, status, step, moments, fixed_count, cover_key, error, created_at, updated_at"
    };
}

fn bad_json(e: serde_json::Error) -> AppError {
    AppError::new(ErrorCode::Internal, format!("bad moments: {e}"))
}

fn memory_from(row: &SqliteRow) -> Result<Memory, AppError> {
    let get = |c: &str| row.try_get::<String, _>(c).map_err(db_err);
    let maybe = |c: &str| row.try_get::<Option<String>, _>(c).map_err(db_err);
    let fixed: i64 = row.try_get("fixed_count").map_err(db_err)?;
    Ok(Memory {
        id: MemoryId::parse(get("id")?)?,
        user_id: UserId::parse(get("user_id")?)?,
        subject_kind: SubjectKind::parse(&get("subject_kind")?)?,
        person_id: maybe("person_id")?.map(PersonId::parse).transpose()?,
        clip_id: maybe("clip_id")?.map(ClipId::parse).transpose()?,
        subject_name: get("subject_name")?,
        viewer_id: maybe("viewer_id")?.map(PersonId::parse).transpose()?,
        viewer_name: maybe("viewer_name")?,
        title: get("title")?,
        status: MemoryStatus::parse(&get("status")?)?,
        step: maybe("step")?,
        moments: serde_json::from_str(&get("moments")?).map_err(bad_json)?,
        fixed_count: u32::try_from(to_u64(fixed, "fixed_count")?).unwrap_or(u32::MAX),
        cover_key: maybe("cover_key")?,
        error: maybe("error")?,
        created_at: get("created_at")?,
        updated_at: get("updated_at")?,
    })
}

impl SqliteMemoryStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert(&self, m: &Memory) -> Result<(), AppError> {
        let moments = serde_json::to_string(&m.moments).map_err(bad_json)?;
        sqlx::query(concat!(
            "INSERT INTO memories (",
            memory_columns!(),
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(m.id.as_str())
        .bind(m.user_id.as_str())
        .bind(m.subject_kind.as_str())
        .bind(m.person_id.as_ref().map(PersonId::as_str))
        .bind(m.clip_id.as_ref().map(ClipId::as_str))
        .bind(&m.subject_name)
        .bind(m.viewer_id.as_ref().map(PersonId::as_str))
        .bind(&m.viewer_name)
        .bind(&m.title)
        .bind(m.status.as_str())
        .bind(&m.step)
        .bind(moments)
        .bind(to_i64(u64::from(m.fixed_count), "fixed_count")?)
        .bind(&m.cover_key)
        .bind(&m.error)
        .bind(&m.created_at)
        .bind(&m.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn update(&self, m: &Memory) -> Result<(), AppError> {
        let moments = serde_json::to_string(&m.moments).map_err(bad_json)?;
        sqlx::query(
            "UPDATE memories SET title = ?, status = ?, step = ?, moments = ?, fixed_count = ?, \
             cover_key = ?, error = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&m.title)
        .bind(m.status.as_str())
        .bind(&m.step)
        .bind(moments)
        .bind(to_i64(u64::from(m.fixed_count), "fixed_count")?)
        .bind(&m.cover_key)
        .bind(&m.error)
        .bind(&m.updated_at)
        .bind(m.id.as_str())
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn one(&self, id: &MemoryId) -> Result<Option<Memory>, AppError> {
        sqlx::query(concat!(
            "SELECT ",
            memory_columns!(),
            " FROM memories WHERE id = ?"
        ))
        .bind(id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?
        .as_ref()
        .map(memory_from)
        .transpose()
    }

    async fn of_user(&self, user: &UserId) -> Result<Vec<Memory>, AppError> {
        sqlx::query(concat!(
            "SELECT ",
            memory_columns!(),
            " FROM memories WHERE user_id = ? ORDER BY created_at DESC, id DESC"
        ))
        .bind(user.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?
        .iter()
        .map(memory_from)
        .collect()
    }

    async fn remove(&self, id: &MemoryId) -> Result<(), AppError> {
        sqlx::query("DELETE FROM memories WHERE id = ?")
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}

impl MemoryStore for SqliteMemoryStore {
    fn create<'a>(&'a self, memory: &'a Memory) -> PortResult<'a, ()> {
        Box::pin(self.insert(memory))
    }

    fn get<'a>(&'a self, id: &'a MemoryId) -> PortResult<'a, Option<Memory>> {
        Box::pin(self.one(id))
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Memory>> {
        Box::pin(self.of_user(user))
    }

    fn save<'a>(&'a self, memory: &'a Memory) -> PortResult<'a, ()> {
        Box::pin(self.update(memory))
    }

    fn delete<'a>(&'a self, id: &'a MemoryId) -> PortResult<'a, ()> {
        Box::pin(self.remove(id))
    }
}

#[cfg(test)]
mod tests;
