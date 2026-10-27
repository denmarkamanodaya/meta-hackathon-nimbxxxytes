//! A local fake of the Meta API for adapter tests, and a client wired to it.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use axum::http::{HeaderMap, StatusCode, Uri};
use nimbytes_core::domain::cost::{AudioPrices, FramePrices, ImagePrices, Prices, TokenPrices};
use nimbytes_testkit::{FixedClock, SequentialIds};

use super::{MetaClient, MetaConfig, MetaDeps};
use crate::sqlite::{SqliteModelLedger, test_pool};

#[derive(Debug, Clone)]
pub struct Seen {
    pub path: String,
    pub auth: String,
    pub content_type: String,
    pub body: Vec<u8>,
}

/// Serves `replies` in order (the last one repeats) and records every request.
pub async fn fake_api(replies: Vec<(u16, &str)>) -> (String, Arc<Mutex<Vec<Seen>>>) {
    let replies: Vec<(u16, String)> = replies
        .into_iter()
        .map(|(s, t)| (s, t.to_owned()))
        .collect();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let handler = move |uri: Uri, headers: HeaderMap, body: Bytes| {
        let log = log.clone();
        let replies = replies.clone();
        async move {
            let header = |n: &str| {
                headers
                    .get(n)
                    .map(|v| v.to_str().unwrap().to_owned())
                    .unwrap_or_default()
            };
            let mut log = log.lock().unwrap();
            log.push(Seen {
                path: uri.path().into(),
                auth: header("authorization"),
                content_type: header("content-type"),
                body: body.to_vec(),
            });
            let (status, text) = replies[(log.len() - 1).min(replies.len() - 1)].clone();
            (StatusCode::from_u16(status).unwrap(), text)
        }
    };
    let app = axum::Router::new().fallback(handler);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/v1"), seen)
}

pub fn prices() -> Prices {
    Prices {
        spark: TokenPrices {
            input_per_m: 1.25,
            output_per_m: 4.25,
            cached_input_per_m: 0.15,
        },
        sam: FramePrices {
            per_1000_frames: 0.20,
            min_frames: 50,
        },
        transcribe: AudioPrices { per_hour: 0.18 },
        image: ImagePrices { per_image: 0.01 },
    }
}

/// A client against `base_url` with a fresh in-memory ledger.
pub async fn client(base_url: String) -> (MetaClient, sqlx::SqlitePool) {
    let pool = test_pool().await;
    let deps = MetaDeps {
        ledger: Arc::new(SqliteModelLedger::new(pool.clone())),
        clock: Arc::new(FixedClock::at(0)),
        ids: Arc::new(SequentialIds::new("call")),
    };
    let config = MetaConfig {
        base_url,
        api_key: "test-key".into(),
        max_retries: 2,
        base_backoff: Duration::from_millis(1),
    };
    (
        MetaClient::new(reqwest::Client::new(), config, prices(), deps),
        pool,
    )
}
