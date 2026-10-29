//! The read and answer calls against a fake Meta API: the exact bodies sent (pages as
//! `input_image` parts in page order, `store: false`, strict schema names, no image in an answer),
//! the parsed results, the cost log purposes and invalid answers.

use super::*;
use crate::meta::fake_api::{client, fake_api};

const READ_PROMPT: &str = include_str!("../../../../../prompts/document_read.md");
const READ_SCHEMA: &str = include_str!("../../../../../prompts/document_read.schema.json");
const ANSWER_PROMPT: &str = include_str!("../../../../../prompts/document_answer.md");
const ANSWER_SCHEMA: &str = include_str!("../../../../../prompts/document_answer.schema.json");

fn answer(text: &str) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
           "usage": {"input_tokens": 1000, "output_tokens": 100}})
    .to_string()
}

async fn reader(base: String) -> (SparkDocumentReader, sqlx::SqlitePool) {
    let (c, pool) = client(base).await;
    let prompts = DocumentPrompts {
        read: (
            Template::parse(READ_PROMPT).unwrap(),
            StrictSchema::parse("document_read", READ_SCHEMA).unwrap(),
        ),
        answer: (
            Template::parse(ANSWER_PROMPT).unwrap(),
            StrictSchema::parse("document_answer", ANSWER_SCHEMA).unwrap(),
        ),
    };
    let timeouts = DocumentTimeouts {
        read: Duration::from_secs(10),
        answer: Duration::from_secs(10),
    };
    (SparkDocumentReader::new(c, prompts, timeouts), pool)
}

const BILL: &str = r#"{"title":"Water bill","kind":"bill","sender":"City Water","date":"1 October 2026","text":"Amount due: $142.60","summary":"Pay $142.60 by 14 November 2026."}"#;

async fn purposes(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT purpose FROM model_calls ORDER BY rowid")
        .fetch_all(pool)
        .await
        .unwrap()
}

/// Page files holding `contents`, named `page_1.jpg`, `page_2.jpg`, …
fn page_files(dir: &Path, contents: &[&str]) -> Vec<std::path::PathBuf> {
    contents
        .iter()
        .enumerate()
        .map(|(i, bytes)| {
            let p = dir.join(format!("page_{}.jpg", i + 1));
            std::fs::write(&p, bytes).unwrap();
            p
        })
        .collect()
}

/// The first request's path and JSON body.
fn first_request(seen: &std::sync::Mutex<Vec<crate::meta::fake_api::Seen>>) -> (String, Value) {
    let seen = seen.lock().unwrap();
    (
        seen[0].path.clone(),
        serde_json::from_slice(&seen[0].body).unwrap(),
    )
}

#[tokio::test]
async fn reading_sends_every_page_as_an_input_image_in_order_with_store_false() {
    let ok = answer(BILL);
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let (r, pool) = reader(base).await;
    let dir = tempfile::tempdir().unwrap();
    let pages = page_files(dir.path(), &["AAA", "BBB"]);

    let got = r.read_pages(&ReadRequest { pages }).await.unwrap();

    assert_eq!(got.title, "Water bill");
    assert_eq!(got.kind, nimbytes_core::domain::document::DocKind::Bill);
    assert_eq!(got.summary, "Pay $142.60 by 14 November 2026.");
    let (path, body) = first_request(&seen);
    assert_eq!(path, "/v1/responses");
    assert_eq!(
        (&body["model"], &body["store"]),
        (&json!("muse-spark-1.3"), &json!(false))
    );
    assert_eq!(body["reasoning"]["effort"], "low");
    assert_eq!(body["text"]["format"]["name"], "document_read");
    assert_eq!(body["text"]["format"]["strict"], true);
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(system.starts_with("You read documents"));
    let content = body["input"][1]["content"].as_array().unwrap();
    let image = |b64: &str| json!({"type": "input_image", "image_url": format!("data:image/jpeg;base64,{b64}")});
    assert_eq!(
        content.as_slice(),
        [
            json!({"type": "input_text", "text": "2 page(s):"}),
            image("QUFB"),
            image("QkJC")
        ]
    );
    assert_eq!(purposes(&pool).await, ["document_read"]);
}

#[tokio::test]
async fn an_unknown_kind_reads_as_other_and_a_bad_answer_is_model_unavailable() {
    let odd = answer(&BILL.replace("\"bill\"", "\"receipt\""));
    let (base, _seen) = fake_api(vec![(200, odd.as_str())]).await;
    let (r, _pool) = reader(base).await;
    let dir = tempfile::tempdir().unwrap();
    let page = dir.path().join("page_1.jpg");
    std::fs::write(&page, b"A").unwrap();
    let request = ReadRequest { pages: vec![page] };

    let err = r.read_pages(&request).await.unwrap_err();

    assert_eq!(
        err.code,
        ErrorCode::ModelUnavailable,
        "the schema's enum refuses it"
    );
}

#[tokio::test]
async fn answering_sends_only_the_text_and_question_and_returns_the_trimmed_answer() {
    let ok = answer(r#"{"answer":"  You owe $142.60.  "}"#);
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let (r, pool) = reader(base).await;
    let request = AnswerRequest {
        text: "Amount due: $142.60",
        question: "How much do I owe?",
    };

    assert_eq!(r.answer(request).await.unwrap(), "You owe $142.60.");

    let (_, body) = first_request(&seen);
    assert_eq!(body["store"], false);
    assert_eq!(body["text"]["format"]["name"], "document_answer");
    assert_eq!(body["text"]["format"]["strict"], true);
    let content = body["input"][1]["content"].as_array().unwrap();
    assert_eq!(content.len(), 1, "text only, no images");
    assert_eq!(
        content[0]["text"],
        "Document text:\nAmount due: $142.60\n\nQuestion: How much do I owe?"
    );
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(system.contains("at most 60 words") && system.contains("someone they trust"));
    assert_eq!(purposes(&pool).await, ["document_answer"]);
}

#[tokio::test]
async fn an_empty_answer_is_model_unavailable() {
    let empty = answer(r#"{"answer":"  "}"#);
    let (base, _seen) = fake_api(vec![(200, empty.as_str())]).await;
    let (r, _pool) = reader(base).await;
    let request = AnswerRequest {
        text: "x",
        question: "y",
    };
    let err = r.answer(request).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelUnavailable);
}
