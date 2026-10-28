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
