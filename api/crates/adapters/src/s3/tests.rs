//! Wire tests: each S3 call is captured before it leaves the process and its exact request is
//! asserted; responses are canned S3 XML.

use aws_sdk_s3::config::{BehaviorVersion, Credentials, Region};
use aws_sdk_s3::primitives::SdkBody;
use aws_smithy_http_client::test_util::{CaptureRequestReceiver, capture_request};
use nimbytes_core::domain::ids::{ClipId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::keys;
use nimbytes_testkit::FixedClock;

use super::*;

const BUCKET: &str = "nimbytes-media-test";
/// 2026-10-27T03:20:00Z.
const AT_0320: i64 = 1_793_071_200_000;

fn key() -> ObjectKey {
    keys::original(
        &UserId::parse("u1").unwrap(),
        &ClipId::parse("c1").unwrap(),
        MediaExt::Mp4,
    )
}

/// A store whose single HTTP call is captured and answered with `status` + `body`.
fn store(status: u16, body: &'static str) -> (S3BlobStore, CaptureRequestReceiver) {
    let response = http::Response::builder()
        .status(status)
        .body(SdkBody::from(body))
        .unwrap();
    let (http_client, rx) = capture_request(Some(response));
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("ap-southeast-1"))
        .credentials_provider(Credentials::new("AKIDTEST", "secret", None, None, "test"))
        .http_client(http_client);
    let client = Client::from_conf(configure(config).build());
    let clock = Arc::new(FixedClock::at(AT_0320));
    (
        S3BlobStore::new(client, BUCKET, Duration::from_secs(900), clock),
        rx,
    )
}

#[tokio::test]
async fn create_multipart_sends_the_lifecycle_tag_and_content_type() {
    let (store, rx) = store(
        200,
        "<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key>\
         <UploadId>up-123</UploadId></InitiateMultipartUploadResult>",
    );

    let id = store
        .create_multipart(&key(), "video/mp4", ObjectClass::Original)
        .await
        .unwrap();

    assert_eq!(id, "up-123");
    let req = rx.expect_request();
    assert_eq!(req.method(), "POST");
    assert!(
        req.uri().contains("/users/u1/originals/c1.mp4?uploads"),
        "{}",
        req.uri()
    );
    assert_eq!(
        req.headers().get("x-amz-tagging"),
        Some("nimbytes-class=original")
    );
    assert_eq!(req.headers().get("content-type"), Some("video/mp4"));
}

#[tokio::test]
async fn presigned_part_url_has_part_upload_id_expiry_and_no_checksum_to_send() {
    let (store, _rx) = store(200, "");

    let url = store
        .presign_upload_part(&key(), "up-123", 3)
        .await
        .unwrap();

    assert!(url.starts_with("https://nimbytes-media-test.s3.ap-southeast-1.amazonaws.com/"));
    assert!(url.contains("/users/u1/originals/c1.mp4?"), "{url}");
    for part in [
        "partNumber=3",
        "uploadId=up-123",
        "X-Amz-Expires=900",
        "X-Amz-Signature=",
    ] {
        assert!(url.contains(part), "{part} missing from {url}");
    }
    assert!(!url.to_ascii_lowercase().contains("checksum"), "{url}");
    assert!(
        url.contains("X-Amz-SignedHeaders=host&"),
        "only host may be signed: {url}"
    );
}

#[tokio::test]
async fn complete_sends_every_part_with_its_etag_in_order() {
    let (store, rx) = store(
        200,
        "<CompleteMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><ETag>\"x-2\"</ETag>\
         </CompleteMultipartUploadResult>",
    );
    let parts = [
        CompletedPart {
            n: 1,
            etag: "\"e1\"".into(),
        },
        CompletedPart {
            n: 2,
            etag: "\"e2\"".into(),
        },
    ];

    store
        .complete_multipart(&key(), "up-123", &parts)
        .await
        .unwrap();

    let req = rx.expect_request();
    assert_eq!(req.method(), "POST");
    assert!(req.uri().contains("uploadId=up-123"), "{}", req.uri());
    let body = std::str::from_utf8(req.body().bytes().unwrap()).unwrap();
    let first = body.find("<ETag>&quot;e1&quot;</ETag><PartNumber>1</PartNumber>");
    let second = body.find("<ETag>&quot;e2&quot;</ETag><PartNumber>2</PartNumber>");
    assert!(
        first.is_some() && second.is_some() && first < second,
        "{body}"
    );
}

#[tokio::test]
async fn complete_with_a_bad_part_is_upload_incomplete() {
    let (store, _rx) = store(
        400,
        "<Error><Code>InvalidPart</Code><Message>One or more parts not found</Message></Error>",
    );
    let parts = [CompletedPart {
        n: 1,
        etag: "\"e1\"".into(),
    }];

    let err = store
        .complete_multipart(&key(), "up-123", &parts)
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::UploadIncomplete);
}

