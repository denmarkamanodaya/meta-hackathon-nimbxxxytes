//! Migrations must never lose rows: 0006 rebuilds `clips` and `jobs`, and 0012 adds the Muse Image
//! columns to tables with children.

use std::str::FromStr;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

use super::register_sqlite_vec;

async fn pool_at_version_5() -> SqlitePool {
    pool_at(5).await
}

async fn pool_at(version: i64) -> SqlitePool {
    register_sqlite_vec().unwrap();
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("../../migrations")
        .run_to(version, &pool)
        .await
        .unwrap();
    pool
}

async fn exec(pool: &SqlitePool, sql: &'static str) {
    sqlx::query(sql).execute(pool).await.unwrap();
}

async fn count(pool: &SqlitePool, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// A user, a ready clip with a title, and one row in each table that references it.
async fn seed(pool: &SqlitePool) {
    exec(
        pool,
        "INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1', 't')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO clips (id, user_id, filename, ext, size_bytes, status, created_at, title) \
         VALUES ('c1', 'u1', 'a.mp4', 'mp4', 10, 'ready', 't', 'Dog nap')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO uploads (id, user_id, clip_id, s3_upload_id, key, size_bytes, part_size, \
         status, created_at) VALUES ('up1', 'u1', 'c1', 's3', 'k', 10, 10, 'completed', 't')",
    )
    .await;
    exec(
        pool,
        "INSERT INTO segments (id, clip_id, idx, start_s, end_s) VALUES ('c1-s0', 'c1', 0, 0, 7)",
    )
    .await;
    exec(
        pool,
        "INSERT INTO face_tracks (id, clip_id, ordinal, first_s, last_s, max_area) \
         VALUES ('c1-f0', 'c1', 0, 1, 2, 0.1)",
    )
    .await;
    exec(
        pool,
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j1', 'title', 'c1', 'done', 't', 't')",
    )
    .await;
}

#[tokio::test]
async fn migration_6_keeps_every_row_that_references_a_clip() {
    let pool = pool_at_version_5().await;
    seed(&pool).await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    for (table, sql) in [
        ("segments", "SELECT COUNT(*) FROM segments"),
        ("face_tracks", "SELECT COUNT(*) FROM face_tracks"),
        ("uploads", "SELECT COUNT(*) FROM uploads"),
        ("jobs", "SELECT COUNT(*) FROM jobs"),
    ] {
        assert_eq!(count(&pool, sql).await, 1, "{table} lost rows");
    }
    let (title, status, hash): (String, String, Option<String>) =
        sqlx::query_as("SELECT title, status, content_sha256 FROM clips WHERE id = 'c1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (title.as_str(), status.as_str(), hash),
        ("Dog nap", "ready", None)
    );
}

#[tokio::test]
async fn after_migration_6_the_new_values_fit_and_foreign_keys_still_cascade() {
    let pool = pool_at_version_5().await;
    seed(&pool).await;
    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    exec(
        &pool,
        "UPDATE clips SET status = 'duplicate', duplicate_of = 'c0' WHERE id = 'c1'",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j2', 'hash', 'c1', 'queued', 't', 't'), ('j3', 'face_vectors', 'u1', 'queued', 't', 't')",
    )
    .await;
    assert_eq!(
        count(&pool, "SELECT foreign_keys FROM pragma_foreign_keys").await,
        1
    );
    // uploads references clips without a cascade, so a clip's upload row goes first.
    exec(&pool, "DELETE FROM uploads WHERE clip_id = 'c1'").await;
    exec(&pool, "DELETE FROM clips WHERE id = 'c1'").await;

    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM segments").await,
        0,
        "cascade still on"
    );
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM face_tracks").await, 0);
}

