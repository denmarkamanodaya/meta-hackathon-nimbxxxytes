//! [`JobQueue`] on the SQLite `jobs` table. Claims are one `UPDATE … RETURNING` statement, so
//! SQLite's single writer guarantees two workers never claim the same row.

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::JobId;
use nimbytes_core::domain::job::{Job, JobKind, JobState, JobStatus};
use nimbytes_core::ports::{EpochMillis, JobFailure, JobQueue, NewJob, PortResult};
use nimbytes_core::time::format_utc;
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use super::db_err;

/// Job queue backed by the shared SQLite pool.
#[derive(Debug, Clone)]
pub struct SqliteJobQueue {
    pool: SqlitePool,
}

impl SqliteJobQueue {
    /// Wraps a migrated pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Runs one `UPDATE jobs … WHERE id = ?` with `status`, `updated_at` and extra bindings.
    async fn set(&self, sql: &'static str, id: &JobId, binds: &[&str]) -> Result<(), AppError> {
        let mut query = sqlx::query(sql);
        for value in binds {
            query = query.bind(*value);
        }
        query
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }
}

/// `CODE_NAME: message` stored as the job's last error.
fn error_text(error: &AppError) -> String {
    format!("{:?}: {}", error.code, error.message)
}

fn job_from_row(row: &SqliteRow) -> Result<Job, AppError> {
    let attempts: i64 = row.try_get("attempts").map_err(db_err)?;
    Ok(Job {
        id: JobId::parse(row.try_get::<String, _>("id").map_err(db_err)?)?,
        kind: JobKind::parse(row.try_get("kind").map_err(db_err)?)?,
        subject_id: row.try_get("subject_id").map_err(db_err)?,
        step: row.try_get("step").map_err(db_err)?,
        attempts: u32::try_from(attempts).unwrap_or(u32::MAX),
    })
}

impl JobQueue for SqliteJobQueue {
    fn enqueue<'a>(&'a self, job: NewJob<'a>, now: EpochMillis) -> PortResult<'a, ()> {
        Box::pin(async move {
            let now = format_utc(now);
            sqlx::query(
                "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
                 VALUES (?, ?, ?, 'queued', ?, ?) ON CONFLICT (kind, subject_id) DO NOTHING",
            )
            .bind(job.id.as_str())
            .bind(job.kind.as_str())
            .bind(job.subject_id)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }

    fn claim(&self, now: EpochMillis) -> PortResult<'_, Option<Job>> {
        Box::pin(async move {
            let now = format_utc(now);
            let row = sqlx::query(
                "UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? \
                 WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ? \
                             ORDER BY run_after, id LIMIT 1) \
                 RETURNING id, kind, subject_id, step, attempts",
            )
            .bind(&now)
            .bind(&now)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
            row.as_ref().map(job_from_row).transpose()
        })
    }

    fn advance<'a>(&'a self, id: &'a JobId, step: &'a str, now: EpochMillis) -> PortResult<'a, ()> {
        Box::pin(async move {
            let now = format_utc(now);
            self.set(
                "UPDATE jobs SET step = ?, updated_at = ? WHERE id = ?",
                id,
                &[step, &now],
            )
            .await
        })
    }

    fn retry_at<'a>(
        &'a self,
        id: &'a JobId,
        failure: JobFailure<'a>,
        run_after: EpochMillis,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let (error, run_after, now) = (
                error_text(failure.error),
                format_utc(run_after),
                format_utc(failure.now),
            );
            self.set(
                "UPDATE jobs SET status = 'queued', last_error = ?, run_after = ?, updated_at = ? \
                 WHERE id = ?",
                id,
                &[&error, &run_after, &now],
            )
            .await
        })
    }

    fn fail<'a>(&'a self, id: &'a JobId, failure: JobFailure<'a>) -> PortResult<'a, ()> {
        Box::pin(async move {
            let (error, now) = (error_text(failure.error), format_utc(failure.now));
            self.set(
                "UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?",
                id,
                &[&error, &now],
            )
            .await
        })
    }

    fn done<'a>(&'a self, id: &'a JobId, now: EpochMillis) -> PortResult<'a, ()> {
        Box::pin(async move {
            let now = format_utc(now);
            self.set(
                "UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?",
                id,
                &[&now],
            )
            .await
        })
    }

    fn find<'a>(&'a self, kind: JobKind, subject_id: &'a str) -> PortResult<'a, Option<JobState>> {
        Box::pin(async move {
            let row: Option<(String, Option<String>, String)> = sqlx::query_as(
                "SELECT id, step, status FROM jobs WHERE kind = ? AND subject_id = ?",
            )
            .bind(kind.as_str())
            .bind(subject_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
            row.map(|(id, step, status)| {
                Ok(JobState {
                    id: JobId::parse(id)?,
                    step,
                    status: JobStatus::parse(&status)?,
                })
            })
            .transpose()
        })
    }

    fn restart<'a>(
        &'a self,
        kind: JobKind,
        subject_id: &'a str,
        now: EpochMillis,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let now = format_utc(now);
            sqlx::query(
                "UPDATE jobs SET status = 'queued', step = NULL, attempts = 0, last_error = NULL, \
                 run_after = ?, updated_at = ? \
                 WHERE kind = ? AND subject_id = ? AND status IN ('done', 'failed')",
            )
            .bind(&now)
            .bind(&now)
            .bind(kind.as_str())
            .bind(subject_id)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(())
        })
    }

    fn requeue_running(&self, now: EpochMillis) -> PortResult<'_, u64> {
        Box::pin(async move {
            let result = sqlx::query(
                "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'",
            )
            .bind(format_utc(now))
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
            Ok(result.rows_affected())
        })
    }

    fn cancel<'a>(&'a self, kind: JobKind, subject_id: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            sqlx::query("DELETE FROM jobs WHERE kind = ? AND subject_id = ?")
                .bind(kind.as_str())
                .bind(subject_id)
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests;
