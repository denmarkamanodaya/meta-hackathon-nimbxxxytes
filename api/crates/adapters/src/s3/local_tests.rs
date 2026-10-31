//! Wire tests of the local mode: calls leave for the internal host, presigned URLs name the public
//! host on the bucket path, and the origin check.

use aws_sdk_s3::config::{BehaviorVersion, Credentials};
use aws_sdk_s3::primitives::SdkBody;
use aws_smithy_http_client::test_util::{CaptureRequestReceiver, capture_request};
use nimbytes_core::domain::ids::{ClipId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::keys;
use nimbytes_testkit::FixedClock;

use super::*;

const BUCKET: &str = "nimbytes-media";
const INTERNAL: &str = "http://storage:8333";
const PUBLIC: &str = "http://localhost";

fn original() -> ObjectKey {
    keys::original(
        &UserId::parse("u1").unwrap(),
        &ClipId::parse("c1").unwrap(),
        MediaExt::Mp4,
    )
}

fn client(
    endpoint: &str,
    http_client: aws_smithy_http_client::test_util::CaptureRequestHandler,
) -> Client {
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .credentials_provider(Credentials::new(
            "nimbytes",
            "local-secret",
            None,
            None,
            "test",
        ))
        .http_client(http_client);
    Client::from_conf(local::configure(config, endpoint).build())
}

/// A local-mode store, built as the composition root builds it, whose one HTTP call is captured.
fn local_store(body: &'static str) -> (S3BlobStore, CaptureRequestReceiver) {
    let response = http::Response::builder()
        .status(200)
        .body(SdkBody::from(body))
        .unwrap();
    let (http_client, rx) = capture_request(Some(response));
    let (signer_http, _) = capture_request(None);
    let clock = Arc::new(FixedClock::at(1_793_071_200_000));
    let store = S3BlobStore::new(
        client(INTERNAL, http_client),
        BUCKET,
        Duration::from_secs(900),
        clock,
    )
    .presigning_with(client(PUBLIC, signer_http));
    (store, rx)
}

#[tokio::test]
async fn local_calls_go_path_style_to_the_internal_host_with_tags() {
    let (store, rx) = local_store(
        "<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key>\
         <UploadId>up-9</UploadId></InitiateMultipartUploadResult>",
    );

    store
        .create_multipart(&original(), "video/mp4", ObjectClass::Original)
        .await
        .unwrap();

    let req = rx.expect_request();
    assert!(
        req.uri().starts_with(&format!(
            "{INTERNAL}/{BUCKET}/users/u1/originals/c1.mp4?uploads"
        )),
        "{}",
        req.uri()
    );
    assert!(
        req.headers().get("x-amz-tagging").is_some(),
        "the local store keeps tags"
    );
}

#[tokio::test]
async fn local_presigned_urls_name_the_public_host_and_never_the_internal_one() {
    let (store, _rx) = local_store("");

    let get = store
        .presign_get(&original(), Duration::from_secs(3600))
        .await
        .unwrap();
    let put = store
        .presign_put(&original(), Duration::from_secs(3600))
        .await
        .unwrap();
    let part = store
        .presign_upload_part(&original(), "up-9", 2)
        .await
        .unwrap();
    let download = store
        .presign_download(&original(), Duration::from_secs(3600), "a.mp4")
        .await
        .unwrap();

    for url in [&get, &put, &part, &download] {
        assert!(
            url.starts_with(&format!("{PUBLIC}/{BUCKET}/users/u1/originals/c1.mp4?")),
            "{url}"
        );
        assert!(url.contains("%2Fus-east-1%2Fs3%2Faws4_request"), "{url}");
        assert!(!url.contains("storage:8333"), "{url}");
    }
}

#[test]
fn an_origin_has_a_scheme_a_host_and_no_path() {
    assert_eq!(
        local::origin("X", " http://storage:8333/ ").unwrap(),
        INTERNAL
    );
    assert_eq!(
        local::origin("X", "https://localhost").unwrap(),
        "https://localhost"
    );
    for bad in [
        "storage:8333",
        "http://",
        "http://localhost/media",
        "ftp://h",
    ] {
        assert_eq!(
            local::origin("LOCAL_S3_PUBLIC_URL", bad)
                .unwrap_err()
                .message,
            "env LOCAL_S3_PUBLIC_URL must be an http:// or https:// origin with no path",
            "{bad}"
        );
    }
}
