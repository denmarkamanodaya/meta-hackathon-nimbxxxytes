//! Memory Lane handlers over fakes: status codes, the exact wire shapes (every key present,
//! `null` for empty), `VALIDATION_FAILED`, and `NOT_FOUND` for another user's person, viewer,
//! clip or session on every route.

use axum::http::StatusCode;
use nimbytes_core::domain::ids::{ClipId, MemoryId, PersonId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::memory::{
    Memory, MemoryMoment, MemoryStatus, MomentPerson, SubjectKind,
};
use nimbytes_core::ports::PeopleStore;
use nimbytes_testkit::world::{clip, probe};
use serde_json::{Value, json};

use super::test_support::{TestApp, delete, get, post_json};

const AT: &str = "2026-10-31T01:00:00.000Z";

fn code(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap();
    v["error"]["code"].as_str().unwrap_or_default().to_owned()
}

fn json_of(body: &str) -> Value {
    serde_json::from_str(body).unwrap()
}

/// Its one checked moment, fixed by the check; Bo is no longer one of the owner's people.
fn ready_moment(id: &str, user: &str) -> MemoryMoment {
    MemoryMoment {
        index: 0,
        clip_id: ClipId::parse("c1").unwrap(),
        clip_title: "60th Birthday".into(),
        recorded_at: Some("2026-05-01T10:00:00.000Z".into()),
        start_s: 10.0,
        end_s: 20.0,
        on_screen_s: 9.0,
        frame_s: 14.5,
        people: vec![
            MomentPerson {
                person_id: Some(PersonId::parse("p-ann").unwrap()),
                name: "Ann".into(),
                crop_key: Some("users/u1/faces/c1/c1-f0.jpg".into()),
            },
            MomentPerson {
                person_id: None,
                name: "Bo".into(),
                crop_key: None,
            },
        ],
        description: "Ann opens a present.".into(),
        said: String::new(),
        frame_key: Some(format!("users/{user}/memories/{id}/frame_0.jpg")),
        line: "Ann opens a present with Eric.".into(),
        prompt: "What do you think was inside, Eric?".into(),
        checked: true,
        fixed_note: Some("Removed: her birthday".into()),
    }
}

/// A ready session of u1 about Ann, for Eric, with one checked moment that was fixed.
fn ready(id: &str, user: &str) -> Memory {
    Memory {
        id: MemoryId::parse(id).unwrap(),
        user_id: UserId::parse(user).unwrap(),
        subject_kind: SubjectKind::Person,
        person_id: Some(PersonId::parse("p-ann").unwrap()),
        clip_id: None,
        subject_name: "Ann".into(),
        viewer_id: Some(PersonId::parse("p-eric").unwrap()),
        viewer_name: Some("Eric".into()),
        title: "Ann's birthday".into(),
        status: MemoryStatus::Ready,
        step: None,
        moments: vec![ready_moment(id, user)],
        fixed_count: 1,
        cover_key: Some(format!("users/{user}/memories/{id}/cover.jpg")),
        error: None,
        created_at: AT.into(),
        updated_at: AT.into(),
    }
}

/// u1 has Ann and Eric, clip c1 and the ready session m9; u2 has Zoe, clip x1 and session z9.
async fn app() -> (TestApp, String) {
    let app = TestApp::new();
    for (user, id, name) in [
        ("u1", "p-ann", "Ann"),
        ("u1", "p-eric", "Eric"),
        ("u2", "p-zoe", "Zoe"),
    ] {
        let user = UserId::parse(user).unwrap();
        let id = PersonId::parse(id).unwrap();
        app.people.upsert_person(&user, &id, name).await.unwrap();
    }
    let mut c1 = clip(Some(probe(60.0, true))).unwrap();
    c1.title = Some("60th Birthday".into());
    app.catalogue.put_clip(c1);
    let mut x1 = clip(Some(probe(5.0, true))).unwrap();
    x1.id = ClipId::parse("x1").unwrap();
    x1.user_id = UserId::parse("u2").unwrap();
    app.catalogue.put_clip(x1);
    app.memories.put(ready("m9", "u1"));
    app.memories.put(ready("z9", "u2"));
    let cookie = app.cookie_for("u1");
    (app, cookie)
}

fn ready_summary() -> Value {
    json!({
        "id": "m9", "title": "Ann's birthday", "subject_kind": "person", "subject_name": "Ann",
        "viewer_name": "Eric", "status": "ready", "step": null, "moment_count": 1,
        "fixed_count": 1, "cover_url": "https://signed/users/u1/memories/m9/cover.jpg?ttl=3600",
        "created_at": AT, "error": null
    })
}

#[tokio::test]
async fn starting_a_session_answers_201_making_and_queues_its_job() {
    let (app, cookie) = app().await;
    let body = r#"{"person_id": "p-ann", "clip_id": null, "viewer_id": "p-eric"}"#;

    let (status, _, out) = app
        .send(post_json("/api/memories", Some(&cookie), body))
        .await;

    assert_eq!(status, StatusCode::CREATED, "{out}");
    assert_eq!(
        json_of(&out),
        json!({"memory_id": "m-1", "status": "making"})
    );
    let made = app.memories.memory("m-1").unwrap();
    assert_eq!(made.subject_name, "Ann");
    assert_eq!(made.viewer_name.as_deref(), Some("Eric"));
    let jobs = app.jobs.all();
    assert!(
        jobs.iter()
            .any(|j| j.job.kind == JobKind::Memory && j.job.subject_id == "m-1"),
        "{jobs:?}"
    );

    let day = r#"{"person_id": null, "clip_id": "c1", "viewer_id": null}"#;
    let (status, _, out) = app
        .send(post_json("/api/memories", Some(&cookie), day))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{out}");
    let id = json_of(&out)["memory_id"].as_str().unwrap().to_owned();
    let made = app.memories.memory(&id).unwrap();
    assert_eq!(
        (made.subject_kind, made.subject_name.as_str()),
        (SubjectKind::Clip, "60th Birthday")
    );
}

#[tokio::test]
async fn another_users_person_viewer_or_clip_is_not_found_and_bad_bodies_are_refused() {
    let (app, cookie) = app().await;
    for theirs in [
        r#"{"person_id": "p-zoe", "clip_id": null, "viewer_id": null}"#,
        r#"{"person_id": "p-ann", "clip_id": null, "viewer_id": "p-zoe"}"#,
        r#"{"person_id": null, "clip_id": "x1", "viewer_id": null}"#,
        r#"{"person_id": "p-nobody", "clip_id": null, "viewer_id": null}"#,
    ] {
        let (status, _, out) = app
            .send(post_json("/api/memories", Some(&cookie), theirs))
            .await;
        assert_eq!(
            (status, code(&out).as_str()),
            (StatusCode::NOT_FOUND, "NOT_FOUND"),
            "{theirs}"
        );
    }
    for bad in [
        r#"{"person_id": null, "clip_id": null, "viewer_id": null}"#,
        r#"{"person_id": "p-ann", "clip_id": "c1", "viewer_id": null}"#,
        r#"{"person_id": "../x", "clip_id": null, "viewer_id": null}"#,
    ] {
        let (status, _, out) = app
            .send(post_json("/api/memories", Some(&cookie), bad))
            .await;
        assert_eq!(
            (status, code(&out).as_str()),
            (StatusCode::BAD_REQUEST, "VALIDATION_FAILED"),
            "{bad}"
        );
    }
    assert!(app.memories.memory("m-1").is_none(), "nothing was made");
    let (status, _, _) = app
        .send(post_json(
            "/api/memories",
            None,
            r#"{"person_id": "p-ann"}"#,
        ))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_list_holds_only_the_callers_sessions_with_every_key() {
    let (app, cookie) = app().await;
    let (status, _, out) = app.send(get("/api/memories", Some(&cookie))).await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert_eq!(json_of(&out), json!([ready_summary()]));
}

#[tokio::test]
async fn the_detail_signs_the_proxy_frame_and_faces_of_every_moment() {
    let (app, cookie) = app().await;
    let (status, _, out) = app.send(get("/api/memories/m9", Some(&cookie))).await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert_eq!(
        json_of(&out),
        json!({
            "summary": ready_summary(),
            "moments": [{
                "index": 0, "clip_id": "c1", "clip_title": "60th Birthday",
                "recorded_at": "2026-05-01T10:00:00.000Z", "start_s": 10.0, "end_s": 20.0,
                "proxy_url": "https://signed/users/u1/proxies/c1_720p.mp4?ttl=3600",
                "thumb_url": "https://signed/users/u1/memories/m9/frame_0.jpg?ttl=3600",
                "people": [
                    {"person_id": "p-ann", "name": "Ann",
                     "crop_url": "https://signed/users/u1/faces/c1/c1-f0.jpg?ttl=3600"},
                    {"person_id": "", "name": "Bo", "crop_url": null}
                ],
                "line": "Ann opens a present with Eric.",
                "prompt": "What do you think was inside, Eric?",
                "checked": true, "fixed_note": "Removed: her birthday"
            }]
        })
    );
}

#[tokio::test]
async fn another_users_session_is_not_found_on_every_route() {
    let (app, cookie) = app().await;
    let (status, _, out) = app.send(get("/api/memories/z9", Some(&cookie))).await;
    assert_eq!(
        (status, code(&out).as_str()),
        (StatusCode::NOT_FOUND, "NOT_FOUND")
    );
    let (status, _, out) = app.send(delete("/api/memories/z9", &cookie)).await;
    assert_eq!(
        (status, code(&out).as_str()),
        (StatusCode::NOT_FOUND, "NOT_FOUND")
    );
    assert!(app.memories.memory("z9").is_some(), "their session stays");
    assert!(app.blobs.deleted().is_empty());
}

#[tokio::test]
async fn deleting_a_session_removes_its_cover_frames_row_and_working_files() {
    let (app, cookie) = app().await;
    let (status, _, out) = app.send(delete("/api/memories/m9", &cookie)).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{out}");
    assert!(app.memories.memory("m9").is_none());
    let deleted = app.blobs.deleted();
    assert!(
        deleted.contains(&"users/u1/memories/m9/cover.jpg".to_owned()),
        "{deleted:?}"
    );
    assert!(
        deleted.contains(&"users/u1/memories/m9/frame_0.jpg".to_owned()),
        "{deleted:?}"
    );
    assert!(
        deleted
            .iter()
            .all(|k| k.starts_with("users/u1/memories/m9/")),
        "the clip's crops stay: {deleted:?}"
    );
    assert!(app.scratch.removed().contains(&"memories/m9".to_owned()));
}
