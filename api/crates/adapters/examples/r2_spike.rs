//! Phase 12.1 spike: checks what nimbytes needs from Cloudflare R2, through the real storage
//! adapter in R2 mode (the same client settings the server will use), and prints a go/no-go table.
//!
//! (a) presigned multipart part PUTs, with the ETag readable through CORS; (b) a presigned Range
//! GET answers 206; (c) `response-content-disposition` on a presigned download; (d) `Cache-Control`
//! kept on a put; (e) creating objects without tags; (f) time to first byte and throughput, one
//! stream and 4 parallel ranges.
//!
//! Every object goes under `users/r2-spike/` and is deleted at the end, except the throughput
//! object when `SPIKE_KEEP=1` (its presigned URL is printed, valid 1 h, for
//! `scripts/r2-throughput.sh` on the box). Credentials come from the environment only:
//!
//! ```text
//! set -a; . ./.env; set +a
//! cargo run -p nimbytes-adapters --example r2_spike
//! ```
//!
//! Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_SPIKE_BUCKET` (falls back
//! to `R2_BUCKET`); optional `SPIKE_ORIGIN` (default `https://localhost`), `SPIKE_MB` (default 32).

use std::error::Error;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aws_sdk_s3::config::{BehaviorVersion, Credentials};
use nimbytes_adapters::SystemClock;
use nimbytes_adapters::s3::{S3BlobStore, r2};
use nimbytes_core::domain::ids::{ClipId, SegmentId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::upload::CompletedPart;
use nimbytes_core::keys::{self, ObjectClass, ObjectKey};
use nimbytes_core::ports::{BlobStore, PutFile};
use reqwest::header::{HeaderMap, ORIGIN, RANGE};

type Outcome<T> = Result<T, Box<dyn Error>>;

/// S3 and R2 refuse parts smaller than 5 MiB except the last.
const PART_BYTES: usize = 5 * 1024 * 1024;
const URL_TTL: Duration = Duration::from_secs(3600);

struct Spike {
    store: S3BlobStore,
    http: reqwest::Client,
    origin: String,
    rows: Vec<(&'static str, bool, String)>,
}

fn env(key: &str) -> Outcome<String> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("env {key} is required").into())
}

fn store() -> Outcome<S3BlobStore> {
    let bucket = env("R2_SPIKE_BUCKET").or_else(|_| env("R2_BUCKET"))?;
    let keys = Credentials::new(
        env("R2_ACCESS_KEY_ID")?,
        env("R2_SECRET_ACCESS_KEY")?,
        None,
        None,
        "r2-spike",
    );
    let builder = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .credentials_provider(keys);
    let endpoint = r2::endpoint(env("R2_ACCOUNT_ID")?.trim())?;
    let client = aws_sdk_s3::Client::from_conf(r2::configure(builder, &endpoint).build());
    let ttl = Duration::from_secs(900);
    Ok(S3BlobStore::new(client, bucket, ttl, Arc::new(SystemClock)).without_object_tags())
}

fn header(h: &HeaderMap, name: &str) -> String {
    h.get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned()
}

impl Spike {
    fn record(&mut self, check: &'static str, pass: bool, note: String) {
        println!("{} {check}: {note}", if pass { "PASS" } else { "FAIL" });
        self.rows.push((check, pass, note));
    }

    /// (a) and (e): a tag-free multipart upload whose part ETags the browser can read.
    async fn multipart(&mut self, key: &ObjectKey, bytes: &[u8]) -> Outcome<()> {
        let id = self
            .store
            .create_multipart(key, "video/mp4", ObjectClass::Original)
            .await?;
        self.record(
            "e create without tags",
            true,
            "CreateMultipartUpload accepted".into(),
        );
        let mut parts = Vec::new();
        for (i, chunk) in bytes.chunks(PART_BYTES).enumerate() {
            let n = u32::try_from(i + 1)?;
            let url = self.store.presign_upload_part(key, &id, n).await?;
            let res = self
                .http
                .put(&url)
                .header(ORIGIN, &self.origin)
                .body(chunk.to_vec())
                .send()
                .await?;
            let etag = header(res.headers(), "etag");
            let exposed = header(res.headers(), "access-control-expose-headers").to_lowercase();
            let allowed = header(res.headers(), "access-control-allow-origin");
            let ok = res.status().is_success() && !etag.is_empty() && exposed.contains("etag");
            let note = format!(
                "part {n}: {}, ETag {etag}, expose [{exposed}], allow [{allowed}]",
                res.status()
            );
            self.record("a part PUT + ETag via CORS", ok, note);
            parts.push(CompletedPart { n, etag });
        }
        self.store.complete_multipart(key, &id, &parts).await?;
        let size = self.store.object_size(key).await?;
        let whole = size == u64::try_from(bytes.len())?;
        self.record("a complete + size", whole, format!("{size} bytes"));
        Ok(())
    }

    /// (b) a presigned Range GET answers 206 with the asked bytes.
    async fn range(&mut self, key: &ObjectKey) -> Outcome<()> {
        let url = self.store.presign_get(key, URL_TTL).await?;
        let res = self
            .http
            .get(&url)
            .header(RANGE, "bytes=0-1023")
            .send()
            .await?;
        let status = res.status().as_u16();
        let range = header(res.headers(), "content-range");
        let len = res.bytes().await?.len();
        self.record(
            "b Range GET 206",
            status == 206 && len == 1024,
            format!("{status}, {range}, {len} bytes"),
        );
        Ok(())
    }

