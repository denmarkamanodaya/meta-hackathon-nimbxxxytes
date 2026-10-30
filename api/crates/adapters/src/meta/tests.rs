//! MetaClient and MetaTranscriber against a local fake API (axum on 127.0.0.1, no network).

use std::time::Duration;

use nimbytes_core::ports::Transcriber;

use super::fake_api::{client, fake_api};
use super::*;

const TRANSCRIBE_OK: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/transcribe/diarization_en.json"
));

async fn transcriber(base_url: String) -> (MetaTranscriber, sqlx::SqlitePool, tempfile::TempDir) {
    let (client, pool) = client(base_url).await;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("audio.wav"), b"RIFFfake-wav-bytes").unwrap();
    (
        MetaTranscriber::new(client, Duration::from_secs(5)),
        pool,
        dir,
    )
}

async fn calls(pool: &sqlx::SqlitePool) -> Vec<(String, Option<f64>, f64, bool, String)> {
    sqlx::query_as(
        "SELECT purpose, audio_s, cost_usd, cache_hit, status FROM model_calls ORDER BY rowid",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn transcribe_sends_the_request_json_and_wav_parts_and_maps_turns() {
    let (base, seen) = fake_api(vec![(200, TRANSCRIBE_OK)]).await;
    let (t, pool, dir) = transcriber(base).await;

    let turns = t.transcribe(&dir.path().join("audio.wav")).await.unwrap();

    assert_eq!(turns, [RawTurnFixture::with_food()]);
    let req = seen.lock().unwrap()[0].clone();
    assert_eq!(req.path, "/v1/asr/transcribe");
    assert_eq!(req.auth, "Bearer test-key");
    assert!(
        req.content_type
            .starts_with("multipart/form-data; boundary="),
        "{}",
        req.content_type
    );
    let body = String::from_utf8_lossy(&req.body);
    // Key order inside the JSON part is not part of the contract; compare it parsed.
    let head = "Content-Disposition: form-data; name=\"request\"\r\nContent-Type: application/json\r\n\r\n";
    let start = body
        .find(head)
        .expect("request part with JSON content type")
        + head.len();
    let json = &body[start..start + body[start..].find("\r\n--").unwrap()];
    assert_eq!(
        serde_json::from_str::<Value>(json).unwrap(),
        serde_json::json!({"mode": "DIARIZATION", "model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV"})
    );
    assert!(body.contains(
        "Content-Disposition: form-data; name=\"audio\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFFfake-wav-bytes"
    ), "{body}");
    let rows = calls(&pool).await;
    assert_eq!(rows.len(), 1);
    let (purpose, audio_s, cost, hit, status) = &rows[0];
    assert_eq!(
        (purpose.as_str(), *audio_s, *hit, status.as_str()),
        ("transcribe", Some(21.52), false, "ok")
    );
    assert!((cost - 0.18 * 21.52 / 3600.0).abs() < 1e-12, "{cost}");
}

#[tokio::test]
async fn a_second_identical_call_is_a_cache_hit_without_a_request() {
    let (base, seen) = fake_api(vec![(200, TRANSCRIBE_OK)]).await;
    let (t, pool, dir) = transcriber(base).await;
    let wav = dir.path().join("audio.wav");

    let first = t.transcribe(&wav).await.unwrap();
    let second = t.transcribe(&wav).await.unwrap();

    assert_eq!(first, second);
    assert_eq!(seen.lock().unwrap().len(), 1);
    let rows = calls(&pool).await;
    assert_eq!((rows[1].2, rows[1].3), (0.0, true), "hit costs nothing");
}

#[tokio::test]
async fn a_429_is_retried_and_then_succeeds() {
    let (base, seen) = fake_api(vec![(429, "slow down"), (200, TRANSCRIBE_OK)]).await;
    let (t, pool, dir) = transcriber(base).await;

    t.transcribe(&dir.path().join("audio.wav")).await.unwrap();

    assert_eq!(seen.lock().unwrap().len(), 2);
    assert_eq!(calls(&pool).await.len(), 1, "one logical call, one row");
}

#[tokio::test]
async fn persistent_5xx_gives_up_after_three_attempts_and_logs_an_error_row() {
    let (base, seen) = fake_api(vec![(503, "down")]).await;
    let (t, pool, dir) = transcriber(base).await;

    let err = t
        .transcribe(&dir.path().join("audio.wav"))
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert_eq!(seen.lock().unwrap().len(), 3);
    let rows = calls(&pool).await;
    assert_eq!((rows[0].2, rows[0].4.as_str()), (0.0, "error"));
}

#[tokio::test]
async fn a_400_is_not_retried() {
    let (base, seen) = fake_api(vec![(400, "bad audio")]).await;
    let (t, _pool, dir) = transcriber(base).await;

    let err = t
        .transcribe(&dir.path().join("audio.wav"))
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(err.message.contains("HTTP 400"), "{}", err.message);
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[test]
fn fingerprint_changes_with_any_input_byte_and_part_boundary() {
    let a = fingerprint("m", "p", &[b"ab", b"c"]);
    assert_ne!(a, fingerprint("m", "p", &[b"a", b"bc"]));
    assert_ne!(a, fingerprint("m", "q", &[b"ab", b"c"]));
    assert_eq!(a, fingerprint("m", "p", &[b"ab", b"c"]));
    assert_eq!(a.len(), 64);
}

struct RawTurnFixture;

impl RawTurnFixture {
    fn with_food() -> nimbytes_core::domain::transcript::RawTurn {
        nimbytes_core::domain::transcript::RawTurn {
            start_ms: 5_820,
            end_ms: 13_980,
            text: "with food.".into(),
            speaker: Some("A".into()),
        }
    }
}

#[tokio::test]
async fn transcribe_all_sends_every_file_and_answers_in_order() {
    let w0 = r#"{"turns":[{"startMs":0,"endMs":900,"transcript":"one","speaker":"A"}]}"#;
    let (base, seen) = fake_api(vec![(200, w0)]).await;
    let (client, _pool) = client(base).await;
    let t = MetaTranscriber::new(client, Duration::from_secs(5)).with_concurrency(4);
    let dir = tempfile::tempdir().unwrap();
    let files: Vec<std::path::PathBuf> = (0..6)
        .map(|i| {
            let p = dir.path().join(format!("win_{i}.wav"));
            std::fs::write(&p, format!("RIFF{i}")).unwrap();
            p
        })
        .collect();

    let heard = t.transcribe_all(&files).await.unwrap();

    assert_eq!(heard.len(), 6);
    assert!(heard.iter().all(|turns| turns[0].text == "one"));
    let seen = seen.lock().unwrap();
    assert_eq!(
        seen.len(),
        6,
        "one call per file (each body differs, so none is cached)"
    );
    assert!(seen.iter().all(|s| s.path == "/v1/asr/transcribe"));
}