/// A story short with a Reels export of two covers, its production with one covered shot, and a
/// project holding the clip (on top of [`seed`]).
async fn seed_studio(pool: &SqlitePool) {
    for sql in [
        "INSERT INTO shorts (id, user_id, prompt, aspect, target_s, status, created_at) \
         VALUES ('x1', 'u1', 'p', '4:5', 20, 'ready', 't')",
        "INSERT INTO short_exports (id, short_id, platform, aspect, version_n, status, \
         cover_keys, cover_pick, updated_at) \
         VALUES ('x1-reels', 'x1', 'reels', '9:16', 1, 'ready', '[\"k0\",\"k1\"]', 1, 't')",
        "INSERT INTO productions (id, user_id, title, brief, format, aspect, target_s, status, \
         short_id, created_at) VALUES ('p1', 'u1', 'T', 'B', 'story', '4:5', 60, 'shooting', \
         'x1', 't')",
        "INSERT INTO production_shots (id, production_id, ord, act, title, direction, tips, \
         query, duration_s, board_key, matched_segment_id) VALUES ('sh1', 'p1', 1, 'hook', 't', \
         'd', '[]', 'q', 4, 'b.webp', 'c1-s0')",
        "INSERT INTO projects (id, user_id, name, color, created_at, updated_at) \
         VALUES ('pr1', 'u1', 'Tokyo', 'blue', 't', 't')",
        "INSERT INTO project_clips (project_id, clip_id, added_at) VALUES ('pr1', 'c1', 't')",
    ] {
        exec(pool, sql).await;
    }
}

#[tokio::test]
async fn migration_12_keeps_every_production_shot_export_and_project_row() {
    let pool = pool_at(11).await;
    seed(&pool).await;
    seed_studio(&pool).await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    for (table, sql) in [
        ("short_exports", "SELECT COUNT(*) FROM short_exports"),
        ("productions", "SELECT COUNT(*) FROM productions"),
        ("production_shots", "SELECT COUNT(*) FROM production_shots"),
        ("projects", "SELECT COUNT(*) FROM projects"),
        ("project_clips", "SELECT COUNT(*) FROM project_clips"),
        ("segments", "SELECT COUNT(*) FROM segments"),
    ] {
        assert_eq!(count(&pool, sql).await, 1, "{table} lost rows");
    }
    let shot: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT matched_segment_id, footage_board_key, footage_board_segment \
         FROM production_shots",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(shot, (Some("c1-s0".into()), None, None));
}

#[tokio::test]
async fn migration_12_columns_start_empty_beside_the_kept_values() {
    let pool = pool_at(11).await;
    seed(&pool).await;
    seed_studio(&pool).await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    let export: (String, String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT cover_keys, cover_info, cover_title, titled_cover_key FROM short_exports",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(export, ("[\"k0\",\"k1\"]".into(), "[]".into(), None, None));
    let art: (Option<String>, i64, Option<String>, String, i64) = sqlx::query_as(
        "SELECT p.art_key, p.art_auto, j.art_key, j.art_sources, j.art_auto \
         FROM productions p, projects j",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(art, (None, 0, None, "[]".into(), 0));
}

#[tokio::test]
async fn migration_13_keeps_finishes_and_users_and_defaults_the_new_switches() {
    let pool = pool_at(12).await;
    seed(&pool).await;
    seed_studio(&pool).await;
    exec(
        &pool,
        "INSERT INTO short_finish (short_id, blur_bystanders, title_text, speaker_colors, effect) \
         VALUES ('x1', 0, 'Hi', 1, 'spotlight')",
    )
    .await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    let finish: (bool, Option<String>, String, bool) = sqlx::query_as(
        "SELECT blur_bystanders, title_text, effect, keep_subject FROM short_finish",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(finish, (false, Some("Hi".into()), "spotlight".into(), true));
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM short_exports").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM segments").await, 1);
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM users WHERE blur_objects = 0").await,
        count(&pool, "SELECT COUNT(*) FROM users").await
    );
    exec(
        &pool,
        "INSERT INTO object_tracks (id, clip_id, user_id, label, t_s, start_s, end_s, created_at) \
         VALUES ('o1', 'c1', 'u1', 'mug', 1, 0, 3, 't')",
    )
    .await;
    let orphan = sqlx::query(
        "INSERT INTO object_tracks (id, clip_id, user_id, label, t_s, start_s, end_s, created_at) \
         VALUES ('o2', 'nope', 'u1', 'mug', 1, 0, 3, 't')",
    )
    .execute(&pool)
    .await;
    assert!(orphan.is_err(), "a tapped object belongs to a real clip");
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM object_tracks").await, 1);
}

