//! [`DocumentStore`] on SQLite: `documents`, `document_pages` (one per page number) and
//! `document_voices` (every voice file made, for deleting).

use nimbytes_core::AppError;
use nimbytes_core::domain::document::{
    DocFormat, DocKind, DocStatus, Document, DocumentPage, Reading,
};
use nimbytes_core::domain::ids::{DocumentId, UserId};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{DocProgress, DocumentStore, PortResult};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::{db_err, to_i64, to_u64};

/// Document rows in the shared pool.
#[derive(Debug, Clone)]
pub struct SqliteDocumentStore {
    pool: SqlitePool,
}

macro_rules! doc_columns {
    () => {
        "id, user_id, filename, content_type, size_bytes, status, title, kind, sender, date, \
         text, summary, page_count, summary_audio_key, error, created_at, updated_at"
    };
}

fn doc_from(row: &SqliteRow) -> Result<Document, AppError> {
    let get = |c: &str| row.try_get::<String, _>(c).map_err(db_err);
    let maybe = |c: &str| row.try_get::<Option<String>, _>(c).map_err(db_err);
    let int = |c: &str| row.try_get::<i64, _>(c).map_err(db_err);
    Ok(Document {
        id: DocumentId::parse(get("id")?)?,
        user_id: UserId::parse(get("user_id")?)?,
        filename: get("filename")?,
        format: DocFormat::parse(&get("content_type")?)?,
        size_bytes: to_u64(int("size_bytes")?, "size_bytes")?,
        status: DocStatus::parse(&get("status")?)?,
        title: get("title")?,
        kind: DocKind::parse(&get("kind")?)?,
        sender: get("sender")?,
        date: get("date")?,
        text: get("text")?,
        summary: get("summary")?,
        page_count: u32::try_from(int("page_count")?).unwrap_or(0),
        summary_audio_key: maybe("summary_audio_key")?.map(ObjectKey::from_stored),
        error: maybe("error")?,
        created_at: get("created_at")?,
        updated_at: get("updated_at")?,
    })
}

