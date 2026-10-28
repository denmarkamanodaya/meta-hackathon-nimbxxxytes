//! [`ProductionStore`] on SQLite: `productions` and `production_shots`, plus two reads of the
//! catalogue the planner needs (the library summary and when a clip last became ready).

mod library;

use nimbytes_core::domain::ids::{ProductionId, SegmentId, ShortId, ShotId, UserId};
use nimbytes_core::domain::production::{
    Act, CoverageMatch, Format, Production, ProductionStatus, Shot,
};
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{LibrarySummary, PortResult, ProductionStore};
use nimbytes_core::{AppError, ErrorCode};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::db_err;

/// Productions on the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteProductionStore {
    pool: SqlitePool,
}

/// Every `productions` column a [`Production`] is inserted with; a macro so SQL stays literal.
macro_rules! production_columns {
    () => {
        "id, user_id, title, brief, format, aspect, target_s, blur_bystanders, status, short_id, \
         coverage_checked_at, error, created_at"
    };
}

/// [`production_columns`] plus the columns only the art run writes, as [`production_from`]
/// reads them.
macro_rules! production_read_columns {
    () => {
        concat!(production_columns!(), ", art_key")
    };
}

fn production_from(r: &SqliteRow) -> Result<Production, AppError> {
    let text = |c: &str| r.try_get::<String, _>(c).map_err(db_err);
    let opt = |c: &str| r.try_get::<Option<String>, _>(c).map_err(db_err);
    Ok(Production {
        id: ProductionId::parse(text("id")?)?,
        user_id: UserId::parse(text("user_id")?)?,
        title: text("title")?,
        brief: text("brief")?,
        format: Format::parse(&text("format")?)?,
        aspect: Aspect::parse(&text("aspect")?)?,
        target_s: r.try_get("target_s").map_err(db_err)?,
        blur_bystanders: r.try_get("blur_bystanders").map_err(db_err)?,
        status: ProductionStatus::parse(&text("status")?)?,
        short_id: opt("short_id")?.map(ShortId::parse).transpose()?,
        coverage_checked_at: opt("coverage_checked_at")?,
        error: opt("error")?,
        created_at: text("created_at")?,
        art_key: opt("art_key")?.map(ObjectKey::from_stored),
    })
}

fn bad_json(e: serde_json::Error) -> AppError {
    AppError::new(ErrorCode::Internal, format!("stored tips: {e}"))
}

fn shot_from(r: &SqliteRow) -> Result<Shot, AppError> {
    let text = |c: &str| r.try_get::<String, _>(c).map_err(db_err);
    let opt = |c: &str| r.try_get::<Option<String>, _>(c).map_err(db_err);
    let int = |c: &str| {
        r.try_get::<i64, _>(c)
            .map_err(db_err)
            .map(|n| u32::try_from(n).unwrap_or(0))
    };
    Ok(Shot {
        id: ShotId::parse(text("id")?)?,
        ord: int("ord")?,
        act: Act::parse(&text("act")?)?,
        title: text("title")?,
        direction: text("direction")?,
        tips: serde_json::from_str(&text("tips")?).map_err(bad_json)?,
        query: text("query")?,
        duration_s: r.try_get("duration_s").map_err(db_err)?,
        board_key: opt("board_key")?.map(ObjectKey::from_stored),
        matched_segment_id: opt("matched_segment_id")?
            .map(SegmentId::parse)
            .transpose()?,
        match_reason: opt("match_reason")?,
        take_count: int("take_count")?,
        footage_board_key: opt("footage_board_key")?.map(ObjectKey::from_stored),
        footage_board_segment: opt("footage_board_segment")?
            .map(SegmentId::parse)
            .transpose()?,
    })
}

