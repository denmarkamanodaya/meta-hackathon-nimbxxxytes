//! Settings, the people overview with suggestions, and naming a group: exact wire shapes.

use axum::http::StatusCode;
use nimbytes_core::domain::face_match::{FaceLink, NamedTrack};
use nimbytes_core::domain::ids::{PersonId, TrackId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_testkit::FakeTrack;

use super::redesign_tests::overview_rows;
use super::test_support::{TestApp, get, post_json, put_json};

fn t(id: &str) -> TrackId {
    TrackId::parse(id).unwrap()
}

#[tokio::test]
async fn settings_read_and_switch_face_matching_and_on_queues_the_job() {
    let app = TestApp::new();
    let cookie = app.cookie_for("u1");

    let (_, _, before) = app.send(get("/api/settings", Some(&cookie))).await;
    let (status, _, on) = app
        .send(put_json(
            "/api/settings",
            &cookie,
            r#"{"face_matching":true}"#,
        ))
        .await;
    let (_, _, after) = app.send(get("/api/settings", Some(&cookie))).await;
    let (bad, _, _) = app
        .send(put_json(
            "/api/settings",
            &cookie,
            r#"{"face_matching":"yes"}"#,
        ))
        .await;
    let (anon, _, _) = app.send(get("/api/settings", None)).await;

    assert_eq!(before, r#"{"face_matching":false}"#);
    assert_eq!(
        (status, on.as_str()),
        (StatusCode::OK, r#"{"face_matching":true}"#)
    );
    assert_eq!(after, r#"{"face_matching":true}"#);
    let jobs: Vec<(JobKind, String)> = app
        .jobs
        .all()
        .into_iter()
        .map(|j| (j.job.kind, j.job.subject_id))
        .collect();
    assert_eq!(jobs, [(JobKind::FaceVectors, "u1".to_owned())]);
    assert_eq!(
        (bad, anon),
        (StatusCode::BAD_REQUEST, StatusCode::UNAUTHORIZED)
    );
}

fn links(app: &TestApp) {
    let ben = NamedTrack {
        track: t("c9-f0"),
        person_id: PersonId::parse("p1").unwrap(),
        name: "Ben".into(),
    };
    let link = FaceLink {
        a: t("c1-f3"),
        b: t("c9-f0"),
        confidence: 0.92,
    };
    app.faces.set_links(vec![link], vec![ben]);
}

#[tokio::test]
async fn the_overview_suggests_a_person_only_while_matching_is_on() {
    let app = TestApp::new();
    app.people.set_overview(overview_rows());
    links(&app);
    let cookie = app.cookie_for("u1");

    let (_, _, off) = app.send(get("/api/people/overview", Some(&cookie))).await;
    app.faces.turn_on(&UserId::parse("u1").unwrap());
    let (status, _, on) = app.send(get("/api/people/overview", Some(&cookie))).await;

    assert!(
        off.contains(r#""crop_url":null,"group_id":null,"suggested":null}]"#),
        "{off}"
    );
    assert_eq!(status, StatusCode::OK);
    assert!(
        on.contains(concat!(
            r#""on_screen_s":3.0,"crop_url":null,"group_id":null,"#,
            r#""suggested":{"person_id":"p1","name":"Ben","similarity":0.92}}]"#
        )),
        "{on}"
    );
}

fn track(id: &str, owner: &str) -> FakeTrack {
    FakeTrack {
        id: t(id),
        owner: UserId::parse(owner).unwrap(),
        segments: vec![],
        person: None,
        hidden: false,
    }
}

#[tokio::test]
async fn naming_a_group_answers_204_and_another_users_track_403_with_nothing_changed() {
    let app = TestApp::new();
    for (id, owner) in [("c1-f0", "u1"), ("c2-f0", "u1"), ("c9-f0", "u2")] {
        app.people.add_track(track(id, owner));
    }
    let cookie = app.cookie_for("u1");
    let send = |body: &'static str| post_json("/api/tracks/name", Some(&cookie), body);

    let (theirs, _, _) = app
        .send(send(r#"{"track_ids":["c1-f0","c9-f0"],"name":"Rex"}"#))
        .await;
    let unchanged = app.people.all_people().is_empty();
    let (empty, _, _) = app.send(send(r#"{"track_ids":[],"name":"Rex"}"#)).await;
    let (status, _, body) = app
        .send(send(r#"{"track_ids":["c1-f0","c2-f0"],"name":"Rex"}"#))
        .await;

    assert_eq!((theirs, unchanged), (StatusCode::FORBIDDEN, true));
    assert_eq!(empty, StatusCode::BAD_REQUEST);
    assert_eq!((status, body.as_str()), (StatusCode::NO_CONTENT, ""));
    let names: Vec<String> = app
        .people
        .all_people()
        .into_iter()
        .map(|p| p.name)
        .collect();
    assert_eq!(names, ["Rex"]);
}