#[tokio::test]
async fn migration_14_keeps_every_job_and_allows_the_guide_kind() {
    let pool = pool_at(13).await;
    seed(&pool).await;
    let jobs = count(&pool, "SELECT COUNT(*) FROM jobs").await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM jobs").await, jobs);
    exec(
        &pool,
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) VALUES \
         ('j-g', 'guide', 'g1', 'queued', 't', 't')",
    )
    .await;
    let bad = sqlx::query(
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j-x', 'nope', 'g1', 'queued', 't', 't')",
    )
    .execute(&pool)
    .await;
    assert!(bad.is_err(), "the kind list is still checked");
    exec(
        &pool,
        "INSERT INTO guides (id, user_id, clip_id, status, created_at, updated_at) \
         VALUES ('g1', 'u1', 'c1', 'queued', 't', 't')",
    )
    .await;
    let second = sqlx::query(
        "INSERT INTO guides (id, user_id, clip_id, status, created_at, updated_at) \
         VALUES ('g2', 'u1', 'c1', 'queued', 't', 't')",
    )
    .execute(&pool)
    .await;
    assert!(second.is_err(), "one guide per clip");
}

#[tokio::test]
async fn migration_15_keeps_every_job_and_allows_the_read_kind() {
    let pool = pool_at(14).await;
    seed(&pool).await;
    let jobs = count(&pool, "SELECT COUNT(*) FROM jobs").await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM jobs").await, jobs);
    exec(
        &pool,
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) VALUES \
         ('j-r', 'read', 'd1', 'queued', 't', 't'), ('j-g', 'guide', 'g1', 'queued', 't', 't')",
    )
    .await;
    let bad = sqlx::query(
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j-x', 'nope', 'd1', 'queued', 't', 't')",
    )
    .execute(&pool)
    .await;
    assert!(bad.is_err(), "the kind list is still checked");
}

async fn try_exec(pool: &SqlitePool, sql: &'static str) -> bool {
    sqlx::query(sql).execute(pool).await.is_ok()
}

#[tokio::test]
async fn migration_15_documents_take_photos_and_pdfs_of_at_most_10_pages() {
    let pool = pool_at(15).await;
    seed(&pool).await;
    exec(
        &pool,
        "INSERT INTO documents (id, user_id, filename, content_type, size_bytes, status, \
         created_at, updated_at) VALUES ('d1', 'u1', 'a.jpg', 'image/jpeg', 9, 'uploading', 't', 't')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO document_pages (document_id, n, image_key) VALUES ('d1', 1, 'k')",
    )
    .await;

    let gif = "INSERT INTO documents (id, user_id, filename, content_type, size_bytes, status, \
         created_at, updated_at) VALUES ('d2', 'u1', 'a.gif', 'image/gif', 9, 'uploading', 't', 't')";
    assert!(!try_exec(&pool, gif).await, "only photos and PDFs");
    let eleventh = "INSERT INTO document_pages (document_id, n, image_key) VALUES ('d1', 11, 'k')";
    assert!(!try_exec(&pool, eleventh).await, "at most 10 pages");
    exec(&pool, "DELETE FROM documents WHERE id = 'd1'").await;
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM document_pages").await, 0);
}