impl SqliteProductionStore {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn insert(&self, p: &Production) -> Result<(), AppError> {
        sqlx::query(concat!(
            "INSERT INTO productions (",
            production_columns!(),
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(p.id.as_str())
        .bind(p.user_id.as_str())
        .bind(&p.title)
        .bind(&p.brief)
        .bind(p.format.as_str())
        .bind(p.aspect.as_str())
        .bind(p.target_s)
        .bind(p.blur_bystanders)
        .bind(p.status.as_str())
        .bind(p.short_id.as_ref().map(ShortId::as_str))
        .bind(&p.coverage_checked_at)
        .bind(&p.error)
        .bind(&p.created_at)
        .execute(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(())
    }

    async fn insert_plan(
        &self,
        id: &ProductionId,
        title: &str,
        shots: &[Shot],
    ) -> Result<bool, AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        let existing: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM production_shots WHERE production_id = ?")
                .bind(id.as_str())
                .fetch_one(&mut *tx)
                .await
                .map_err(db_err)?;
        if existing > 0 {
            return Ok(false);
        }
        for s in shots {
            let tips = serde_json::to_string(&s.tips).map_err(bad_json)?;
            sqlx::query(
                "INSERT INTO production_shots (id, production_id, ord, act, title, direction, \
                 tips, query, duration_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(s.id.as_str())
            .bind(id.as_str())
            .bind(i64::from(s.ord))
            .bind(s.act.as_str())
            .bind(&s.title)
            .bind(&s.direction)
            .bind(tips)
            .bind(&s.query)
            .bind(s.duration_s)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        }
        sqlx::query("UPDATE productions SET title = ? WHERE id = ?")
            .bind(title)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;
        Ok(true)
    }

    async fn write_coverage(
        &self,
        id: &ProductionId,
        matches: &[CoverageMatch],
        checked_at: &str,
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        for m in matches {
            sqlx::query(
                "UPDATE production_shots SET matched_segment_id = ?, match_reason = ?, \
                 take_count = ? WHERE id = ? AND production_id = ?",
            )
            .bind(m.segment_id.as_ref().map(SegmentId::as_str))
            .bind(&m.reason)
            .bind(i64::from(m.take_count))
            .bind(m.shot_id.as_str())
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        }
        sqlx::query("UPDATE productions SET coverage_checked_at = ? WHERE id = ?")
            .bind(checked_at)
            .bind(id.as_str())
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)
    }

    async fn exec(&self, sql: &'static str, binds: &[Option<&str>]) -> Result<u64, AppError> {
        let mut q = sqlx::query(sql);
        for b in binds {
            q = q.bind(*b);
        }
        let done = q.execute(&self.pool).await.map_err(db_err)?;
        Ok(done.rows_affected())
    }
}

impl ProductionStore for SqliteProductionStore {
    fn create<'a>(&'a self, production: &'a Production) -> PortResult<'a, ()> {
        Box::pin(self.insert(production))
    }

    fn get<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, Option<Production>> {
        Box::pin(async move {
            let sql = concat!(
                "SELECT ",
                production_read_columns!(),
                " FROM productions WHERE id = ?"
            );
            let row = sqlx::query(sql)
                .bind(id.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(db_err)?;
            row.as_ref().map(production_from).transpose()
        })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Production>> {
        Box::pin(async move {
            let sql = concat!(
                "SELECT ",
                production_read_columns!(),
                " FROM productions WHERE user_id = ? ORDER BY created_at DESC, id DESC"
            );
            let rows = sqlx::query(sql)
                .bind(user.as_str())
                .fetch_all(&self.pool)
                .await
                .map_err(db_err)?;
            rows.iter().map(production_from).collect()
        })
    }

    fn shots<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, Vec<Shot>> {
        Box::pin(async move {
            let rows = sqlx::query(
                "SELECT id, ord, act, title, direction, tips, query, duration_s, board_key, \
                 matched_segment_id, match_reason, take_count, footage_board_key, \
                 footage_board_segment FROM production_shots \
                 WHERE production_id = ? ORDER BY ord",
            )
            .bind(id.as_str())
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
            rows.iter().map(shot_from).collect()
        })
    }

    fn save_plan<'a>(
        &'a self,
        id: &'a ProductionId,
        title: &'a str,
        shots: &'a [Shot],
    ) -> PortResult<'a, bool> {
        Box::pin(self.insert_plan(id, title, shots))
    }

