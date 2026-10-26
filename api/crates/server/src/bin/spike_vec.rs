//! Spike 0.5 (throwaway): load sqlite-vec into sqlx's bundled SQLite through
//! `sqlite3_auto_extension`, create a `vec0` table, insert vectors, run KNN queries, and compare
//! latency with a brute-force cosine scan in Rust (the fallback).
//!
//! Run: `cargo run --release -p nimbytes-server --bin spike_vec -- [rows] [dim]`
//! (defaults 5000 rows, 1024 dims). Writes a temp-file database so the pool opens several
//! connections, proving the extension registers on every one of them.

use std::error::Error;
use std::time::Instant;

use sqlx::Row;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

type Res<T> = Result<T, Box<dyn Error>>;

#[tokio::main]
async fn main() -> Res<()> {
    let mut args = std::env::args().skip(1);
    let rows: usize = args.next().map_or(Ok(5000), |a| a.parse())?;
    let dim: usize = args.next().map_or(Ok(1024), |a| a.parse())?;

    register_sqlite_vec()?;
    let dir = tempfile_dir()?;
    let pool = open_pool(&dir).await?;
    create_table(&pool, dim).await?;
    let vectors: Vec<Vec<f32>> = (0..rows)
        .map(|i| pseudo_vector(i as u64 + 1, dim))
        .collect();
    insert_all(&pool, &vectors).await?;

    // Query = a slightly perturbed copy of row 42, so row 42 must come back first.
    let mut query = vectors[42].clone();
    query[0] += 0.01;
    let blob = to_blob(&query);
    knn(&pool, &blob, None).await?;
    knn(&pool, &blob, Some("u1")).await?;
    knn(&pool, &blob, Some("u2")).await?;
    concurrent_top1(&pool, &blob).await?;

    brute_force(&vectors, &query);
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}

async fn open_pool(dir: &std::path::Path) -> Res<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(dir.join("spike_vec.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;
    let version: String = sqlx::query_scalar("select vec_version()")
        .fetch_one(&pool)
        .await?;
    let sqlite: String = sqlx::query_scalar("select sqlite_version()")
        .fetch_one(&pool)
        .await?;
    println!("vec_version = {version}, sqlite_version = {sqlite}");
    Ok(pool)
}

async fn create_table(pool: &SqlitePool, dim: usize) -> Res<()> {
    // `dim` is a parsed integer, so the formatted DDL carries no user text.
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "create virtual table segment_vectors using vec0(\
           segment_id text primary key, \
           user_id text partition key, \
           embedding float[{dim}] distance_metric=cosine)"
    )))
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_all(pool: &SqlitePool, vectors: &[Vec<f32>]) -> Res<()> {
    let started = Instant::now();
    let mut tx = pool.begin().await?;
    for (i, v) in vectors.iter().enumerate() {
        sqlx::query("insert into segment_vectors(segment_id, user_id, embedding) values (?, ?, ?)")
            .bind(format!("s{i}"))
            .bind(if i % 2 == 0 { "u1" } else { "u2" })
            .bind(to_blob(v))
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    let dim = vectors.first().map_or(0, Vec::len);
    println!(
        "insert {} x {dim}: {} ms",
        vectors.len(),
        started.elapsed().as_millis()
    );
    Ok(())
}

/// Runs the query on 4 concurrent tasks so the pool opens new handles; each must see vec0.
async fn concurrent_top1(pool: &SqlitePool, blob: &[u8]) -> Res<()> {
    let mut tasks = Vec::new();
    for _ in 0..4 {
        let pool = pool.clone();
        let blob = blob.to_vec();
        tasks.push(tokio::spawn(async move {
            let row = sqlx::query(
                "select segment_id from segment_vectors where embedding match ? and k = 1",
            )
            .bind(blob)
            .fetch_one(&pool)
            .await?;
            Ok::<String, sqlx::Error>(row.get(0))
        }));
    }
    for t in tasks {
        println!("concurrent top1 = {}", t.await??);
    }
    println!("pool size after concurrent queries = {}", pool.size());
    Ok(())
}

/// Registers sqlite-vec for every connection opened after this call.
fn register_sqlite_vec() -> Res<()> {
    // SAFETY: sqlite3_vec_init has the standard extension entry signature
    // (sqlite3*, char**, const sqlite3_api_routines*) -> int (sqlite-vec.h); the crate declares it
    // with no arguments, so it is cast to the type sqlite3_auto_extension expects.
    let rc = unsafe {
        libsqlite3_sys::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(
                *mut libsqlite3_sys::sqlite3,
                *mut *mut std::ffi::c_char,
                *const libsqlite3_sys::sqlite3_api_routines,
            ) -> std::ffi::c_int,
        >(
            sqlite_vec::sqlite3_vec_init as *const ()
        )))
    };
    if rc == libsqlite3_sys::SQLITE_OK {
        Ok(())
    } else {
        Err(format!("sqlite3_auto_extension returned {rc}").into())
    }
}

async fn knn(pool: &SqlitePool, blob: &[u8], user: Option<&str>) -> Res<()> {
    let started = Instant::now();
    let rows = match user {
        None => {
            sqlx::query(
                "select segment_id, distance from segment_vectors \
                 where embedding match ? and k = 5 order by distance",
            )
            .bind(blob)
            .fetch_all(pool)
            .await?
        }
        Some(u) => {
            sqlx::query(
                "select segment_id, distance from segment_vectors \
                 where embedding match ? and k = 5 and user_id = ? order by distance",
            )
            .bind(blob)
            .bind(u)
            .fetch_all(pool)
            .await?
        }
    };
    let elapsed = started.elapsed();
    let hits: Vec<String> = rows
        .iter()
        .map(|r| format!("{}:{:.4}", r.get::<String, _>(0), r.get::<f64, _>(1)))
        .collect();
    println!(
        "knn k=5 user={user:?}: {:.2} ms -> {}",
        elapsed.as_secs_f64() * 1e3,
        hits.join(", ")
    );
    Ok(())
}

fn brute_force(vectors: &[Vec<f32>], query: &[f32]) {
    let started = Instant::now();
    let qn = norm(query);
    let mut scored: Vec<(usize, f32)> = vectors
        .iter()
        .enumerate()
        .map(|(i, v)| (i, 1.0 - dot(v, query) / (norm(v) * qn)))
        .collect();
    scored.sort_by(|a, b| a.1.total_cmp(&b.1));
    let top: Vec<String> = scored
        .iter()
        .take(5)
        .map(|(i, d)| format!("s{i}:{d:.4}"))
        .collect();
    println!(
        "brute-force cosine over {} rows: {:.2} ms -> {}",
        vectors.len(),
        started.elapsed().as_secs_f64() * 1e3,
        top.join(", ")
    );
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn norm(a: &[f32]) -> f32 {
    dot(a, a).sqrt()
}

/// sqlite-vec reads a float32 vector from a little-endian BLOB.
fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Deterministic vector in [-1, 1) from a 64-bit LCG; no rand dependency needed for a spike.
fn pseudo_vector(seed: u64, dim: usize) -> Vec<f32> {
    let mut state = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
    (0..dim)
        .map(|_| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((state >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
        })
        .collect()
}

fn tempfile_dir() -> Res<std::path::PathBuf> {
    let dir = std::env::temp_dir().join(format!("nimbytes-spike-vec-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
