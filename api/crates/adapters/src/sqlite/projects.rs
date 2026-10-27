//! [`ProjectStore`] on SQLite: `projects` and `project_clips`.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ClipId, ProjectId, UserId};
use nimbytes_core::domain::project::{Project, ProjectColor, ProjectSummary};
use nimbytes_core::ports::{PortResult, ProjectStore};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::{db_err, to_u64};

/// Projects on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteProjectStore {
    pool: SqlitePool,
}

/// A project row with its totals over the clips in it.
const SUMMARY: &str = "SELECT p.*, \
    (SELECT COUNT(*) FROM project_clips pc WHERE pc.project_id = p.id) AS clip_count, \
    (SELECT COALESCE(SUM(c.duration_s), 0.0) FROM project_clips pc \
       JOIN clips c ON c.id = pc.clip_id WHERE pc.project_id = p.id) AS duration_s, \
    (SELECT COALESCE(SUM(c.size_bytes), 0) FROM project_clips pc \
       JOIN clips c ON c.id = pc.clip_id WHERE pc.project_id = p.id) AS size_bytes \
    FROM projects p";

fn project_from_row(r: &SqliteRow) -> Result<Project, AppError> {
    let color: String = r.try_get("color").map_err(db_err)?;
    Ok(Project {
        id: ProjectId::parse(r.try_get::<String, _>("id").map_err(db_err)?)?,
        user_id: UserId::parse(r.try_get::<String, _>("user_id").map_err(db_err)?)?,
        name: r.try_get("name").map_err(db_err)?,
        color: ProjectColor::parse(&color)?,
        created_at: r.try_get("created_at").map_err(db_err)?,
        updated_at: r.try_get("updated_at").map_err(db_err)?,
    })
}

fn summary_from_row(r: &SqliteRow) -> Result<ProjectSummary, AppError> {
    let clips: i64 = r.try_get("clip_count").map_err(db_err)?;
    Ok(ProjectSummary {
        project: project_from_row(r)?,
        clip_count: u32::try_from(clips).unwrap_or(0),
        duration_s: r.try_get("duration_s").map_err(db_err)?,
        size_bytes: to_u64(r.try_get("size_bytes").map_err(db_err)?, "size_bytes")?,
    })
}

impl SqliteProjectStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert(&self, p: &Project, clips: &[ClipId]) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query(
            "INSERT INTO projects (id, user_id, name, color, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(p.id.as_str())
        .bind(p.user_id.as_str())
        .bind(&p.name)
        .bind(p.color.as_str())
        .bind(&p.created_at)
        .bind(&p.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        for clip in clips {
            link(&mut tx, &p.id, clip, &p.created_at).await?;
        }
        tx.commit().await.map_err(db_err)
    }

    async fn one(&self, id: &ProjectId) -> Result<Option<Project>, AppError> {
        let row = sqlx::query("SELECT * FROM projects WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(project_from_row).transpose()
    }

    async fn of_user(&self, user: &UserId) -> Result<Vec<ProjectSummary>, AppError> {
        let sql = format!("{SUMMARY} WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC");
        let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(summary_from_row).collect()
    }

    async fn summary_of(&self, id: &ProjectId) -> Result<Option<ProjectSummary>, AppError> {
        let sql = format!("{SUMMARY} WHERE p.id = ?");
        let row = sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(summary_from_row).transpose()
    }

    async fn set(
        &self,
        id: &ProjectId,
        (name, color): (&str, ProjectColor),
        at: &str,
    ) -> Result<(), AppError> {
        sqlx::query("UPDATE projects SET name = ?, color = ?, updated_at = ? WHERE id = ?")
            .bind(name)
            .bind(color.as_str())
            .bind(at)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn remove(&self, id: &ProjectId) -> Result<(), AppError> {
        // The clip links cascade.
        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn unlink(&self, id: &ProjectId, clip: &ClipId) -> Result<(), AppError> {
        sqlx::query("DELETE FROM project_clips WHERE project_id = ? AND clip_id = ?")
            .bind(id.as_str())
            .bind(clip.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn add(&self, id: &ProjectId, clips: &[ClipId], at: &str) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        for clip in clips {
            link(&mut tx, id, clip, at).await?;
        }
        tx.commit().await.map_err(db_err)
    }
}

/// Puts `clip` in project `id`, keeping the first `added_at` when it is already there.
async fn link(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &ProjectId,
    clip: &ClipId,
    at: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT OR IGNORE INTO project_clips (project_id, clip_id, added_at) VALUES (?, ?, ?)",
    )
    .bind(id.as_str())
    .bind(clip.as_str())
    .bind(at)
    .execute(&mut **tx)
    .await
    .map_err(db_err)?;
    Ok(())
}

impl ProjectStore for SqliteProjectStore {
    fn create<'a>(&'a self, project: &'a Project, clips: &'a [ClipId]) -> PortResult<'a, ()> {
        Box::pin(self.insert(project, clips))
    }

    fn get<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, Option<Project>> {
        Box::pin(self.one(id))
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<ProjectSummary>> {
        Box::pin(self.of_user(user))
    }

    fn summary<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, Option<ProjectSummary>> {
        Box::pin(self.summary_of(id))
    }

    fn update<'a>(
        &'a self,
        id: &'a ProjectId,
        fields: (&'a str, ProjectColor),
        updated_at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(self.set(id, fields, updated_at))
    }

    fn delete<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, ()> {
        Box::pin(self.remove(id))
    }

    fn add_clips<'a>(
        &'a self,
        id: &'a ProjectId,
        clips: &'a [ClipId],
        at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(self.add(id, clips, at))
    }

    fn remove_clip<'a>(&'a self, id: &'a ProjectId, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(self.unlink(id, clip))
    }
}

#[cfg(test)]
mod tests;
