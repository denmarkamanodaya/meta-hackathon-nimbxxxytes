//! Wire tests of the R2 mode: the request leaves for the account endpoint, path-style, and never
//! carries an object tag. The S3 mode's own wire tests stay in `tests.rs`.

use aws_sdk_s3::config::{BehaviorVersion, Credentials};
use aws_sdk_s3::primitives::SdkBody;
use aws_smithy_http_client::test_util::{
    CaptureRequestReceiver, ReplayEvent, StaticReplayClient, capture_request,
};
use nimbytes_core::domain::ids::{ClipId, ShortId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::keys;
use nimbytes_testkit::FixedClock;

use super::*;

const ACCOUNT: &str = "0123456789abcdef0123456789abcdef";
const BUCKET: &str = "nimbytes-media";
const HOST: &str = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";

fn original() -> ObjectKey {
    keys::original(
        &UserId::parse("u1").unwrap(),
        &ClipId::parse("c1").unwrap(),
        MediaExt::Mp4,
    )
}

/// An R2-mode store, built as the composition root builds it, whose one HTTP call is captured.
fn r2_store(body: &'static str) -> (S3BlobStore, CaptureRequestReceiver) {
    let response = http::Response::builder()
        .status(200)
        .body(SdkBody::from(body))
        .unwrap();
    let (http_client, rx) = capture_request(Some(response));
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .credentials_provider(Credentials::new("R2KEY", "secret", None, None, "test"))
        .http_client(http_client);
    let endpoint = r2::endpoint(ACCOUNT).unwrap();
    let client = Client::from_conf(r2::configure(config, &endpoint).build());
    let clock = Arc::new(FixedClock::at(1_793_071_200_000));
    let store = S3BlobStore::new(client, BUCKET, Duration::from_secs(900), clock);
    (store.without_object_tags(), rx)
}

#[tokio::test]
async fn r2_create_multipart_goes_path_style_to_the_account_and_sends_no_tag() {
    let (store, rx) = r2_store(
        "<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key>\
         <UploadId>up-9</UploadId></InitiateMultipartUploadResult>",
    );

    let id = store
        .create_multipart(&original(), "video/mp4", ObjectClass::Original)
        .await
        .unwrap();

    assert_eq!(id, "up-9");
    let req = rx.expect_request();
    assert_eq!(req.method(), "POST");
    assert_eq!(
        req.uri(),
        format!("{HOST}/{BUCKET}/users/u1/originals/c1.mp4?uploads")
    );
    assert_eq!(req.headers().get("x-amz-tagging"), None);
    assert_eq!(req.headers().get("content-type"), Some("video/mp4"));
    let auth = req.headers().get("authorization").unwrap();
    assert!(auth.contains("/auto/s3/aws4_request"), "{auth}");
}

#[tokio::test]
async fn r2_put_file_drops_the_class_tag_and_keeps_cache_control() {
    let (store, rx) = r2_store("");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("v1.mp4");
    std::fs::write(&path, b"mp4").unwrap();
    let preview = keys::preview(
        &UserId::parse("u1").unwrap(),
        &ShortId::parse("x1").unwrap(),
        1,
    );
    let put = PutFile {
        key: &preview,
        path: &path,
        content_type: "video/mp4",
        class: Some(ObjectClass::Preview),
        cache_control: Some(keys::DERIVED_CACHE_CONTROL),
    };

    store.put_file(put).await.unwrap();

    let req = rx.expect_request();
    assert_eq!(req.method(), "PUT");
    assert_eq!(
        req.uri(),
        format!("{HOST}/{BUCKET}/users/u1/previews/x1/v1.mp4?x-id=PutObject")
    );
    assert_eq!(req.headers().get("x-amz-tagging"), None);
    assert_eq!(
        req.headers().get("cache-control"),
        Some("private, max-age=31536000, immutable")
    );
}

#[tokio::test]
async fn r2_tag_sends_no_request_at_all() {
    let (store, rx) = r2_store("");

    store.tag(&original(), ObjectClass::Preview).await.unwrap();

    rx.expect_no_request();
}

#[tokio::test]
async fn r2_presigned_urls_point_at_the_bucket_path_on_the_account_endpoint() {
    let (store, _rx) = r2_store("");

    let get = store
        .presign_get(&original(), Duration::from_secs(3600))
        .await
        .unwrap();
    let part = store
        .presign_upload_part(&original(), "up-9", 2)
        .await
        .unwrap();

    for url in [&get, &part] {
        assert!(
            url.starts_with(&format!("{HOST}/{BUCKET}/users/u1/originals/c1.mp4?")),
            "{url}"
        );
        assert!(url.contains("%2Fauto%2Fs3%2Faws4_request"), "{url}");
        assert!(!url.contains("x-amz-checksum"), "{url}");
    }
    assert!(
        part.contains("partNumber=2") && part.contains("uploadId=up-9"),
        "{part}"
    );
}

fn listing(body: &'static str) -> ReplayEvent {
    let request = http::Request::builder()
        .uri(format!("{HOST}/{BUCKET}"))
        .body(SdkBody::empty())
        .unwrap();
    let response = http::Response::builder()
        .status(200)
        .body(SdkBody::from(body))
        .unwrap();
    ReplayEvent::new(request, response)
}

#[tokio::test]
async fn r2_used_bytes_sums_every_page_of_the_users_prefix() {
    let replay = StaticReplayClient::new(vec![
        listing(
            "<ListBucketResult><Name>nimbytes-media</Name><Prefix>users/u1/</Prefix>\
             <KeyCount>2</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>true</IsTruncated>\
             <NextContinuationToken>page-2</NextContinuationToken>\
             <Contents><Key>users/u1/originals/c1.mp4</Key><Size>1000</Size></Contents>\
             <Contents><Key>users/u1/proxies/c1_720p.mp4</Key><Size>250</Size></Contents>\
             </ListBucketResult>",
        ),
        listing(
            "<ListBucketResult><Name>nimbytes-media</Name><Prefix>users/u1/</Prefix>\
             <KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>\
             <Contents><Key>users/u1/renders/x1.mp4</Key><Size>7</Size></Contents>\
             </ListBucketResult>",
        ),
    ]);
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version(BehaviorVersion::latest())
        .credentials_provider(Credentials::new("R2KEY", "secret", None, None, "test"))
        .http_client(replay.clone());
    let endpoint = r2::endpoint(ACCOUNT).unwrap();
    let client = Client::from_conf(r2::configure(config, &endpoint).build());
    let clock = Arc::new(FixedClock::at(1_793_071_200_000));
    let store =
        S3BlobStore::new(client, BUCKET, Duration::from_secs(900), clock).without_object_tags();

    let total = store
        .used_bytes(&keys::user_prefix(&UserId::parse("u1").unwrap()))
        .await
        .unwrap();

    assert_eq!(total, 1257);
    let uris: Vec<String> = replay
        .actual_requests()
        .map(|r| r.uri().to_owned())
        .collect();
    assert_eq!(
        uris,
        [
            format!("{HOST}/{BUCKET}/?list-type=2&prefix=users%2Fu1%2F"),
            format!("{HOST}/{BUCKET}/?list-type=2&prefix=users%2Fu1%2F&continuation-token=page-2"),
        ]
    );
}

#[test]
fn the_r2_endpoint_takes_only_a_plain_account_id() {
    assert_eq!(r2::endpoint(ACCOUNT).unwrap(), HOST);
    for bad in ["", "evil.com/x", "a b", "acct@other", &"a".repeat(65)] {
        let err = r2::endpoint(bad).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed, "{bad:?}");
    }
}
