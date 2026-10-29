//! Handler tests over fakes: exact wire bodies, status codes, cookies and ownership.

use axum::http::{StatusCode, header};

use super::test_support::{PASSCODE, TestApp, get, post_json};

const MOV_20_MIB: &str =
    r#"{"filename":"IMG_0001.MOV","size_bytes":20971520,"content_type":"video/quicktime"}"#;

async fn signed_in(app: &TestApp) -> String {
    let body = format!(r#"{{"passcode":"{PASSCODE}"}}"#);
    let (status, headers, _) = app.send(post_json("/api/session", None, &body)).await;
    assert_eq!(status, StatusCode::OK);
    let set = headers[header::SET_COOKIE].to_str().unwrap();
    set.split(';').next().unwrap().to_owned()
}

#[tokio::test]
async fn session_sets_a_signed_http_only_secure_lax_cookie() {
    let app = TestApp::new();
    let body = format!(r#"{{"passcode":"{PASSCODE}"}}"#);

    let (status, headers, text) = app.send(post_json("/api/session", None, &body)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(text, r#"{"user_id":"id-1"}"#);
    let set = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(set.starts_with("nb_session="), "{set}");
    assert!(
        !set.starts_with("nb_session=id-1;"),
        "value must be signed: {set}"
    );
    for attr in ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"] {
        assert!(set.contains(attr), "{attr} missing: {set}");
    }
}

#[tokio::test]
async fn get_session_says_whether_the_cookie_is_still_valid() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;

    let (status, _, body) = app.send(get("/api/session", Some(&cookie))).await;
    assert_eq!(
        (status, body.as_str()),
        (StatusCode::OK, r#"{"user_id":"id-1"}"#)
    );

    for cookie in [None, Some("nb_session=id-1")] {
        let (status, _, body) = app.send(get("/api/session", cookie)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{cookie:?}");
        assert!(body.contains(r#""code":"UNAUTHORIZED""#), "{body}");
    }
}

#[tokio::test]
async fn wrong_passcode_is_401_with_no_cookie() {
    let app = TestApp::new();
    let (status, headers, body) = app
        .send(post_json("/api/session", None, r#"{"passcode":"nope"}"#))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(headers.get(header::SET_COOKIE).is_none());
    assert_eq!(
        body,
        r#"{"error":{"code":"UNAUTHORIZED","message":"wrong passcode"}}"#
    );
}

#[tokio::test]
async fn no_cookie_or_a_forged_cookie_is_401() {
    let app = TestApp::new();
    let unsigned = "nb_session=id-1";
    for cookie in [None, Some(unsigned)] {
        let (status, _, body) = app.send(get("/api/clips", cookie)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{cookie:?}");
        assert_eq!(
            body,
            r#"{"error":{"code":"UNAUTHORIZED","message":"sign in first"}}"#
        );
    }
}

#[tokio::test]
async fn create_upload_returns_ids_part_size_and_every_part_url() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;

    let (status, _, body) = app
        .send(post_json("/api/uploads", Some(&cookie), MOV_20_MIB))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let base = "https://fake/users/id-1/originals/id-2.mov?uploadId=s3-upload-1&partNumber=";
    let want = format!(
        r#"{{"upload_id":"id-3","clip_id":"id-2","part_size":8388608,"parts":[{{"n":1,"url":"{base}1"}},{{"n":2,"url":"{base}2"}},{{"n":3,"url":"{base}3"}}]}}"#
    );
    assert_eq!(body, want);
}

#[tokio::test]
async fn complete_registers_the_clip_and_queues_ingest() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    app.send(post_json("/api/uploads", Some(&cookie), MOV_20_MIB))
        .await;
    app.blobs.set_completed_size(20_971_520);
    let parts =
        r#"{"parts":[{"n":1,"etag":"\"a\""},{"n":2,"etag":"\"b\""},{"n":3,"etag":"\"c\""}]}"#;

    let (status, _, body) = app
        .send(post_json(
            "/api/uploads/id-3/complete",
            Some(&cookie),
            parts,
        ))
        .await;
    let (_, _, clips) = app.send(get("/api/clips", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body, r#"{"clip_id":"id-2","status":"uploaded"}"#);
    assert_eq!(app.jobs.all().len(), 1);
    let sent: Vec<String> = app.blobs.completed()[0]
        .1
        .iter()
        .map(|p| p.etag.clone())
        .collect();
    assert_eq!(
        sent,
        ["\"a\"", "\"b\"", "\"c\""],
        "ETags reach S3 with their quotes"
    );
    assert_eq!(
        clips,
        r#"[{"clip_id":"id-2","filename":"IMG_0001.MOV","title":"IMG_0001","duration_s":null,"recorded_at":null,"status":"uploaded","thumb_url":null,"segment_count":0,"people":[],"duplicate_of":null,"size_bytes":20971520,"project_ids":[],"speech_count":0,"face_count":0,"near_copy_of":null,"angles":0}]"#
    );
}

#[tokio::test]
async fn another_users_upload_is_403_for_parts_and_complete() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    app.send(post_json("/api/uploads", Some(&cookie), MOV_20_MIB))
        .await;
    let mallory = app.cookie_for("mallory");

    let (s1, _, b1) = app
        .send(post_json(
            "/api/uploads/id-3/parts",
            Some(&mallory),
            r#"{"part_numbers":[1]}"#,
        ))
        .await;
    let (s2, _, _) = app
        .send(post_json(
            "/api/uploads/id-3/complete",
            Some(&mallory),
            r#"{"parts":[]}"#,
        ))
        .await;

    assert_eq!(s1, StatusCode::FORBIDDEN);
    assert_eq!(
        b1,
        r#"{"error":{"code":"FORBIDDEN","message":"upload belongs to another user"}}"#
    );
    assert_eq!(s2, StatusCode::FORBIDDEN);
    assert!(app.blobs.completed().is_empty());
}

#[tokio::test]
async fn the_proxy_url_is_for_the_owner_only() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    app.send(post_json("/api/uploads", Some(&cookie), MOV_20_MIB))
        .await;
    let mallory = app.cookie_for("mallory");

    let (s1, _, b1) = app
        .send(post_json("/api/uploads/id-3/proxy", Some(&cookie), ""))
        .await;
    let (s2, _, _) = app
        .send(post_json("/api/uploads/id-3/proxy", Some(&mallory), ""))
        .await;

    assert_eq!(s1, StatusCode::OK, "{b1}");
    assert!(b1.starts_with(r#"{"url":"https://put/"#), "{b1}");
    assert!(b1.contains("proxies/id-2_720p.mp4"), "{b1}");
    assert_eq!(s2, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn malformed_json_and_bad_ids_are_validation_failed() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;

    let (s1, _, b1) = app
        .send(post_json("/api/uploads", Some(&cookie), "{"))
        .await;
    let (s2, _, b2) = app
        .send(post_json(
            "/api/uploads/bad.id/parts",
            Some(&cookie),
            r#"{"part_numbers":[1]}"#,
        ))
        .await;

    assert_eq!(s1, StatusCode::BAD_REQUEST);
    assert!(
        b1.starts_with(r#"{"error":{"code":"VALIDATION_FAILED""#),
        "{b1}"
    );
    assert_eq!(s2, StatusCode::BAD_REQUEST);
    assert!(
        b2.starts_with(r#"{"error":{"code":"VALIDATION_FAILED""#),
        "{b2}"
    );
}

#[tokio::test]
async fn unknown_upload_is_404_for_parts_and_complete() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    let not_found = r#"{"error":{"code":"NOT_FOUND","message":"no such upload"}}"#;

    let (s1, _, b1) = app
        .send(post_json(
            "/api/uploads/nope/parts",
            Some(&cookie),
            r#"{"part_numbers":[1]}"#,
        ))
        .await;
    let (s2, _, b2) = app
        .send(post_json(
            "/api/uploads/nope/complete",
            Some(&cookie),
            r#"{"parts":[]}"#,
        ))
        .await;

    assert_eq!((s1, b1.as_str()), (StatusCode::NOT_FOUND, not_found));
    assert_eq!((s2, b2.as_str()), (StatusCode::NOT_FOUND, not_found));
}

#[tokio::test]
async fn every_endpoint_but_health_and_session_needs_a_cookie() {
    let app = TestApp::new();
    let requests = [
        post_json("/api/uploads", None, MOV_20_MIB),
        post_json("/api/uploads/x/parts", None, r#"{"part_numbers":[1]}"#),
        post_json("/api/uploads/x/complete", None, r#"{"parts":[]}"#),
        get("/api/clips", None),
    ];
    for req in requests {
        let uri = req.uri().to_string();
        let (status, _, body) = app.send(req).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
        assert!(body.contains(r#""code":"UNAUTHORIZED""#), "{uri}: {body}");
    }
}
