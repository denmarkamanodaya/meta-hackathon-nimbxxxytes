//! Memory Lane's two Spark calls against a fake Meta API: the exact bodies sent (`store: false`,
//! effort, strict schema names, the viewer line, the moments JSON, the labelled face and frame
//! images in order), the parsed answers, the cost log purposes and an invalid answer.

use std::path::PathBuf;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::ClipId;
use nimbytes_core::domain::memory::MomentPerson;
use nimbytes_core::ports::FaceImage;

use super::*;
use crate::meta::fake_api::{Seen, client, fake_api};

const WRITE_PROMPT: &str = include_str!("../../../../../prompts/memory_write.md");
const WRITE_SCHEMA: &str = include_str!("../../../../../prompts/memory_write.schema.json");
const CHECK_PROMPT: &str = include_str!("../../../../../prompts/memory_check.md");
const CHECK_SCHEMA: &str = include_str!("../../../../../prompts/memory_check.schema.json");

fn answer(v: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": v.to_string()}]}], "usage": {"input_tokens": 2000, "output_tokens": 300}})
    .to_string()
}

async fn writer(base: String) -> (SparkMemoryWriter, sqlx::SqlitePool) {
    let (c, pool) = client(base).await;
    let pair = |md: &str, name: &str, schema: &str| {
        (
            Template::parse(md).unwrap(),
            StrictSchema::parse(name, schema).unwrap(),
        )
    };
    let prompts = MemoryPrompts {
        write: pair(WRITE_PROMPT, "memory_write", WRITE_SCHEMA),
        check: pair(CHECK_PROMPT, "memory_check", CHECK_SCHEMA),
    };
    (
        SparkMemoryWriter::new(c, prompts, Duration::from_secs(10)),
        pool,
    )
}

fn moment(index: u32, people: &[&str], line: &str) -> MemoryMoment {
    MemoryMoment {
        index,
        clip_id: ClipId::parse("c1").unwrap(),
        clip_title: "60th Birthday".into(),
        recorded_at: Some("2026-05-01T10:00:00.000Z".into()),
        start_s: 10.0,
        end_s: 20.0,
        on_screen_s: 8.0,
        frame_s: 14.0,
        people: people
            .iter()
            .map(|n| MomentPerson {
                person_id: None,
                name: (*n).into(),
                crop_key: None,
            })
            .collect(),
        description: "Ann opens a present at the table.".into(),
        said: "Happy birthday!".into(),
        frame_key: None,
        line: line.into(),
        prompt: String::new(),
        checked: false,
        fixed_note: None,
    }
}

/// Two JPEG-ish files: a face and a frame, with known bytes.
fn images(dir: &tempfile::TempDir) -> (Vec<FaceImage>, Vec<PathBuf>) {
    let face = dir.path().join("face.jpg");
    let frame = dir.path().join("frame.jpg");
    std::fs::write(&face, b"FACE").unwrap();
    std::fs::write(&frame, b"FRAME").unwrap();
    (
        vec![FaceImage {
            name: "Ann".into(),
            path: face,
        }],
        vec![frame],
    )
}

fn only_body(seen: &std::sync::Mutex<Vec<Seen>>) -> Value {
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].path, "/v1/responses");
    serde_json::from_slice(&seen[0].body).unwrap()
}

async fn purposes(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT purpose FROM model_calls ORDER BY rowid")
        .fetch_all(pool)
        .await
        .unwrap()
}

/// The moments JSON of `moment(0, ["Ann", "Eric"], _)`.
fn sources() -> Value {
    json!({"moments": [{"index": 0, "people_present": ["Ann", "Eric"],
        "date": "2026-05-01T10:00:00.000Z", "event": "60th Birthday",
        "description": "Ann opens a present at the table.", "said": "Happy birthday!"}]})
}

/// The parts after the user text: Ann's face, then the frame of moment 0, each labelled.
fn labelled_images() -> Vec<Value> {
    vec![
        json!({"type": "input_text", "text": "Face of Ann:"}),
        json!({"type": "input_image", "image_url": "data:image/jpeg;base64,RkFDRQ=="}),
        json!({"type": "input_text", "text": "Frame of moment 0:"}),
        json!({"type": "input_image", "image_url": "data:image/jpeg;base64,RlJBTUU="}),
    ]
}