/// Unfinished ingest jobs at old step names, a finished one, and a face vector job at `embed`.
async fn seed_old_jobs(pool: &SqlitePool) {
    for (id, subject, step, status) in [
        ("i-desc", "a", "describe", "running"),
        ("i-faces", "b", "faces", "queued"),
        ("i-embed", "c", "embed", "failed"),
        ("i-seg", "d", "segments", "queued"),
        ("i-done", "e", "ready", "done"),
    ] {
        sqlx::query(
            "INSERT INTO jobs (id, kind, subject_id, step, status, run_after, updated_at) \
             VALUES (?, 'ingest', ?, ?, ?, 't', 't')",
        )
        .bind(id)
        .bind(subject)
        .bind(step)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }
    exec(
        pool,
        "INSERT INTO jobs (id, kind, subject_id, step, status, run_after, updated_at) \
         VALUES ('fv', 'face_vectors', 'u1', 'embed', 'queued', 't', 't')",
    )
    .await;
}

#[tokio::test]
async fn migration_16_keeps_clips_and_children() {
    let pool = pool_at(15).await;
    seed(&pool).await;
    seed_studio(&pool).await;
    exec(
        &pool,
        "UPDATE clips SET content_sha256 = 'abc', duplicate_of = 'c0' WHERE id = 'c1'",
    )
    .await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    for (table, sql) in [
        ("segments", "SELECT COUNT(*) FROM segments"),
        ("face_tracks", "SELECT COUNT(*) FROM face_tracks"),
        ("uploads", "SELECT COUNT(*) FROM uploads"),
        ("project_clips", "SELECT COUNT(*) FROM project_clips"),
    ] {
        assert_eq!(count(&pool, sql).await, 1, "{table} lost rows");
    }
    let kept: (String, String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT title, status, content_sha256, duplicate_of FROM clips WHERE id = 'c1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        kept,
        (
            "Dog nap".into(),
            "ready".into(),
            Some("abc".into()),
            Some("c0".into())
        )
    );
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM segments WHERE blank IS NULL").await,
        1,
        "old segments are marked unchecked"
    );
}

#[tokio::test]
async fn migration_16_moves_unfinished_ingest_jobs_onto_the_new_step_order() {
    let pool = pool_at(15).await;
    seed_old_jobs(&pool).await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    let steps: Vec<(String, String)> =
        sqlx::query_as("SELECT id, step FROM jobs WHERE id LIKE 'i-%' OR id = 'fv' ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    let steps: Vec<(&str, &str)> = steps
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    assert_eq!(
        steps,
        [
            ("fv", "embed"),
            ("i-desc", "segments"),
            ("i-done", "ready"),
            ("i-embed", "faces"),
            ("i-faces", "segments"),
            ("i-seg", "segments"),
        ],
        "unembedded jobs embed next; a job past the old embed only indexes; others are untouched"
    );
}

#[tokio::test]
async fn after_migration_16_near_copies_and_links_fit_and_cascade() {
    let pool = pool_at(15).await;
    seed(&pool).await;
    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();
    exec(
        &pool,
        "INSERT INTO clips (id, user_id, filename, ext, size_bytes, status, created_at) \
         VALUES ('c2', 'u1', 'b.mp4', 'mp4', 10, 'near_copy', 't')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO clip_links (user_id, clip_id, other_id, kind, score, created_at) \
         VALUES ('u1', 'c2', 'c1', 'near_copy_of', 0.95, 't')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j-s', 'similar', 'c1', 'queued', 't', 't')",
    )
    .await;
    let bad_kind = "INSERT INTO clip_links (user_id, clip_id, other_id, kind, score, created_at) \
         VALUES ('u1', 'c1', 'c2', 'nope', 1, 't')";
    assert!(!try_exec(&pool, bad_kind).await, "the kind list is checked");
    let bad_status = "UPDATE clips SET status = 'nope' WHERE id = 'c2'";
    assert!(
        !try_exec(&pool, bad_status).await,
        "the status list is checked"
    );

    exec(&pool, "DELETE FROM uploads WHERE clip_id = 'c1'").await;
    exec(&pool, "DELETE FROM clips WHERE id = 'c1'").await;

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM clip_links").await, 0);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM segments").await, 0);
}

/// A job row as compared across a migration.
type JobRow = (String, String, Option<String>, String, i64, Option<String>);

