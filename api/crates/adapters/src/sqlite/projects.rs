//! [`ProjectStore`] on SQLite: `projects`, `project_clips` and the item links
//! (`project_listens`, `project_documents`, `project_photos`).

use nimbytes_core::domain::ids::{ClipId, ProjectId, UserId};
use nimbytes_core::domain::item::{ItemKind, ItemRef};
use nimbytes_core::domain::project::{
    ArtSource, Project, ProjectArt, ProjectColor, ProjectSummary,
};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{PortResult, ProjectStore};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::{db_err, to_u64};

/// Projects on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteProjectStore {
    pool: SqlitePool,
}

/// A project row with its totals over the clips, recordings, documents and photos in it. A clip
/// listen stores no file, so its `size_bytes` is 0.
const SUMMARY: &str = "SELECT p.*, \
    (SELECT COUNT(*) FROM project_clips pc WHERE pc.project_id = p.id) AS clip_count, \
    (SELECT COUNT(*) FROM project_listens pl WHERE pl.project_id = p.id) AS listen_count, \
    (SELECT COUNT(*) FROM project_documents pd WHERE pd.project_id = p.id) AS document_count, \
    (SELECT COUNT(*) FROM project_photos pp WHERE pp.project_id = p.id) AS photo_count, \
    (SELECT COALESCE(SUM(c.duration_s), 0.0) FROM project_clips pc \
       JOIN clips c ON c.id = pc.clip_id WHERE pc.project_id = p.id) \
    + (SELECT COALESCE(SUM(l.duration_ms), 0) / 1000.0 FROM project_listens pl \
       JOIN listens l ON l.id = pl.listen_id WHERE pl.project_id = p.id) AS duration_s, \
    (SELECT COALESCE(SUM(c.size_bytes), 0) FROM project_clips pc \
       JOIN clips c ON c.id = pc.clip_id WHERE pc.project_id = p.id) \
    + (SELECT COALESCE(SUM(l.size_bytes), 0) FROM project_listens pl \
       JOIN listens l ON l.id = pl.listen_id WHERE pl.project_id = p.id) \
    + (SELECT COALESCE(SUM(d.size_bytes), 0) FROM project_documents pd \
       JOIN documents d ON d.id = pd.document_id WHERE pd.project_id = p.id) \
    + (SELECT COALESCE(SUM(f.size_bytes), 0) FROM project_photos pp \
       JOIN photos f ON f.id = pp.photo_id WHERE pp.project_id = p.id) AS size_bytes \
    FROM projects p";

/// The link table and its item column for each kind.
fn link_table(kind: ItemKind) -> (&'static str, &'static str) {
    match kind {
        ItemKind::Listen => ("project_listens", "listen_id"),
        ItemKind::Document => ("project_documents", "document_id"),
        ItemKind::Photo => ("project_photos", "photo_id"),
    }
}

/// Every item link of one user's projects, with the kind as text.
const ITEM_LINKS: &str = "SELECT 'listen' AS kind, pl.listen_id AS item_id, p.id AS project_id \
    FROM project_listens pl JOIN projects p ON p.id = pl.project_id WHERE p.user_id = ?1 \
    UNION ALL SELECT 'document', pd.document_id, p.id \
    FROM project_documents pd JOIN projects p ON p.id = pd.project_id WHERE p.user_id = ?1 \
    UNION ALL SELECT 'photo', pp.photo_id, p.id \
    FROM project_photos pp JOIN projects p ON p.id = pp.project_id WHERE p.user_id = ?1";

fn count_of(r: &SqliteRow, column: &str) -> Result<u32, AppError> {
    let n: i64 = r.try_get(column).map_err(db_err)?;
    Ok(u32::try_from(n).unwrap_or(0))
}

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

fn bad_json(e: serde_json::Error) -> AppError {
    AppError::new(ErrorCode::Internal, format!("stored art sources: {e}"))
}

fn summary_from_row(r: &SqliteRow) -> Result<ProjectSummary, AppError> {
    let sources: String = r.try_get("art_sources").map_err(db_err)?;
    let key: Option<String> = r.try_get("art_key").map_err(db_err)?;
    Ok(ProjectSummary {
        project: project_from_row(r)?,
        clip_count: count_of(r, "clip_count")?,
        listen_count: count_of(r, "listen_count")?,
        document_count: count_of(r, "document_count")?,
        photo_count: count_of(r, "photo_count")?,
        duration_s: r.try_get("duration_s").map_err(db_err)?,
        size_bytes: to_u64(r.try_get("size_bytes").map_err(db_err)?, "size_bytes")?,
        art: ProjectArt {
            key: key.map(ObjectKey::from_stored),
            sources: serde_json::from_str(&sources).map_err(bad_json)?,
        },
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

    async fn record_art(
        &self,
        id: &ProjectId,
        key: &ObjectKey,
        sources: &[ArtSource],
    ) -> Result<(), AppError> {
        sqlx::query("UPDATE projects SET art_key = ?, art_sources = ? WHERE id = ?")
            .bind(key.as_str())
            .bind(serde_json::to_string(sources).map_err(bad_json)?)
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn claim_art(&self, id: &ProjectId) -> Result<bool, AppError> {
        let done = sqlx::query("UPDATE projects SET art_auto = 1 WHERE id = ? AND art_auto = 0")
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(done.rows_affected() == 1)
    }

    async fn add_links(&self, id: &ProjectId, items: &[ItemRef], at: &str) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        for item in items {
            let (table, column) = link_table(item.kind());
            let sql = format!(
                "INSERT OR IGNORE INTO {table} (project_id, {column}, added_at) VALUES (?, ?, ?)"
            );
            sqlx::query(sqlx::AssertSqlSafe(sql))
                .bind(id.as_str())
                .bind(item.id_str())
                .bind(at)
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)
    }

    async fn unlink_item(&self, id: &ProjectId, item: &ItemRef) -> Result<(), AppError> {
        let (table, column) = link_table(item.kind());
        let sql = format!("DELETE FROM {table} WHERE project_id = ? AND {column} = ?");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(id.as_str())
            .bind(item.id_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    async fn links_of(&self, user: &UserId) -> Result<Vec<(ItemRef, ProjectId)>, AppError> {
        let rows = sqlx::query(ITEM_LINKS)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                let kind: String = r.try_get("kind").map_err(db_err)?;
                let item: String = r.try_get("item_id").map_err(db_err)?;
                let project: String = r.try_get("project_id").map_err(db_err)?;
                Ok((ItemRef::parse(&kind, item)?, ProjectId::parse(project)?))
            })
            .collect()
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

    fn add_items<'a>(
        &'a self,
        id: &'a ProjectId,
        items: &'a [ItemRef],
        at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(self.add_links(id, items, at))
    }

    fn remove_item<'a>(&'a self, id: &'a ProjectId, item: &'a ItemRef) -> PortResult<'a, ()> {
        Box::pin(self.unlink_item(id, item))
    }

    fn item_links<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<(ItemRef, ProjectId)>> {
        Box::pin(self.links_of(user))
    }

    fn set_art<'a>(
        &'a self,
        id: &'a ProjectId,
        key: &'a ObjectKey,
        sources: &'a [ArtSource],
    ) -> PortResult<'a, ()> {
        Box::pin(self.record_art(id, key, sources))
    }

    fn claim_auto_art<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, bool> {
        Box::pin(self.claim_art(id))
    }
}

#[cfg(test)]
mod tests;
