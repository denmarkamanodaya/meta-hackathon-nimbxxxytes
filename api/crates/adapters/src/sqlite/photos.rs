//! [`PhotoStore`] on SQLite: `photos` (things as JSON). A title the owner typed is marked, so
//! Spark's facts never replace it.

use nimbytes_core::domain::ids::{PhotoId, UserId};
use nimbytes_core::domain::photo::{Photo, PhotoFacts, PhotoFit, PhotoFormat, PhotoStatus};
use nimbytes_core::ports::{PhotoProgress, PhotoStore, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::sqlite::SqliteRow;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

use super::{db_err, to_i64, to_u64};

/// Photo rows in the shared pool.
#[derive(Debug, Clone)]
pub struct SqlitePhotoStore {
    pool: SqlitePool,
}

macro_rules! photo_columns {
    () => {
        "id, user_id, filename, content_type, size_bytes, last_modified, status, title, \
         description, things, place, mood, width, height, taken_at, camera, error, created_at, \
         updated_at"
    };
}

fn dim(raw: Option<i64>) -> Option<u32> {
    raw.and_then(|n| u32::try_from(n).ok())
}

fn photo_from(row: &SqliteRow) -> Result<Photo, AppError> {
    let get = |c: &str| row.try_get::<String, _>(c).map_err(db_err);
    let maybe = |c: &str| row.try_get::<Option<String>, _>(c).map_err(db_err);
    let int = |c: &str| row.try_get::<Option<i64>, _>(c).map_err(db_err);
    let things: Vec<String> = serde_json::from_str(&get("things")?)
        .map_err(|e| AppError::new(ErrorCode::Internal, format!("bad things: {e}")))?;
    Ok(Photo {
        id: PhotoId::parse(get("id")?)?,
        user_id: UserId::parse(get("user_id")?)?,
        filename: get("filename")?,
        format: PhotoFormat::parse(&get("content_type")?)?,
        size_bytes: to_u64(int("size_bytes")?.unwrap_or(0), "size_bytes")?,
        last_modified: maybe("last_modified")?,
        status: PhotoStatus::parse(&get("status")?)?,
        title: get("title")?,
        facts: PhotoFacts {
            title: get("title")?,
            description: get("description")?,
            things,
            place: get("place")?,
            mood: get("mood")?,
        },
        width: dim(int("width")?),
        height: dim(int("height")?),
        taken_at: maybe("taken_at")?,
        camera: maybe("camera")?,
        error: maybe("error")?,
        created_at: get("created_at")?,
        updated_at: get("updated_at")?,
    })
}

impl SqlitePhotoStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert(&self, p: &Photo) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO photos (id, user_id, filename, content_type, size_bytes, last_modified, \
             status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(p.id.as_str())
        .bind(p.user_id.as_str())
        .bind(&p.filename)
        .bind(p.format.as_str())
        .bind(to_i64(p.size_bytes, "size_bytes")?)
        .bind(&p.last_modified)
        .bind(p.status.as_str())
        .bind(&p.created_at)
        .bind(&p.updated_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn one(&self, id: &PhotoId) -> Result<Option<Photo>, AppError> {
        let sql = concat!("SELECT ", photo_columns!(), " FROM photos WHERE id = ?");
        let row = sqlx::query(sql)
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        row.as_ref().map(photo_from).transpose()
    }

    async fn of_user(&self, user: &UserId) -> Result<Vec<Photo>, AppError> {
        let sql = concat!(
            "SELECT ",
            photo_columns!(),
            " FROM photos WHERE user_id = ? \
             ORDER BY COALESCE(taken_at, created_at) DESC, id DESC"
        );
        let rows = sqlx::query(sql)
            .bind(user.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        rows.iter().map(photo_from).collect()
    }

    async fn some(&self, user: &UserId, ids: &[PhotoId]) -> Result<Vec<Photo>, AppError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut q: QueryBuilder<Sqlite> = QueryBuilder::new(concat!(
            "SELECT ",
            photo_columns!(),
            " FROM photos WHERE user_id = "
        ));
        q.push_bind(user.as_str()).push(" AND id IN (");
        let mut list = q.separated(", ");
        for id in ids {
            list.push_bind(id.as_str());
        }
        list.push_unseparated(")");
        let rows = q.build().fetch_all(&self.pool).await.map_err(db_err)?;
        rows.iter().map(photo_from).collect()
    }

    async fn fitted(&self, id: &PhotoId, f: &PhotoFit) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE photos SET width = ?, height = ?, taken_at = ?, camera = ? WHERE id = ?",
        )
        .bind(i64::from(f.width))
        .bind(i64::from(f.height))
        .bind(&f.taken_at)
        .bind(&f.camera)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn described(&self, id: &PhotoId, f: &PhotoFacts) -> Result<(), AppError> {
        let things = serde_json::to_string(&f.things)
            .map_err(|e| AppError::new(ErrorCode::Internal, format!("things: {e}")))?;
        sqlx::query(
            "UPDATE photos SET title = CASE WHEN title_by_owner = 1 THEN title ELSE ? END, \
             description = ?, things = ?, place = ?, mood = ? WHERE id = ?",
        )
        .bind(&f.title)
        .bind(&f.description)
        .bind(things)
        .bind(&f.place)
        .bind(&f.mood)
        .bind(id.as_str())
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn exec(
        &self,
        sql: &'static str,
        values: [&str; 2],
        id: &PhotoId,
    ) -> Result<(), AppError> {
        sqlx::query(sql)
            .bind(values[0])
            .bind(values[1])
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}

impl PhotoStore for SqlitePhotoStore {
    fn create<'a>(&'a self, photo: &'a Photo) -> PortResult<'a, ()> {
        Box::pin(self.insert(photo))
    }

    fn get<'a>(&'a self, id: &'a PhotoId) -> PortResult<'a, Option<Photo>> {
        Box::pin(self.one(id))
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Photo>> {
        Box::pin(self.of_user(user))
    }

    fn many<'a>(&'a self, user: &'a UserId, ids: &'a [PhotoId]) -> PortResult<'a, Vec<Photo>> {
        Box::pin(self.some(user, ids))
    }

    fn set_progress<'a>(&'a self, id: &'a PhotoId, p: PhotoProgress<'a>) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("UPDATE photos SET status = ?, error = ?, updated_at = ? WHERE id = ?")
                .bind(p.status.as_str())
                .bind(p.error)
                .bind(p.at)
                .bind(id.as_str())
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        })
    }

    fn set_fit<'a>(&'a self, id: &'a PhotoId, fit: &'a PhotoFit) -> PortResult<'a, ()> {
        Box::pin(self.fitted(id, fit))
    }

    fn set_facts<'a>(&'a self, id: &'a PhotoId, facts: &'a PhotoFacts) -> PortResult<'a, ()> {
        Box::pin(self.described(id, facts))
    }

    fn set_title<'a>(&'a self, id: &'a PhotoId, title: &'a str, at: &'a str) -> PortResult<'a, ()> {
        Box::pin(self.exec(
            "UPDATE photos SET title = ?, title_by_owner = 1, updated_at = ? WHERE id = ?",
            [title, at],
            id,
        ))
    }

    fn delete<'a>(&'a self, id: &'a PhotoId) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("DELETE FROM photos WHERE id = ?")
                .bind(id.as_str())
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
    use crate::sqlite::catalogue::views_tests::fixture;
    use nimbytes_core::domain::photo::NewPhoto;

    fn photo(id: &str, user: &UserId, at: &str) -> Photo {
        let req = NewPhoto {
            filename: "_MG_4210.jpg".into(),
            content_type: "image/jpeg".into(),
            size_bytes: 79_810,
            last_modified: Some("2026-08-19T10:00:00.000Z".into()),
        };
        let id = PhotoId::parse(id).unwrap();
        Photo::uploading((id, user.clone()), req, PhotoFormat::Jpeg, at)
    }

    fn facts(title: &str) -> PhotoFacts {
        PhotoFacts {
            title: title.into(),
            description: "A decorated stage.".into(),
            things: vec!["stage".into(), "balloons".into()],
            place: "event hall".into(),
            mood: "festive".into(),
        }
    }

    #[tokio::test]
    async fn a_photo_reads_back_whole_with_its_fit_and_facts() {
        let (_cat, pool, user, _) = fixture().await;
        let store = SqlitePhotoStore::new(pool);
        let p = photo("p1", &user, "2026-10-30T01:00:00.000Z");
        store.create(&p).await.unwrap();
        assert_eq!(store.get(&p.id).await.unwrap(), Some(p.clone()));
        let fit = PhotoFit {
            width: 320,
            height: 480,
            taken_at: "2026-08-08T06:09:37.000Z".into(),
            camera: Some("Canon EOS 200D".into()),
        };
        store.set_fit(&p.id, &fit).await.unwrap();
        store
            .set_facts(&p.id, &facts("Birthday stage"))
            .await
            .unwrap();
        let got = store.get(&p.id).await.unwrap().unwrap();
        assert_eq!((got.width, got.height), (Some(320), Some(480)));
        assert_eq!(got.taken_at.as_deref(), Some("2026-08-08T06:09:37.000Z"));
        assert_eq!(got.camera.as_deref(), Some("Canon EOS 200D"));
        assert_eq!(got.title, "Birthday stage");
        assert_eq!(got.facts.things, ["stage", "balloons"]);
    }

    #[tokio::test]
    async fn the_owners_title_survives_a_new_description() {
        let (_cat, pool, user, _) = fixture().await;
        let store = SqlitePhotoStore::new(pool);
        let p = photo("p1", &user, "t");
        store.create(&p).await.unwrap();
        store.set_title(&p.id, "Mum's 60th", "t2").await.unwrap();
        store
            .set_facts(&p.id, &facts("Birthday stage"))
            .await
            .unwrap();
        let got = store.get(&p.id).await.unwrap().unwrap();
        assert_eq!(
            (got.title.as_str(), got.updated_at.as_str()),
            ("Mum's 60th", "t2")
        );
        assert_eq!(got.facts.description, "A decorated stage.");
    }

    #[tokio::test]
    async fn lists_newest_taken_first_many_is_per_user_and_delete_removes() {
        let (_cat, pool, user, _) = fixture().await;
        let store = SqlitePhotoStore::new(pool);
        let (a, b) = (
            photo("pa", &user, "2026-10-30T01:00:00.000Z"),
            photo("pb", &user, "2026-10-30T02:00:00.000Z"),
        );
        store.create(&a).await.unwrap();
        store.create(&b).await.unwrap();
        let older_taken = PhotoFit {
            width: 1,
            height: 1,
            taken_at: "2020-01-01T00:00:00.000Z".into(),
            camera: None,
        };
        store.set_fit(&b.id, &older_taken).await.unwrap();
        let ids: Vec<String> = store
            .list(&user)
            .await
            .unwrap()
            .iter()
            .map(|p| p.id.to_string())
            .collect();
        assert_eq!(ids, ["pa", "pb"], "pb was taken in 2020");
        let other = UserId::parse("u2").unwrap();
        let wanted = [a.id.clone(), PhotoId::parse("nope").unwrap()];
        assert_eq!(store.many(&user, &wanted).await.unwrap().len(), 1);
        assert!(store.many(&other, &wanted).await.unwrap().is_empty());
        let progress = PhotoProgress {
            status: PhotoStatus::Failed,
            error: Some("x"),
            at: "t3",
        };
        store.set_progress(&a.id, progress).await.unwrap();
        assert_eq!(
            store.get(&a.id).await.unwrap().unwrap().status,
            PhotoStatus::Failed
        );
        store.delete(&a.id).await.unwrap();
        store.delete(&a.id).await.unwrap();
        assert_eq!(store.get(&a.id).await.unwrap(), None);
    }
}
