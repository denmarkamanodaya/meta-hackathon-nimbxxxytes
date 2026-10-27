//! Shorts handlers over fakes: exact wire shapes, validation, ownership.

use axum::http::StatusCode;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::short::{NewStep, StepKind};
use nimbytes_core::keys;
use nimbytes_core::ports::ShortStore;
use nimbytes_testkit::shorts_world::{moment, timeline, user};
use serde_json::{Value, json};

use super::test_support::{TestApp, delete, get, post_json, put_json};

const CREATE: &str = r#"{"prompt":"calm","segment_ids":["s1","s0"],"aspect":"4:5","target_s":6}"#;

/// Moments s0 (with speech) and s1 of u1, x0 of u2; returns u1's cookie.
fn seeded(app: &TestApp) -> String {
    let speech = Some("okay latte art attempt");
    app.shorts
        .add_moment(moment("s0", "c1", (0.0, 8.0), speech), &user("u1"));
    app.shorts
        .add_moment(moment("s1", "c2", (10.0, 18.0), None), &user("u1"));
    app.shorts
        .add_moment(moment("x0", "c9", (0.0, 8.0), None), &user("u2"));
    app.cookie_for("u1")
}

/// A created short `id-1` with version 1 over s0 1–4 s and a plan step.
async fn planned(app: &TestApp, cookie: &str) -> ShortId {
    let (status, _, body) = app
        .send(post_json("/api/shorts", Some(cookie), CREATE))
        .await;
    assert_eq!(
        (status, body.as_str()),
        (StatusCode::OK, r#"{"short_id":"id-1"}"#)
    );
    let id = ShortId::parse("id-1").unwrap();
    let v1 = timeline(&[("s0", 1.0, 4.0)]);
    app.shorts.add_version(&id, 1, &v1).await.unwrap();
    let step = NewStep {
        kind: StepKind::Plan,
        tool: None,
        version: Some(1),
        summary: "Open on the pour.".into(),
        at: "2026-10-27T03:00:01.000Z".into(),
    };
    app.shorts.add_step(&id, &step).await.unwrap();
    id
}

fn json_of(body: &str) -> Value {
    serde_json::from_str(body).unwrap()
}

#[tokio::test]
async fn creating_a_short_answers_its_id_and_queues_the_agent_job() {
    let app = TestApp::new();
    let cookie = seeded(&app);

    planned(&app, &cookie).await;

    let jobs = app.jobs.all();
    let job = &jobs[0].job;
    assert_eq!(
        (job.kind.as_str(), job.subject_id.as_str()),
        ("agent", "id-1")
    );
}

#[tokio::test]
async fn bad_create_bodies_are_400_and_foreign_moments_404_or_403() {
    let app = TestApp::new();
    let cookie = seeded(&app);
    let cases = [
        (
            r#"{"segment_ids":["s0"],"aspect":"16:9","target_s":6}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"segment_ids":["s0"],"aspect":"1:1","target_s":6,"x":1}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"segment_ids":[],"aspect":"1:1","target_s":6}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"segment_ids":["s0"],"aspect":"1:1","target_s":200}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"segment_ids":["nope"],"aspect":"1:1","target_s":6}"#,
            StatusCode::NOT_FOUND,
        ),
        (
            r#"{"segment_ids":["x0"],"aspect":"1:1","target_s":6}"#,
            StatusCode::FORBIDDEN,
        ),
    ];
    for (body, want) in cases {
        let (status, _, answer) = app
            .send(post_json("/api/shorts", Some(&cookie), body))
            .await;
        assert_eq!(status, want, "{body} → {answer}");
        assert!(answer.starts_with(r#"{"error":{"code":""#), "{answer}");
    }
    let (status, _, _) = app.send(post_json("/api/shorts", None, CREATE)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(app.jobs.all().is_empty());
}

/// Proxy URL, phrase captions, fps and end card of the planned version.
fn assert_player_props(props: &Value) {
    assert_eq!(
        props["clips"][0]["src_url"],
        "https://signed/users/u1/proxies/c1_720p.mp4?ttl=3600"
    );
    assert_eq!(
        props["clips"][0]["captions"][0]["text"],
        "okay latte art attempt"
    );
    assert_eq!(
        (props["fps"].as_u64(), props["end_card_s"].as_f64()),
        (Some(30), Some(1.0))
    );
}

#[tokio::test]
async fn detail_answers_the_agreed_shape_with_player_props() {
    let app = TestApp::new();
    let cookie = seeded(&app);
    planned(&app, &cookie).await;

    let (status, _, body) = app.send(get("/api/shorts/id-1", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let got = json_of(&body);
    assert_eq!(
        got["short"],
        json!({"short_id": "id-1", "prompt": "calm", "aspect": "4:5", "target_s": 6.0,
               "status": "planning", "best_version": null, "render_url": null})
    );
    let v = &got["versions"][0];
    assert_eq!(
        (v["n"].as_u64(), v["preview_url"].is_null()),
        (Some(1), true)
    );
    assert!(v["critique"].is_null() && v["score_total"].is_null());
    assert_eq!(
        v["timeline"]["clips"][0],
        json!({"segment_id": "s0", "in": 1.0, "out": 4.0,
               "subject": null, "punch_in": 1.0, "reason": "because"})
    );
    assert_player_props(&v["composition_props"]);
    assert_eq!(
        got["steps"],
        json!([{"seq": 0, "kind": "plan", "tool": null, "version": 1,
                "summary": "Open on the pour.", "at": "2026-10-27T03:00:01.000Z"}])
    );
    assert_eq!(
        got["segments"][0],
        json!({"segment_id": "s1", "clip_id": "c2", "start_s": 10.0, "end_s": 18.0,
               "thumb_url": "https://signed/users/u1/thumbs/c2/s1.jpg?ttl=3600",
               "description": "moment s1"})
    );
}

#[tokio::test]
async fn shorts_of_another_user_are_403_and_unknown_ones_404() {
    let app = TestApp::new();
    let cookie = seeded(&app);
    planned(&app, &cookie).await;
    let other = app.cookie_for("u2");

    for uri in ["/api/shorts/id-1", "/api/shorts/id-1/download"] {
        let (status, _, _) = app.send(get(uri, Some(&other))).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{uri}");
    }
    let (status, _, _) = app.send(get("/api/shorts/nope", Some(&cookie))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_edit_becomes_version_2_and_an_unfittable_one_is_400() {
    let app = TestApp::new();
    let cookie = seeded(&app);
    planned(&app, &cookie).await;
    let uri = "/api/shorts/id-1/timeline";
    let edit = json!({"timeline": timeline(&[("s1", 10.0, 15.0)])}).to_string();

    let (status, _, body) = app.send(put_json(uri, &cookie, &edit)).await;

    assert_eq!(
        (status, body.as_str()),
        (StatusCode::OK, r#"{"version":2}"#)
    );
    let bad = json!({"timeline": timeline(&[("x0", 0.0, 3.0)])}).to_string();
    let (status, _, body) = app.send(put_json(uri, &cookie, &bad)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
async fn render_answers_the_job_id_and_download_waits_for_a_finished_render() {
    let app = TestApp::new();
    let cookie = seeded(&app);
    let id = planned(&app, &cookie).await;
    let render = |body: &'static str| post_json("/api/shorts/id-1/render", Some(&cookie), body);

    let (status, _, body) = app.send(render(r#"{"version_n":1}"#)).await;
    assert_eq!(
        (status, body.as_str()),
        (StatusCode::OK, r#"{"job_id":"id-3"}"#)
    );
    let (status, _, _) = app.send(render(r#"{"version_n":9}"#)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let download = || get("/api/shorts/id-1/download", Some(&cookie));
    let (status, _, _) = app.send(download()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let key = keys::render(&user("u1"), &id);
    app.shorts.set_render(&id, Some((&key, 1))).await.unwrap();
    let (status, _, body) = app.send(download()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        r#"{"url":"https://signed/users/u1/renders/id-1.mp4?ttl=3600&download=nimbytes-short-v1.mp4"}"#
    );
}

#[tokio::test]
async fn deleting_a_short_is_204_then_404_and_another_users_is_403_with_nothing_removed() {
    let app = TestApp::new();
    let cookie = seeded(&app);
    let id = planned(&app, &cookie).await;

    let (theirs, _, _) = app
        .send(delete("/api/shorts/id-1", &app.cookie_for("u2")))
        .await;
    let kept = (app.blobs.deleted().len(), app.jobs.all().len());
    let (status, _, body) = app.send(delete("/api/shorts/id-1", &cookie)).await;
    let (again, _, _) = app.send(delete("/api/shorts/id-1", &cookie)).await;
    let (detail, _, _) = app.send(get("/api/shorts/id-1", Some(&cookie))).await;

    assert_eq!((theirs, kept), (StatusCode::FORBIDDEN, (0, 1)));
    assert_eq!((status, body.as_str()), (StatusCode::NO_CONTENT, ""));
    assert_eq!(
        app.blobs.deleted(),
        ["users/u1/previews/id-1/v1.mp4", "users/u1/renders/id-1.mp4"]
    );
    assert!(app.jobs.all().is_empty(), "the agent job is cancelled");
    assert_eq!(
        (again, detail),
        (StatusCode::NOT_FOUND, StatusCode::NOT_FOUND)
    );
    assert!(app.shorts.versions(&id).await.unwrap().is_empty());
}