    fn set_board<'a>(&'a self, shot: &'a ShotId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        Box::pin(async move {
            let sql = "UPDATE production_shots SET board_key = ? WHERE id = ?";
            self.exec(sql, &[Some(key.as_str()), Some(shot.as_str())])
                .await
                .map(|_| ())
        })
    }

    fn set_footage_board<'a>(
        &'a self,
        shot: &'a ShotId,
        key: &'a ObjectKey,
        segment: &'a SegmentId,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let sql = "UPDATE production_shots SET footage_board_key = ?, \
                       footage_board_segment = ? WHERE id = ?";
            let binds = [
                Some(key.as_str()),
                Some(segment.as_str()),
                Some(shot.as_str()),
            ];
            self.exec(sql, &binds).await.map(|_| ())
        })
    }

    fn set_title<'a>(&'a self, id: &'a ProductionId, title: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            let sql = "UPDATE productions SET title = ? WHERE id = ?";
            self.exec(sql, &[Some(title), Some(id.as_str())])
                .await
                .map(|_| ())
        })
    }

    fn set_art<'a>(&'a self, id: &'a ProductionId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        Box::pin(async move {
            let sql = "UPDATE productions SET art_key = ? WHERE id = ?";
            self.exec(sql, &[Some(key.as_str()), Some(id.as_str())])
                .await
                .map(|_| ())
        })
    }

    fn claim_auto_art<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, bool> {
        Box::pin(async move {
            let sql = "UPDATE productions SET art_auto = 1 WHERE id = ? AND art_auto = 0";
            Ok(self.exec(sql, &[Some(id.as_str())]).await? == 1)
        })
    }

    fn set_coverage<'a>(
        &'a self,
        id: &'a ProductionId,
        matches: &'a [CoverageMatch],
        checked_at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(self.write_coverage(id, matches, checked_at))
    }

    fn set_status<'a>(
        &'a self,
        id: &'a ProductionId,
        status: ProductionStatus,
        error: Option<&'a str>,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let sql = "UPDATE productions SET status = ?, error = ? WHERE id = ?";
            self.exec(sql, &[Some(status.as_str()), error, Some(id.as_str())])
                .await
                .map(|_| ())
        })
    }

    fn set_cut<'a>(&'a self, id: &'a ProductionId, short: &'a ShortId) -> PortResult<'a, bool> {
        Box::pin(async move {
            // A link to a short that no longer exists counts as no link.
            let sql = "UPDATE productions SET short_id = ?, status = 'cutting' WHERE id = ? \
                       AND (short_id IS NULL OR short_id NOT IN (SELECT id FROM shorts))";
            let n = self
                .exec(sql, &[Some(short.as_str()), Some(id.as_str())])
                .await?;
            Ok(n == 1)
        })
    }

    fn by_short<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<Production>> {
        Box::pin(async move {
            let sql = concat!(
                "SELECT ",
                production_read_columns!(),
                " FROM productions WHERE short_id = ?"
            );
            let row = sqlx::query(sql)
                .bind(short.as_str())
                .fetch_optional(&self.pool)
                .await
                .map_err(db_err)?;
            row.as_ref().map(production_from).transpose()
        })
    }

    fn fail_planning<'a>(&'a self, error: &'a str) -> PortResult<'a, u64> {
        Box::pin(async move {
            let sql =
                "UPDATE productions SET status = 'failed', error = ? WHERE status = 'planning'";
            self.exec(sql, &[Some(error)]).await
        })
    }

    fn delete<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, ()> {
        Box::pin(async move {
            // Shots go with it (ON DELETE CASCADE).
            let sql = "DELETE FROM productions WHERE id = ?";
            self.exec(sql, &[Some(id.as_str())]).await.map(|_| ())
        })
    }

    fn library_summary<'a>(&'a self, user: &'a UserId) -> PortResult<'a, LibrarySummary> {
        Box::pin(library::summary(&self.pool, user))
    }

    fn last_ready_at<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<String>> {
        Box::pin(library::last_ready_at(&self.pool, user))
    }
}

#[cfg(test)]
mod tests;
