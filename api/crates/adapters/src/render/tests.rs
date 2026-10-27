//! Renderer wire tests against a local fake renderer.

use nimbytes_core::domain::ids::SegmentId;
use nimbytes_core::domain::render::{PropsClip, Theme};
use nimbytes_core::domain::timeline::{Aspect, Post};
use serde_json::{Value, json};

use super::*;
use crate::meta::fake_api::fake_api;

fn props() -> ShortProps {
    ShortProps {
        aspect: Aspect::Portrait,
        fps: 30,
        clips: vec![PropsClip {
            segment_id: SegmentId::parse("s1").unwrap(),
            src_url: Some("https://signed/p.mp4".into()),
            in_s: 1.0,
            out_s: 3.0,
            punch_in: 1.0,
            subject: None,
            captions: vec![],
        }],
        post: Post {
            caption: "c".into(),
            hashtags: vec![],
        },
        end_card_s: 1.0,
        theme: Theme {
            accent: nimbytes_core::domain::render::VIDEO_ACCENT.into(),
            font: "Inter".into(),
        },
        blur: vec![],
    }
}

fn renderer(base: &str, timeout: Duration) -> RemotionRenderer {
    let timeouts = RenderTimeouts {
        preview: timeout,
        final_render: timeout,
    };
    RemotionRenderer::new(reqwest::Client::new(), base, timeouts)
}

#[tokio::test]
async fn render_posts_props_quality_and_the_upload_url_then_reads_the_result() {
    let (base, seen) = fake_api(vec![(200, r#"{"duration_s":3.0,"bytes":12345}"#)]).await;
    let base = base.trim_end_matches("/v1").to_owned() + "/";
    let r = renderer(&base, Duration::from_secs(5));

    let out = r
        .render(&props(), Quality::Final, "https://put/out.mp4?sig=1")
        .await
        .unwrap();

    assert_eq!(
        out,
        RenderOutput {
            duration_s: 3.0,
            bytes: 12345
        }
    );
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/render");
    assert_eq!(seen[0].content_type, "application/json");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["quality"], "final");
    assert_eq!(body["out_url"], "https://put/out.mp4?sig=1");
    assert_eq!(body["props"], serde_json::to_value(props()).unwrap());
    assert_eq!(body.as_object().unwrap().len(), 3, "{body}");
}

#[tokio::test]
async fn an_error_answer_is_render_failed_with_the_renderer_code_and_message() {
    let reply = json!({"error": {"code": "VALIDATION_FAILED", "message": "clips: too small"}});
    let reply = reply.to_string();
    let (base, _seen) = fake_api(vec![(400, reply.as_str())]).await;
    let r = renderer(base.trim_end_matches("/v1"), Duration::from_secs(5));

    let err = r
        .render(&props(), Quality::Preview, "https://put/x")
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::RenderFailed);
    assert_eq!(
        err.message,
        "renderer answered 400: VALIDATION_FAILED: clips: too small"
    );
}

#[tokio::test]
async fn a_renderer_that_never_answers_times_out_as_render_failed() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let hold = tokio::spawn(async move {
        let (_socket, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    let r = renderer(&format!("http://{addr}"), Duration::from_millis(200));

    let started = std::time::Instant::now();
    let err = r
        .render(&props(), Quality::Preview, "https://put/x")
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::RenderFailed);
    assert!(
        err.message.starts_with("renderer unreachable or too slow"),
        "{}",
        err.message
    );
    assert!(started.elapsed() < Duration::from_secs(5));
    hold.abort();
}