async fn job_rows(pool: &SqlitePool) -> Vec<JobRow> {
    sqlx::query_as("SELECT id, kind, step, status, attempts, last_error FROM jobs ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn migration_17_keeps_every_job_and_allows_the_listen_kind() {
    let pool = pool_at(16).await;
    seed(&pool).await;
    exec(
        &pool,
        "INSERT INTO jobs (id, kind, subject_id, step, status, attempts, last_error, run_after, \
         updated_at) VALUES ('j-s', 'similar', 'c1', 'embed', 'failed', 3, 'boom', 't2', 't3')",
    )
    .await;
    let before = job_rows(&pool).await;

    sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

    assert_eq!(
        job_rows(&pool).await,
        before,
        "every job row and value is kept"
    );
    exec(
        &pool,
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j-l', 'listen', 'l1', 'queued', 't', 't')",
    )
    .await;
    let bad = "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j-x', 'nope', 'l1', 'queued', 't', 't')";
    assert!(
        !try_exec(&pool, bad).await,
        "the kind list is still checked"
    );
    let twice = "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j-l2', 'listen', 'l1', 'queued', 't', 't')";
    assert!(!try_exec(&pool, twice).await, "one listen job per listen");
}

/// u1's clip listen l1 with one turn, one version and one voice, on a pool at 17.
async fn listen_pool() -> SqlitePool {
    let pool = pool_at(17).await;
    seed(&pool).await;
    exec(
        &pool,
        "INSERT INTO listens (id, user_id, source, clip_id, source_name, status, target, \
         created_at, updated_at) VALUES ('l1', 'u1', 'clip', 'c1', 'Dog nap', 'listening', 'en', \
         't', 't')",
    )
    .await;
    for sql in [
        "INSERT INTO listen_turns (listen_id, idx, start_ms, end_ms, text) VALUES ('l1', 0, 0, 9, 'hi')",
        "INSERT INTO listen_versions (listen_id, version, draft) VALUES ('l1', 1, '{}')",
        "INSERT INTO listen_voices (listen_id, key) VALUES ('l1', 'k')",
    ] {
        exec(&pool, sql).await;
    }
    pool
}

#[tokio::test]
async fn migration_17_checks_every_listen_value() {
    let pool = listen_pool().await;
    let bad = [
        "UPDATE listens SET target = 'xx' WHERE id = 'l1'",
        "UPDATE listens SET status = 'reading' WHERE id = 'l1'",
        "UPDATE listens SET version = 4 WHERE id = 'l1'",
        "UPDATE listens SET ext = 'exe' WHERE id = 'l1'",
        "UPDATE listens SET step = 'ready' WHERE id = 'l1'",
        "UPDATE listens SET size_bytes = 314572801 WHERE id = 'l1'",
        "UPDATE listens SET duration_ms = 7200001 WHERE id = 'l1'",
        "UPDATE listens SET heard_by = 'guess' WHERE id = 'l1'",
        "INSERT INTO listen_versions (listen_id, version, draft) VALUES ('l1', 4, '{}')",
        "UPDATE listen_turns SET score = 101",
    ];
    for sql in bad {
        assert!(!try_exec(&pool, sql).await, "{sql}");
    }
}

#[tokio::test]
async fn migration_17_listens_cascade_to_their_rows_and_outlive_their_clip() {
    let pool = listen_pool().await;

    exec(&pool, "DELETE FROM uploads WHERE clip_id = 'c1'").await;
    exec(&pool, "DELETE FROM clips WHERE id = 'c1'").await;
    let clip: Option<String> = sqlx::query_scalar("SELECT clip_id FROM listens WHERE id = 'l1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(clip, None, "the listen stays when its clip goes");
    exec(&pool, "DELETE FROM listens WHERE id = 'l1'").await;
    let counts = [
        "SELECT COUNT(*) FROM listen_turns",
        "SELECT COUNT(*) FROM listen_versions",
        "SELECT COUNT(*) FROM listen_voices",
    ];
    for sql in counts {
        let n: i64 = sqlx::query_scalar(sql).fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0, "{sql}");
    }
}