#[tokio::test]
async fn object_size_reads_content_length_from_head() {
    let response = http::Response::builder()
        .status(200)
        .header("content-length", "20971520")
        .body(SdkBody::empty())
        .unwrap();
    let (http_client, rx) = capture_request(Some(response));
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("ap-southeast-1"))
        .credentials_provider(Credentials::new("AKIDTEST", "secret", None, None, "test"))
        .http_client(http_client);
    let store = S3BlobStore::new(
        Client::from_conf(configure(config).build()),
        BUCKET,
        Duration::from_secs(900),
        Arc::new(FixedClock::at(AT_0320)),
    );

    assert_eq!(store.object_size(&key()).await.unwrap(), 20_971_520);
    assert_eq!(rx.expect_request().method(), "HEAD");
}

#[tokio::test]
async fn object_size_of_a_missing_object_is_not_found() {
    let (store, _rx) = store(404, "");
    assert_eq!(
        store.object_size(&key()).await.unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn presigned_get_signs_only_host_for_the_ttl() {
    let (store, _rx) = store(200, "");
    let url = store
        .presign_get(&key(), Duration::from_secs(3600))
        .await
        .unwrap();
    assert!(
        url.starts_with(
            "https://nimbytes-media-test.s3.ap-southeast-1.amazonaws.com/users/u1/originals/c1.mp4?"
        ),
        "{url}"
    );
    assert!(
        url.contains("X-Amz-Expires=7200") && url.contains("X-Amz-SignedHeaders=host&"),
        "{url}"
    );
}

/// A store whose GET URLs are signed at `clock`'s time.
fn store_at(clock: Arc<FixedClock>) -> S3BlobStore {
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .region(Region::new("ap-southeast-1"))
        .credentials_provider(Credentials::new("AKIDTEST", "secret", None, None, "test"));
    let client = Client::from_conf(configure(config).build());
    S3BlobStore::new(client, BUCKET, Duration::from_secs(900), clock)
}

#[tokio::test]
async fn get_urls_are_identical_within_an_hour_and_change_with_the_next_one() {
    let clock = Arc::new(FixedClock::at(AT_0320));
    let store = store_at(clock.clone());
    let ttl = Duration::from_secs(3600);
    let first = store.presign_get(&key(), ttl).await.unwrap();
    clock.advance(39 * 60 * 1000); // 03:59
    let same_hour = store.presign_get(&key(), ttl).await.unwrap();
    clock.advance(2 * 60 * 1000); // 04:01
    let next_hour = store.presign_get(&key(), ttl).await.unwrap();

    assert_eq!(
        first, same_hour,
        "byte-identical, so the browser cache hits"
    );
    assert!(first.contains("X-Amz-Date=20261027T030000Z"), "{first}");
    assert!(
        first.contains("X-Amz-Expires=7200"),
        "valid until 05:00, at least 1 h left"
    );
    assert_ne!(first, next_hour);
    assert!(
        next_hour.contains("X-Amz-Date=20261027T040000Z"),
        "{next_hour}"
    );
}

#[tokio::test]
async fn put_file_stores_the_cache_control_it_is_given() {
    let (store, rx) = store(200, "");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("thumb.jpg");
    std::fs::write(&path, b"jpg").unwrap();
    let put = PutFile {
        key: &key(),
        path: &path,
        content_type: "image/jpeg",
        class: None,
        cache_control: Some(keys::DERIVED_CACHE_CONTROL),
    };

    store.put_file(put).await.unwrap();

    let req = rx.expect_request();
    assert_eq!(req.method(), "PUT");
    assert_eq!(
        req.headers().get("cache-control"),
        Some("private, max-age=31536000, immutable")
    );
    assert_eq!(req.headers().get("content-type"), Some("image/jpeg"));
}

#[tokio::test]
async fn presigned_put_signs_only_host_so_the_renderer_may_send_its_content_type() {
    let (store, _rx) = store(200, "");
    let url = store
        .presign_put(&key(), Duration::from_secs(3600))
        .await
        .unwrap();
    assert!(url.contains("/users/u1/originals/c1.mp4?"), "{url}");
    assert!(
        url.contains("X-Amz-Expires=3600") && url.contains("X-Amz-SignedHeaders=host&"),
        "{url}"
    );
    assert!(!url.contains("x-amz-checksum"), "{url}");
}

#[tokio::test]
async fn tag_sets_the_lifecycle_class_on_the_object() {
    let (store, rx) = store(200, "");

    store.tag(&key(), ObjectClass::Preview).await.unwrap();

    let req = rx.expect_request();
    assert_eq!(req.method(), "PUT");
    assert!(
        req.uri().contains("/users/u1/originals/c1.mp4?tagging"),
        "{}",
        req.uri()
    );
    let body = std::str::from_utf8(req.body().bytes().unwrap()).unwrap();
    assert!(
        body.contains("<Tag><Key>nimbytes-class</Key><Value>preview</Value></Tag>"),
        "{body}"
    );
}

#[tokio::test]
async fn download_url_asks_browsers_to_save_the_file_under_a_safe_name() {
    let (store, _rx) = store(200, "");
    let url = store
        .presign_download(
            &key(),
            Duration::from_secs(600),
            "nimbytes-short-v2.mp4\"; x",
        )
        .await
        .unwrap();
    assert!(
        url.contains(
            "response-content-disposition=attachment%3B%20filename%3D%22nimbytes-short-v2.mp4x%22"
        ),
        "{url}"
    );
    assert!(url.contains("X-Amz-SignedHeaders=host&"), "{url}");
}
