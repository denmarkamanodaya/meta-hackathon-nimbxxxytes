//! Muse Image wire format, response parsing and cost logging against a local fake API.

use std::time::Duration;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::cover::CoverStyle;
use nimbytes_core::domain::export::ExportAspect;
use nimbytes_core::domain::production::Act;
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::ports::{
    ArtRequest, BoardRequest, CoverRequest, FootageBoardRequest, ImageMaker, RedrawRequest,
};
use serde_json::Value;

use super::*;
use crate::meta::fake_api::{client, fake_api};

const GENERATED: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/image/generation_webp_response.json"
));
const STORYBOARD: &str = include_str!("../../../../../prompts/storyboard.md");
const BRAND_STYLE: &str = include_str!("../../../../../prompts/brand_style.md");
const COVER: &str = include_str!("../../../../../prompts/cover.md");
const COVER_REDRAW: &str = include_str!("../../../../../prompts/cover_redraw.md");
const FOOTAGE_BOARD: &str = include_str!("../../../../../prompts/footage_board.md");
const KEY_ART: &str = include_str!("../../../../../prompts/key_art.md");
const CUTOUT_SCENE: &str = include_str!("../../../../../prompts/cutout_scene.md");
/// Recorded spike responses (their `b64_json` is a placeholder, so only the shape is real).
const MULTI_ANCHOR: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/image/edit_multi_anchor_response.json"
));
const INSTRUCTION: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/image/edit_instruction_response.json"
));
/// The recorded edit shape with a tiny real JPEG.
const EDIT_JPEG: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/image/edit_jpeg_tiny_response.json"
));

async fn maker(base: String) -> (MuseImageMaker, sqlx::SqlitePool) {
    let (client, pool) = client(base).await;
    let prompts = ImagePrompts {
        storyboard: Template::parse(STORYBOARD).unwrap(),
        brand_style: Template::parse(BRAND_STYLE).unwrap(),
        cover: Template::parse(COVER).unwrap(),
        cover_redraw: Template::parse(COVER_REDRAW).unwrap(),
        footage_board: Template::parse(FOOTAGE_BOARD).unwrap(),
        key_art: Template::parse(KEY_ART).unwrap(),
        cutout_scene: Template::parse(CUTOUT_SCENE).unwrap(),
    };
    (
        MuseImageMaker::new(client, prompts, Duration::from_secs(10), 4),
        pool,
    )
}

fn request(dir: &Path, anchors: Vec<std::path::PathBuf>) -> BoardRequest {
    BoardRequest {
        act: Act::Hook,
        title: "Doors open".into(),
        direction: "Walk up and push the glass doors open.".into(),
        aspect: Aspect::Portrait,
        anchors,
        out: dir.join("board.webp"),
    }
}

#[tokio::test]
async fn a_frame_without_anchors_is_generated_as_webp_and_written_to_its_file() {
    let (base, seen) = fake_api(vec![(200, GENERATED)]).await;
    let (maker, _pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let requests = [request(dir.path(), vec![])];

    let results = maker.draw_boards(&requests).await.unwrap();

    assert!(results[0].is_ok(), "{results:?}");
    let written = std::fs::read(dir.path().join("board.webp")).unwrap();
    assert_eq!(&written[..4], b"RIFF");
    assert_eq!(&written[8..12], b"WEBP");
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].path, "/v1/images/generations");
    assert_eq!(seen[0].auth, "Bearer test-key");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["model"], "muse-image-1.0");
    assert_eq!(body["n"], 1);
    assert_eq!(body["size"], "1080x1350");
    assert_eq!(body["output_format"], "webp");
    assert_eq!(body["response_format"], "b64_json");
    assert_eq!(body["reasoning_strength"], "low");
    assert!(body.get("images").is_none(), "a generation has no anchors");
    let prompt = body["prompt"].as_str().unwrap();
    assert!(prompt.starts_with("A storyboard frame for a short first-person video"));
    assert!(
        prompt.ends_with("\n\nAct: hook. Shot: Doors open. Walk up and push the glass doors open."),
        "{prompt}"
    );
}