impl SqliteDocumentStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert(&self, d: &Document) -> Result<(), AppError> {
        sqlx::query(concat!(
            "INSERT INTO documents (",
            doc_columns!(),
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(d.id.as_str())
        .bind(d.user_id.as_str())
        .bind(&d.filename)
        .bind(d.format.as_str())
        .bind(to_i64(d.size_bytes, "size_bytes")?)
        .bind(d.status.as_str())
        .bind(&d.title)
        .bind(d.kind.as_str())
        .bind(&d.sender)
        .bind(&d.date)
        .bind(&d.text)
        .bind(&d.summary)
        .bind(i64::from(d.page_count))
        .bind(d.summary_audio_key.as_ref().map(ObjectKey::as_str))
        .bind(&d.error)
        .bind(&d.created_at)
        .bind(&d.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn one(&self, id: &DocumentId) -> Result<Option<Document>, AppError> {
        let sql = concat!("SELECT ", doc_columns!(), " FROM documents WHERE id = ?");
        let row = sqlx::query(sql)
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(doc_from).transpose()
    }

    async fn of_user(&self, user: &UserId) -> Result<Vec<Document>, AppError> {
        let sql = concat!(
            "SELECT ",
            doc_columns!(),
            " FROM documents WHERE user_id = ? ORDER BY created_at DESC, id DESC"
        );
        let rows = sqlx::query(sql)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(doc_from).collect()
    }

    /// Runs one `UPDATE documents SET … WHERE id = ?` with `values` bound in order, then the id.
    async fn update(
        &self,
        sql: &'static str,
        values: Vec<Option<&str>>,
        id: &DocumentId,
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

    async fn replace_pages(&self, id: &DocumentId, pages: &[DocumentPage]) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        sqlx::query("DELETE FROM document_pages WHERE document_id = ?")
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        for p in pages {
            sqlx::query("INSERT INTO document_pages (document_id, n, image_key) VALUES (?, ?, ?)")
                .bind(id.as_str())
                .bind(i64::from(p.n))
                .bind(p.image_key.as_str())
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        let count = i64::try_from(pages.len()).unwrap_or(i64::MAX);
        sqlx::query("UPDATE documents SET page_count = ? WHERE id = ?")
            .bind(count)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)
    }

    async fn read_pages(&self, id: &DocumentId) -> Result<Vec<DocumentPage>, AppError> {
        let rows =
            sqlx::query("SELECT n, image_key FROM document_pages WHERE document_id = ? ORDER BY n")
                .bind(id.as_str())
                .fetch_all(&self.pool)
                .await
                .map_err(db_err)?;
        rows.iter()
            .map(|r| {
                let n: i64 = r.try_get("n").map_err(db_err)?;
                Ok(DocumentPage {
                    n: u32::try_from(n).unwrap_or(0),
                    image_key: ObjectKey::from_stored(r.try_get("image_key").map_err(db_err)?),
                })
            })
            .collect()
    }

    async fn read_voices(&self, id: &DocumentId) -> Result<Vec<ObjectKey>, AppError> {
        let keys: Vec<String> = sqlx::query_scalar(
            "SELECT key FROM document_voices WHERE document_id = ? ORDER BY key",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(keys.into_iter().map(ObjectKey::from_stored).collect())
    }

    async fn exec(&self, sql: &'static str, a: &str, b: Option<&str>) -> Result<(), AppError> {
        sqlx::query(sql)
            .bind(a)
            .bind(b)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}

impl DocumentStore for SqliteDocumentStore {
    fn create<'a>(&'a self, doc: &'a Document) -> PortResult<'a, ()> {
        Box::pin(self.insert(doc))
    }

    fn get<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Option<Document>> {
        Box::pin(self.one(id))
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Document>> {
        Box::pin(self.of_user(user))
    }

    fn set_progress<'a>(&'a self, id: &'a DocumentId, p: DocProgress<'a>) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE documents SET status = ?, error = ?, updated_at = ? WHERE id = ?",
            vec![Some(p.status.as_str()), p.error, Some(p.at)],
            id,
        ))
    }

    fn set_pages<'a>(
        &'a self,
        id: &'a DocumentId,
        pages: &'a [DocumentPage],
    ) -> PortResult<'a, ()> {
        Box::pin(self.replace_pages(id, pages))
    }

    fn pages<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Vec<DocumentPage>> {
        Box::pin(self.read_pages(id))
    }

    fn set_reading<'a>(&'a self, id: &'a DocumentId, r: &'a Reading) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE documents SET title = ?, kind = ?, sender = ?, date = ?, text = ?, \
             summary = ? WHERE id = ?",
            vec![
                Some(r.title.as_str()),
                Some(r.kind.as_str()),
                Some(r.sender.as_str()),
                Some(r.date.as_str()),
                Some(r.text.as_str()),
                Some(r.summary.as_str()),
            ],
            id,
        ))
    }

    fn set_summary_audio<'a>(
        &'a self,
        id: &'a DocumentId,
        key: &'a ObjectKey,
    ) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE documents SET summary_audio_key = ? WHERE id = ?",
            vec![Some(key.as_str())],
            id,
        ))
    }

    fn set_title<'a>(
        &'a self,
        id: &'a DocumentId,
        title: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(self.update(
            "UPDATE documents SET title = ?, updated_at = ? WHERE id = ?",
            vec![Some(title), Some(at)],
            id,
        ))
    }

    fn add_voice<'a>(&'a self, id: &'a DocumentId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        Box::pin(self.exec(
            "INSERT OR IGNORE INTO document_voices (document_id, key) VALUES (?, ?)",
            id.as_str(),
            Some(key.as_str()),
        ))
    }

    fn voices<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Vec<ObjectKey>> {
        Box::pin(self.read_voices(id))
    }

    fn delete<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("DELETE FROM documents WHERE id = ?")
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
