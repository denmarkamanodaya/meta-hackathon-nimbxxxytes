//! MyWay handlers over fakes: status codes, the exact wire shapes (every key present), ownership
//! (`FORBIDDEN` on another user's guide), idempotent start, and the share routes being gone.

use axum::http::StatusCode;
use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::guide::{Guide, GuideStage, GuideStatus, GuideStep, LANGUAGE, Safety};
use nimbytes_core::domain::ids::{ClipId, GuideId, UserId};
use nimbytes_core::keys::ObjectKey;
use nimbytes_testkit::world::{clip, probe};
use serde_json::{Value, json};

use super::test_support::{TestApp, delete, get, patch_json, post_json};

fn ready_guide(user: &str) -> Guide {
    Guide {
        id: GuideId::parse("g1").unwrap(),
        user_id: UserId::parse(user).unwrap(),
        clip_id: ClipId::parse("c9").unwrap(),
        title: "Start a quick wash".into(),
        status: GuideStatus::Ready,
        stage: Some(GuideStage::Ready),
        safety: Some(Safety::Caution),
        safety_reason: Some("Hot water.".into()),
        language: LANGUAGE.into(),
        error: None,
        created_at: "2026-10-29T01:00:00.000Z".into(),
        updated_at: "2026-10-29T01:00:00.000Z".into(),
    }
}

fn key(raw: &str) -> Option<ObjectKey> {
    Some(ObjectKey::from_stored(raw.into()))
}

fn steps() -> Vec<GuideStep> {
    vec![
        GuideStep {
            n: 1,
            title: "Choose the program".into(),
            instruction: "Turn the dial to Quick Wash.".into(),
            start_s: 0.0,
            end_s: 8.0,
            key_s: 4.0,
            control: Some("round dial".into()),
            highlight: Some("round dial".into()),
            image_key: key("users/u1/guides/g1/step_1.jpg"),
            audio_key: key("users/u1/guides/g1/voice_ab.wav"),
            audio_text: Some("Step 1. Turn the dial to Quick Wash.".into()),
            clip_key: key("users/u1/guides/g1/step_1.mp4"),
        },
        GuideStep {
            n: 2,
            title: "Start".into(),
            instruction: "Press start.".into(),
            start_s: 8.0,
            end_s: 12.0,
            key_s: 9.0,
            control: None,
            highlight: None,
            image_key: None,
            audio_key: None,
            audio_text: None,
            clip_key: None,
        },
    ]
}

/// An app whose u1 owns the ready clip c1, and the ready guide g1 (two steps, caution) made
/// from its 74 s clip c9 "Laundry run".
fn app() -> (TestApp, String) {
    let app = TestApp::new();
    let mut c1 = clip(Some(probe(60.0, true))).unwrap();
    c1.status = ClipStatus::Ready;
    app.catalogue.put_clip(c1);
    let mut c9 = clip(Some(probe(74.0, true))).unwrap();
    c9.id = ClipId::parse("c9").unwrap();
    c9.status = ClipStatus::Ready;
    c9.title = Some("Laundry run".into());
    app.catalogue.put_clip(c9);
    app.guides.put(ready_guide("u1"), steps());
    let cookie = app.cookie_for("u1");
    (app, cookie)
}

fn code(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap();
    v["error"]["code"].as_str().unwrap_or_default().to_owned()
}

#[tokio::test]
async fn starting_a_guide_answers_202_and_a_second_start_the_same_guide() {
    let (app, cookie) = app();

    let (first, _, body) = app
        .send(post_json("/api/clips/c1/guide", Some(&cookie), ""))
        .await;
    let (second, _, again) = app
        .send(post_json("/api/clips/c1/guide", Some(&cookie), ""))
        .await;

    assert_eq!(first, StatusCode::ACCEPTED, "{body}");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"guide_id": "g-1", "status": "queued"})
    );
    assert_eq!((second, again), (StatusCode::ACCEPTED, body));
    assert_eq!(app.jobs.all().len(), 1, "one guide job");
}

