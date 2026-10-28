//! Wire tests of the renderer's mask work (`/mask/path`, `/cutout`) against a local fake.

use nimbytes_core::domain::render::FrameSize;
use nimbytes_core::domain::sam::MaskEncoding;

use super::*;
use crate::meta::fake_api::fake_api;

fn renderer(base: &str) -> RemotionRenderer {
    let timeouts = RenderTimeouts {
        preview: Duration::from_secs(5),
        final_render: Duration::from_secs(5),
    };
    RemotionRenderer::new(
        reqwest::Client::new(),
        base.trim_end_matches("/v1"),
        timeouts,
    )
}

fn plate_mask() -> MaskRef {
    MaskRef {
        encoding: MaskEncoding::OneBit,
        width: 35,
        height: 18,
        payload: "!!!!!:NVKTgTw0#:v2`&Ng[j+4iM%hZK.m#".into(),
    }
}

const PLATE_BOX: BoxRect = BoxRect {
    x1: 50,
    y1: 329,
    x2: 84,
    y2: 346,
};

#[tokio::test]
async fn a_mask_path_posts_the_mask_and_its_box_and_reads_the_path() {
    let (base, seen) = fake_api(vec![(200, r#"{"path":"M50 329L84 329Z"}"#)]).await;

    let path = renderer(&base)
        .mask_path(&plate_mask(), PLATE_BOX)
        .await
        .unwrap();

    assert_eq!(path, "M50 329L84 329Z");
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/mask/path");
    assert_eq!(
        String::from_utf8(seen[0].body.clone()).unwrap(),
        r##"{"mask":{"encoding":"one_bit","width":35,"height":18,"payload":"!!!!!:NVKTgTw0#:v2`&Ng[j+4iM%hZK.m#"},"box":{"x1":50,"y1":329,"x2":84,"y2":346}}"##
    );
}

#[tokio::test]
async fn a_bad_mask_or_an_answer_without_a_path_is_render_failed() {
    let reply = r#"{"error":{"code":"VALIDATION_FAILED","message":"bad mask"}}"#;
    let (base, _seen) = fake_api(vec![(400, reply)]).await;
    let err = renderer(&base)
        .mask_path(&plate_mask(), PLATE_BOX)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::RenderFailed);
    assert!(err.message.contains("bad mask"), "{}", err.message);

    let (base, _seen) = fake_api(vec![(200, "{}")]).await;
    let err = renderer(&base)
        .mask_path(&plate_mask(), PLATE_BOX)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::RenderFailed);
}

#[tokio::test]
async fn a_cutout_posts_the_frame_mask_box_sticker_and_upload_url() {
    let (base, seen) = fake_api(vec![(200, "{}")]).await;
    let request = CutoutRequest {
        image_url: "https://signed/frame.jpg".into(),
        frame: FrameSize { w: 480, h: 640 },
        mask: plate_mask(),
        bbox: PLATE_BOX,
        sticker: true,
    };

    renderer(&base)
        .cutout(&request, "https://put/sticker.png?sig=1")
        .await
        .unwrap();

    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/cutout");
    assert_eq!(
        String::from_utf8(seen[0].body.clone()).unwrap(),
        r##"{"image_url":"https://signed/frame.jpg","frame":{"w":480,"h":640},"mask":{"encoding":"one_bit","width":35,"height":18,"payload":"!!!!!:NVKTgTw0#:v2`&Ng[j+4iM%hZK.m#"},"box":{"x1":50,"y1":329,"x2":84,"y2":346},"sticker":true,"out_url":"https://put/sticker.png?sig=1"}"##
    );
}