/// The user message's parts: its text, then every image part.
fn user_parts(body: &Value) -> (String, Vec<Value>) {
    let content = body["input"][1]["content"].as_array().unwrap();
    let text = content[0]["text"].as_str().unwrap().to_owned();
    (text, content[1..].to_vec())
}

#[tokio::test]
async fn the_write_call_sends_the_viewer_the_moments_then_each_face_and_frame_labelled() {
    let ok = answer(&json!({"title": "Ann's birthday",
        "moments": [{"index": 0, "line": "Ann opens a present.", "prompt": "What did Ann get?"}]}));
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let (w, pool) = writer(base).await;
    let dir = tempfile::tempdir().unwrap();
    let (faces, frames) = images(&dir);
    let moments = [moment(0, &["Ann", "Eric"], "")];
    let request = MemoryRequest {
        moments: &moments,
        viewer: Some("Eric"),
        faces: &faces,
        frames: &frames,
    };

    let got = w.write(request).await.unwrap();

    assert_eq!(
        (got.title.as_str(), got.moments[0].prompt.as_str()),
        ("Ann's birthday", "What did Ann get?")
    );
    let body = only_body(&seen);
    assert_eq!(
        (&body["store"], &body["reasoning"]["effort"]),
        (&json!(false), &json!("low"))
    );
    assert_eq!(body["text"]["format"]["name"], "memory_write");
    assert_eq!(body["text"]["format"]["strict"], true);
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(
        system.contains("the viewer is always \"you\" or \"your\", never their name"),
        "{system}"
    );
    let (user, images) = user_parts(&body);
    let (head, moments_json) = user.split_once("Moments:\n").unwrap();
    assert_eq!(head, "Viewer: Eric\n\n");
    assert_eq!(
        serde_json::from_str::<Value>(moments_json).unwrap(),
        sources()
    );
    assert_eq!(images, labelled_images());
    assert_eq!(purposes(&pool).await, ["memory_write"]);
}

#[tokio::test]
async fn the_check_call_sends_sources_and_lines_and_says_when_nobody_watches() {
    let ok = answer(&json!({"moments": [{"index": 0, "supported": false,
        "unsupported_claims": ["you"], "line": "Ann opens a present."}]}));
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let (w, pool) = writer(base).await;
    let dir = tempfile::tempdir().unwrap();
    let (faces, frames) = images(&dir);
    let moments = [moment(0, &["Ann", "Eric"], "You open a present.")];
    let request = MemoryRequest {
        moments: &moments,
        viewer: None,
        faces: &faces,
        frames: &frames,
    };

    let got = w.check(request).await.unwrap();

    assert_eq!(
        (got[0].supported, got[0].line.as_str()),
        (false, "Ann opens a present.")
    );
    assert_eq!(got[0].unsupported_claims, ["you"]);
    let body = only_body(&seen);
    assert_eq!(body["text"]["format"]["name"], "memory_check");
    let (user, images) = user_parts(&body);
    let (head, rest) = user.split_once("Sources:\n").unwrap();
    assert_eq!(head, "Viewer: (nobody named)\n\n");
    let (sent, session) = rest.split_once("\n\nSession:\n").unwrap();
    assert_eq!(serde_json::from_str::<Value>(sent).unwrap(), sources());
    assert_eq!(
        session,
        r#"[{"index":0,"line":"You open a present.","prompt":""}]"#
    );
    assert_eq!(images, labelled_images(), "the same images");
    assert_eq!(purposes(&pool).await, ["memory_check"]);
}

#[tokio::test]
async fn an_answer_outside_the_schema_is_model_unavailable() {
    let bad = answer(&json!({"title": "x"}));
    let (base, _seen) = fake_api(vec![(200, bad.as_str())]).await;
    let (w, _pool) = writer(base).await;
    let moments = [moment(0, &["Ann"], "")];
    let request = MemoryRequest {
        moments: &moments,
        viewer: None,
        faces: &[],
        frames: &[],
    };

    let err = w.write(request).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
}