    /// (c) whether `response-content-disposition` reaches the response.
    async fn disposition(&mut self, key: &ObjectKey) -> Outcome<()> {
        let url = self
            .store
            .presign_download(key, URL_TTL, "nimbytes-short-v1.mp4")
            .await?;
        let res = self
            .http
            .get(&url)
            .header(RANGE, "bytes=0-0")
            .send()
            .await?;
        let got = header(res.headers(), "content-disposition");
        let honoured = got.contains("nimbytes-short-v1.mp4");
        let fallback = if honoured {
            ""
        } else {
            "; fallback: set Content-Disposition when writing"
        };
        self.record(
            "c response-content-disposition",
            honoured,
            format!("[{got}]{fallback}"),
        );
        Ok(())
    }

    /// (d) and (e): a tagged-class put is accepted and keeps its Cache-Control.
    async fn cache_control(&mut self, key: &ObjectKey) -> Outcome<()> {
        let dir = std::env::temp_dir().join(format!("r2-spike-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await?;
        let path = dir.join("thumb.jpg");
        tokio::fs::write(&path, b"spike").await?;
        let put = PutFile {
            key,
            path: &path,
            content_type: "image/jpeg",
            class: Some(ObjectClass::Preview),
            cache_control: Some(keys::DERIVED_CACHE_CONTROL),
        };
        self.store.put_file(put).await?;
        self.store.tag(key, ObjectClass::Preview).await?;
        tokio::fs::remove_dir_all(&dir).await?;
        let url = self.store.presign_get(key, URL_TTL).await?;
        let res = self.http.get(&url).send().await?;
        let got = header(res.headers(), "cache-control");
        self.record(
            "d Cache-Control kept",
            got == keys::DERIVED_CACHE_CONTROL,
            format!("[{got}]"),
        );
        self.record(
            "e put without tags",
            true,
            "PutObject accepted, tag() skipped".into(),
        );
        Ok(())
    }

    /// (f) TTFB, one full stream and 4 parallel ranges of the object at `url`.
    async fn throughput(&mut self, url: &str, size: usize) -> Outcome<()> {
        let started = Instant::now();
        let mut res = self.http.get(url).send().await?;
        let ttfb = started.elapsed();
        let mut got = 0;
        while let Some(chunk) = res.chunk().await? {
            got += chunk.len();
        }
        let one = mb_per_s(got, started.elapsed());
        let started = Instant::now();
        let quarter = size.div_ceil(4);
        let ranges = (0..4).map(|i| {
            let (from, to) = (i * quarter, ((i + 1) * quarter).min(size) - 1);
            let req = self
                .http
                .get(url)
                .header(RANGE, format!("bytes={from}-{to}"));
            async move { Ok::<_, reqwest::Error>(req.send().await?.bytes().await?.len()) }
        });
        let mut four = 0;
        for r in futures_util::future::join_all(ranges).await {
            four += r?;
        }
        let parallel = mb_per_s(four, started.elapsed());
        let note = format!(
            "TTFB {} ms, 1 stream {one:.1} MB/s, 4 ranges {parallel:.1} MB/s",
            ttfb.as_millis()
        );
        self.record(
            "f latency + throughput (this machine)",
            got == size && four == size,
            note,
        );
        Ok(())
    }

    fn table(&self) {
        println!("\n| Check | Result | Note |\n| --- | --- | --- |");
        for (check, pass, note) in &self.rows {
            println!(
                "| {check} | {} | {note} |",
                if *pass { "go" } else { "no-go" }
            );
        }
    }
}

fn mb_per_s(bytes: usize, took: Duration) -> f64 {
    bytes as f64 / 1_000_000.0 / took.as_secs_f64().max(1e-9)
}

#[tokio::main]
async fn main() -> Outcome<()> {
    let mut spike = Spike {
        store: store()?,
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()?,
        origin: std::env::var("SPIKE_ORIGIN").unwrap_or_else(|_| "https://localhost".into()),
        rows: Vec::new(),
    };
    let mb: usize = std::env::var("SPIKE_MB")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(32);
    let user = UserId::parse("r2-spike")?;
    let run = ClipId::parse(format!("run{}", std::process::id()))?;
    let small = keys::original(&user, &run, MediaExt::Mp4);
    let big = keys::proxy_720p(&user, &run);
    let thumb = keys::thumb(&user, &run, &SegmentId::parse("s0")?);
    let bytes: Vec<u8> = (0..PART_BYTES + 1024 * 1024)
        .map(|i| (i % 251) as u8)
        .collect();
    spike.multipart(&small, &bytes).await?;
    spike.range(&small).await?;
    spike.disposition(&small).await?;
    spike.cache_control(&thumb).await?;
    let size = mb * 1024 * 1024;
    let big_bytes: Vec<u8> = (0..size).map(|i| (i % 253) as u8).collect();
    spike.multipart(&big, &big_bytes).await?;
    let url = spike.store.presign_get(&big, URL_TTL).await?;
    spike.throughput(&url, size).await?;
    spike.table();
    let keep = std::env::var("SPIKE_KEEP").is_ok_and(|v| v == "1");
    let mut gone = vec![small, thumb];
    if keep {
        println!("\nKept {} for the box (1 h URL):\n{url}", big.as_str());
    } else {
        gone.push(big);
    }
    spike.store.delete(&gone).await?;
    Ok(())
}