#[tokio::test]
async fn a_frame_with_anchors_is_an_edit_with_data_urls_by_file_type() {
    let (base, seen) = fake_api(vec![(200, GENERATED)]).await;
    let (maker, _pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let (jpg, png) = (dir.path().join("ref.jpg"), dir.path().join("logo.PNG"));
    std::fs::write(&jpg, b"jpeg-bytes").unwrap();
    std::fs::write(&png, b"png-bytes").unwrap();
    let mut square = request(dir.path(), vec![jpg, png]);
    square.aspect = Aspect::Square;

    let results = maker.draw_boards(&[square]).await.unwrap();

    assert!(results[0].is_ok(), "{results:?}");
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/v1/images/edits");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["size"], "1080x1080");
    assert_eq!(
        body["images"][0]["image_url"],
        "data:image/jpeg;base64,anBlZy1ieXRlcw=="
    );
    assert_eq!(
        body["images"][1]["image_url"],
        "data:image/png;base64,cG5nLWJ5dGVz"
    );
    let prompt = body["prompt"].as_str().unwrap();
    assert!(
        prompt.ends_with("\n\nThe attached images are the owner's brand. Follow their colours and mood only; do not copy them and do not draw the logo unless asked."),
        "{prompt}"
    );
}

#[tokio::test]
async fn each_frame_is_logged_as_one_image_at_the_image_price_and_replayed_from_the_cache() {
    let (base, seen) = fake_api(vec![(200, GENERATED)]).await;
    let (maker, pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let requests = [request(dir.path(), vec![])];

    maker.draw_boards(&requests).await.unwrap();
    maker.draw_boards(&requests).await.unwrap();

    assert_eq!(
        seen.lock().unwrap().len(),
        1,
        "the second frame is a cache hit"
    );
    let rows: Vec<(String, String, Option<i64>, f64, bool)> = sqlx::query_as(
        "SELECT model, purpose, frames, cost_usd, cache_hit FROM model_calls ORDER BY rowid",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        rows,
        [
            (
                "muse-image-1.0".into(),
                "storyboard".into(),
                Some(1),
                0.01,
                false
            ),
            (
                "muse-image-1.0".into(),
                "storyboard".into(),
                None,
                0.0,
                true
            ),
        ]
    );
}

#[tokio::test]
async fn a_failed_frame_is_reported_without_failing_the_batch() {
    let (base, _seen) = fake_api(vec![(400, r#"{"error":"bad prompt"}"#)]).await;
    let (maker, _pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();

    let results = maker
        .draw_boards(&[request(dir.path(), vec![])])
        .await
        .unwrap();

    assert_eq!(
        results[0].as_ref().unwrap_err().code,
        ErrorCode::ModelUnavailable
    );
    assert!(!dir.path().join("board.webp").exists());
}

#[test]
fn the_image_parser_needs_base64_image_data() {
    assert_eq!(&image_bytes(GENERATED).unwrap()[..4], b"RIFF");
    assert_eq!(image_usage(GENERATED), Some(Usage::Images(1)));
    for body in [
        r#"{"data": []}"#,
        r#"{"data": [{"url": "https://x"}]}"#,
        r#"{"data": [{"b64_json": "not base64!"}]}"#,
        r#"{"data": [{"b64_json": ""}]}"#,
        "not json",
    ] {
        assert_eq!(
            image_bytes(body).unwrap_err().code,
            ErrorCode::ModelUnavailable,
            "{body}"
        );
    }
}

#[tokio::test]
async fn a_cover_is_an_edit_of_the_videos_frame_at_the_exports_size_logged_as_a_cover() {
    let (base, seen) = fake_api(vec![(200, GENERATED)]).await;
    let (maker, pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let frame = dir.path().join("cover_frame.jpg");
    std::fs::write(&frame, b"frame").unwrap();
    let cover = CoverRequest {
        platform: nimbytes_core::domain::production::Platform::Tiktok,
        aspect: nimbytes_core::domain::export::ExportAspect::Vertical,
        n: 1,
        style: CoverStyle::CloseDetail,
        caption: "Morning run".into(),
        accent: "#0b6e85".into(),
        has_logo: false,
        anchors: vec![frame],
        out: dir.path().join("cover.webp"),
    };

    let results = maker.draw_covers(&[cover]).await.unwrap();

    assert!(results[0].is_ok(), "{results:?}");
    assert!(dir.path().join("cover.webp").exists());
    assert_eq!(logged_purpose(&pool).await, "cover");
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/v1/images/edits");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["size"], "1080x1920");
    assert_eq!(body["images"].as_array().unwrap().len(), 1);
    let prompt = body["prompt"].as_str().unwrap();
    assert!(
        prompt.starts_with("Design a cover image for a short social video"),
        "{prompt}"
    );
    assert!(
        prompt.ends_with(
            "\n\nCover for tiktok, shape 9:16. Post: Morning run\n\
             Accent colour: #0b6e85. Logo: none.\nStyle: close_detail. Variation 1."
        ),
        "{prompt}"
    );
}

/// The paths written into `dir`, in order, with distinct bytes.
fn files(dir: &Path, names: &[&str]) -> Vec<std::path::PathBuf> {
    names
        .iter()
        .map(|n| {
            let path = dir.join(n);
            std::fs::write(&path, n.as_bytes()).unwrap();
            path
        })
        .collect()
}

fn data(mime: &str, bytes: &str) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{b64}")
}

async fn logged_purpose(pool: &sqlx::SqlitePool) -> String {
    sqlx::query_scalar("SELECT purpose FROM model_calls")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_redraw_anchors_the_cover_then_the_frame_and_puts_the_instruction_last() {
    let (base, seen) = fake_api(vec![(200, EDIT_JPEG)]).await;
    let (maker, pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let request = RedrawRequest {
        aspect: ExportAspect::Vertical,
        instruction: "golden hour light, cosier".into(),
        anchors: files(dir.path(), &["cover_2.webp", "cover_frame.jpg"]),
        out: dir.path().join("redrawn.webp"),
    };

    maker.redraw_cover(&request).await.unwrap();

    assert_eq!(&std::fs::read(&request.out).unwrap()[..2], [0xFF, 0xD8]);
    assert_eq!(logged_purpose(&pool).await, "cover_redraw");
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/v1/images/edits");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["size"], "1080x1920");
    let anchors: Vec<&str> = body["images"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["image_url"].as_str().unwrap())
        .collect();
    assert_eq!(
        anchors,
        [
            data("image/webp", "cover_2.webp"),
            data("image/jpeg", "cover_frame.jpg")
        ]
    );
    let prompt = body["prompt"].as_str().unwrap();
    assert!(prompt.starts_with("Redraw the cover image"), "{prompt}");
    assert!(
        prompt.ends_with("\n\nShape 9:16.\nInstruction: golden hour light, cosier"),
        "{prompt}"
    );
}

#[tokio::test]
async fn a_cutout_scene_is_the_frame_without_its_subject_at_the_cover_size() {
    let (base, seen) = fake_api(vec![(200, EDIT_JPEG)]).await;
    let (maker, pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let request = nimbytes_core::ports::SceneRequest {
        aspect: ExportAspect::Vertical,
        frame: files(dir.path(), &["frame.jpg"]).remove(0),
        out: dir.path().join("scene.webp"),
    };

    maker.draw_scene(&request).await.unwrap();

    assert_eq!(logged_purpose(&pool).await, "cutout_scene");
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/v1/images/edits");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["size"], "1080x1920");
    assert_eq!(
        body["images"],
        serde_json::json!([{"image_url": data("image/jpeg", "frame.jpg")}])
    );
    let prompt = body["prompt"].as_str().unwrap();
    assert!(prompt.contains("without its main subject"), "{prompt}");
    assert!(prompt.ends_with("\n\nShape 9:16."), "{prompt}");
}

#[tokio::test]
async fn a_footage_board_is_the_storyboard_style_anchored_on_the_real_frame() {
    let (base, seen) = fake_api(vec![(200, GENERATED)]).await;
    let (maker, pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let request = FootageBoardRequest {
        act: Act::Payoff,
        title: "Dog naps".into(),
        direction: "Low and close.".into(),
        aspect: Aspect::Square,
        frame: files(dir.path(), &["frame.jpg"]).remove(0),
        take: 0,
        out: dir.path().join("footage.webp"),
    };

    let results = maker.draw_footage_boards(&[request]).await.unwrap();

    assert!(results[0].is_ok(), "{results:?}");
    assert_eq!(logged_purpose(&pool).await, "footage_board");
    let seen = seen.lock().unwrap();
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(seen[0].path, "/v1/images/edits");
    assert_eq!(body["size"], "1080x1080");
    assert_eq!(body["images"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["images"][0]["image_url"],
        data("image/jpeg", "frame.jpg")
    );
    let prompt = body["prompt"].as_str().unwrap();
    let style = Template::parse(STORYBOARD).unwrap().system;
    assert!(
        prompt.starts_with(&format!("{style}\n\nDraw exactly the scene")),
        "{prompt}"
    );
    assert!(
        prompt.ends_with("Act: payoff. Shot: Dog naps. Low and close.\nVariation 0."),
        "{prompt}"
    );
}

#[tokio::test]
async fn key_art_sends_every_frame_in_order_at_its_size_with_no_text() {
    let (base, seen) = fake_api(vec![(200, EDIT_JPEG)]).await;
    let (maker, pool) = maker(base).await;
    let dir = tempfile::tempdir().unwrap();
    let names = ["m1.jpg", "m2.jpg", "m3.jpg", "m4.jpg"];
    let request = ArtRequest {
        shape: "16:9",
        size: "1920x1080",
        theme: "Tokyo".into(),
        accent: "#1ed2dc".into(),
        anchors: files(dir.path(), &names),
        take: 7,
        out: dir.path().join("art.webp"),
    };

    maker.draw_art(&request).await.unwrap();

    assert_eq!(logged_purpose(&pool).await, "key_art");
    let seen = seen.lock().unwrap();
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["size"], "1920x1080");
    let sent: Vec<String> = body["images"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["image_url"].as_str().unwrap().to_owned())
        .collect();
    let want: Vec<String> = names.iter().map(|n| data("image/jpeg", n)).collect();
    assert_eq!(sent, want);
    let prompt = body["prompt"].as_str().unwrap();
    assert!(prompt.contains("Do not write any text"), "{prompt}");
    assert!(
        prompt.ends_with("\n\nShape 16:9. Theme: Tokyo\nAccent colour: #1ed2dc. Variation 7."),
        "{prompt}"
    );
}

#[test]
fn the_recorded_edit_responses_bill_one_image_and_a_real_jpeg_decodes() {
    for recorded in [MULTI_ANCHOR, INSTRUCTION, EDIT_JPEG] {
        assert_eq!(image_usage(recorded), Some(Usage::Images(1)));
    }
    assert_eq!(&image_bytes(EDIT_JPEG).unwrap()[..2], [0xFF, 0xD8]);
    assert_eq!(
        image_bytes(MULTI_ANCHOR).unwrap_err().code,
        ErrorCode::ModelUnavailable,
        "the recorded placeholder is not image data"
    );
}

#[test]
fn every_image_prompt_fills_and_none_lets_the_model_write_text() {
    for (name, md) in [
        ("cover", COVER),
        ("cover_redraw", COVER_REDRAW),
        ("key_art", KEY_ART),
        ("cutout_scene", CUTOUT_SCENE),
    ] {
        let t = Template::parse(md).unwrap();
        assert!(t.system.contains("Do not write any text"), "{name}");
    }
    let cover = Template::parse(COVER).unwrap();
    for style in CoverStyle::PICKABLE {
        assert!(
            cover.system.contains(&format!("- {}:", style.as_str())),
            "cover.md describes {}",
            style.as_str()
        );
    }
}