#[tokio::test]
async fn starting_needs_a_session_and_the_owners_clip() {
    let (app, _) = app();
    let other = app.cookie_for("u2");

    let (anon, _, _) = app.send(post_json("/api/clips/c1/guide", None, "")).await;
    let (foreign, _, body) = app
        .send(post_json("/api/clips/c1/guide", Some(&other), ""))
        .await;
    let (bad, _, _) = app
        .send(post_json("/api/clips/a.b/guide", Some(&other), ""))
        .await;

    assert_eq!(anon, StatusCode::UNAUTHORIZED);
    assert_eq!(
        (foreign, code(&body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );
    assert_eq!(bad, StatusCode::BAD_REQUEST);
    assert!(app.jobs.all().is_empty());
}

#[tokio::test]
async fn a_guide_answers_every_key_with_signed_urls_and_null_for_what_is_missing() {
    let (app, cookie) = app();

    let (status, _, body) = app.send(get("/api/guides/g1", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        v,
        json!({
            "id": "g1", "clip_id": "c9", "title": "Start a quick wash", "status": "ready",
            "stage": "ready", "error": null, "safety": "caution", "safety_reason": "Hot water.",
            "clip_title": "Laundry run", "clip_duration_s": 74.0, "language": "en",
            "steps": [
                {"n": 1, "title": "Choose the program", "instruction": "Turn the dial to Quick Wash.",
                 "start_s": 0.0, "end_s": 8.0, "key_s": 4.0,
                 "image_url": "https://signed/users/u1/guides/g1/step_1.jpg?ttl=3600",
                 "audio_url": "https://signed/users/u1/guides/g1/voice_ab.wav?ttl=3600",
                 "clip_url": "https://signed/users/u1/guides/g1/step_1.mp4?ttl=3600",
                 "highlight": {"label": "round dial"}},
                {"n": 2, "title": "Start", "instruction": "Press start.", "start_s": 8.0,
                 "end_s": 12.0, "key_s": 9.0, "image_url": null, "audio_url": null,
                 "clip_url": null, "highlight": null}
            ]
        })
    );
}

#[tokio::test]
async fn the_list_has_one_row_per_guide_with_its_count_and_cover() {
    let (app, cookie) = app();

    let (status, _, body) = app.send(get("/api/guides", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!([{
            "id": "g1", "clip_id": "c9", "title": "Start a quick wash", "status": "ready",
            "stage": "ready", "error": null, "clip_title": "Laundry run",
            "clip_duration_s": 74.0, "step_count": 2,
            "cover_url": "https://signed/users/u1/guides/g1/step_1.jpg?ttl=3600",
            "created_at": "2026-10-29T01:00:00.000Z"
        }])
    );
    let other = app.cookie_for("u2");
    let (_, _, none) = app.send(get("/api/guides", Some(&other))).await;
    assert_eq!(none, "[]");
}

#[tokio::test]
async fn another_users_guide_is_forbidden_on_every_route_and_a_missing_one_not_found() {
    let (app, _) = app();
    let other = app.cookie_for("u2");
    let edit = r#"{"title":"Mine now"}"#;

    let replies = [
        app.send(get("/api/guides/g1", Some(&other))).await,
        app.send(patch_json("/api/guides/g1/steps/1", &other, edit))
            .await,
        app.send(delete("/api/guides/g1", &other)).await,
    ];

    for (status, _, body) in &replies {
        assert_eq!(
            (*status, code(body).as_str()),
            (StatusCode::FORBIDDEN, "FORBIDDEN")
        );
    }
    let (missing, _, _) = app.send(get("/api/guides/nope", Some(&other))).await;
    assert_eq!(missing, StatusCode::NOT_FOUND);
    assert_eq!(app.guides.steps_of("g1")[0].title, "Choose the program");
}

#[tokio::test]
async fn patching_a_step_answers_the_step_and_speaks_only_a_changed_sentence() {
    let (app, cookie) = app();

    let (status, _, body) = app
        .send(patch_json(
            "/api/guides/g1/steps/2",
            &cookie,
            r#"{"instruction":"Press the start button."}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["instruction"], "Press the start button.");
    assert_eq!(v["title"], "Start");
    assert!(v["audio_url"].as_str().unwrap().contains("/voice_"));
    assert_eq!(
        app.narrator.spoken(),
        ["step two", "press the start button"]
    );
}

#[tokio::test]
async fn a_bad_patch_is_400_and_a_missing_step_404() {
    let (app, cookie) = app();

    let (unknown, _, _) = app
        .send(patch_json("/api/guides/g1/steps/1", &cookie, r#"{"n":3}"#))
        .await;
    let (empty, _, body) = app
        .send(patch_json("/api/guides/g1/steps/1", &cookie, "{}"))
        .await;
    let (missing, _, _) = app
        .send(patch_json(
            "/api/guides/g1/steps/7",
            &cookie,
            r#"{"title":"X"}"#,
        ))
        .await;

    assert_eq!(unknown, StatusCode::BAD_REQUEST);
    assert_eq!(
        (empty, code(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(missing, StatusCode::NOT_FOUND);
    assert!(app.narrator.spoken().is_empty());
}

#[tokio::test]
async fn a_guide_whose_clip_is_gone_answers_null_clip_fields() {
    let app = TestApp::new();
    let mut gone = ready_guide("u1");
    gone.clip_id = ClipId::parse("c404").unwrap();
    app.guides.put(gone, Vec::new());
    let cookie = app.cookie_for("u1");

    let (_, _, detail) = app.send(get("/api/guides/g1", Some(&cookie))).await;
    let (_, _, list) = app.send(get("/api/guides", Some(&cookie))).await;

    let detail: Value = serde_json::from_str(&detail).unwrap();
    let list: Value = serde_json::from_str(&list).unwrap();
    for v in [&detail, &list[0]] {
        assert_eq!(v["clip_title"], Value::Null, "{v}");
        assert_eq!(v["clip_duration_s"], Value::Null, "{v}");
        assert!(v.as_object().unwrap().contains_key("clip_title"));
    }
}

#[tokio::test]
async fn the_share_routes_no_longer_exist() {
    let (app, cookie) = app();

    let (post, _, _) = app
        .send(post_json("/api/guides/g1/share", Some(&cookie), ""))
        .await;
    let (del, _, _) = app.send(delete("/api/guides/g1/share", &cookie)).await;

    assert_eq!((post, del), (StatusCode::NOT_FOUND, StatusCode::NOT_FOUND));
}

#[tokio::test]
async fn deleting_a_guide_is_204_and_it_is_gone() {
    let (app, cookie) = app();

    let (status, _, body) = app.send(delete("/api/guides/g1", &cookie)).await;
    let (after, _, _) = app.send(get("/api/guides/g1", Some(&cookie))).await;

    assert_eq!((status, body.as_str()), (StatusCode::NO_CONTENT, ""));
    assert_eq!(after, StatusCode::NOT_FOUND);
    assert!(
        app.blobs
            .deleted()
            .contains(&"users/u1/guides/g1/step_2_frame.jpg".to_owned())
    );
}

#[tokio::test]
async fn renaming_a_guide_answers_the_whole_guide_with_the_tidied_title() {
    let (app, cookie) = app();

    let (status, _, body) = app
        .send(patch_json(
            "/api/guides/g1",
            &cookie,
            r#"{"title":"  Quick   wash  "}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["title"], "Quick wash");
    assert_eq!(v["id"], "g1");
    assert!(v["steps"].is_array());
    let (_, _, again) = app.send(get("/api/guides/g1", Some(&cookie))).await;
    assert_eq!(
        serde_json::from_str::<Value>(&again).unwrap()["title"],
        "Quick wash"
    );
}

#[tokio::test]
async fn a_bad_rename_is_400_and_another_users_guide_403() {
    let (app, cookie) = app();
    let other = app.cookie_for("u2");

    let (empty, _, body) = app
        .send(patch_json("/api/guides/g1", &cookie, r#"{"title":"   "}"#))
        .await;
    let long = format!(r#"{{"title":"{}"}}"#, "a".repeat(61));
    let (too_long, _, _) = app.send(patch_json("/api/guides/g1", &cookie, &long)).await;
    let (unknown, _, _) = app
        .send(patch_json("/api/guides/g1", &cookie, r#"{"name":"X"}"#))
        .await;
    let (foreign, _, _) = app
        .send(patch_json("/api/guides/g1", &other, r#"{"title":"Mine"}"#))
        .await;

    assert_eq!(
        (empty, code(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(too_long, StatusCode::BAD_REQUEST);
    assert_eq!(unknown, StatusCode::BAD_REQUEST);
    assert_eq!(foreign, StatusCode::FORBIDDEN);
    let (_, _, after) = app.send(get("/api/guides/g1", Some(&cookie))).await;
    assert_eq!(
        serde_json::from_str::<Value>(&after).unwrap()["title"],
        "Start a quick wash"
    );
}
