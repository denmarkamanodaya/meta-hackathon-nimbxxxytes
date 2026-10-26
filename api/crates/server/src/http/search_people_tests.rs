//! Search, people, costs and logout handlers over fakes: wire shapes, validation, ownership.

use axum::http::{StatusCode, header};
use nimbytes_core::domain::cost::{ModelCall, Usage};
use nimbytes_core::domain::ids::{SegmentId, SpeakerId, TrackId, UserId};
use nimbytes_core::ports::ModelLedger;
use nimbytes_testkit::{FakeSpeaker, FakeTrack};

use super::test_support::{PASSCODE, TestApp, get, post_json, put_json};

async fn signed_in(app: &TestApp) -> String {
    let body = format!(r#"{{"passcode":"{PASSCODE}"}}"#);
    let (_, headers, _) = app.send(post_json("/api/session", None, &body)).await;
    headers[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}

/// The demo user is `id-1`; one track and one speaker belong to them.
fn seed(app: &TestApp) {
    let owner = UserId::parse("id-1").unwrap();
    let seg = SegmentId::parse("c1-s0").unwrap();
    app.people.add_track(FakeTrack {
        id: TrackId::parse("c1-f0").unwrap(),
        owner: owner.clone(),
        segments: vec![seg.clone()],
        person: None,
        hidden: false,
    });
    app.people.add_speaker(FakeSpeaker {
        id: SpeakerId::parse("c1-p0").unwrap(),
        owner,
        segments: vec![seg],
        label: "A".into(),
        name: None,
    });
}

#[tokio::test]
async fn search_answers_the_agreed_shape_even_when_the_models_fail() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;

    let (status, _, body) = app
        .send(post_json(
            "/api/search",
            Some(&cookie),
            r#"{"query":"Dog on Sofa"}"#,
        ))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        r#"{"rewritten":{"keywords":["dog","on","sofa"],"filters":{"people":[],"speakers":[],"place":null,"from":null,"to":null,"min_quality":null}},"results":[],"reranked":false}"#
    );
}

#[tokio::test]
async fn an_empty_query_or_a_bad_name_is_400_validation_failed() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    seed(&app);

    let (s1, _, b1) = app
        .send(post_json("/api/search", Some(&cookie), r#"{"query":"  "}"#))
        .await;
    let (s2, _, b2) = app
        .send(put_json("/api/tracks/c1-f0", &cookie, r#"{"name":" "}"#))
        .await;
    let (s3, _, _) = app
        .send(put_json(
            "/api/speakers/c1-p0",
            &cookie,
            r#"{"display_name":""}"#,
        ))
        .await;

    assert_eq!(
        (s1, s2, s3),
        (
            StatusCode::BAD_REQUEST,
            StatusCode::BAD_REQUEST,
            StatusCode::BAD_REQUEST
        )
    );
    assert!(
        b1.contains(r#""code":"VALIDATION_FAILED""#)
            && b2.contains(r#""code":"VALIDATION_FAILED""#)
    );
}

#[tokio::test]
async fn naming_a_track_returns_the_track_and_feeds_autocomplete() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    seed(&app);

    let (status, _, body) = app
        .send(put_json(
            "/api/tracks/c1-f0",
            &cookie,
            r#"{"name":" Sam "}"#,
        ))
        .await;
    let (_, _, people) = app.send(get("/api/people?prefix=sa", Some(&cookie))).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        r#"{"track_id":"c1-f0","crop_url":"https://signed/users/id-1/faces/c1/c1-f0.jpg?ttl=3600","first_s":0.0,"last_s":1.0,"person_name":"Sam","hidden":false}"#
    );
    assert_eq!(people, r#"[{"person_id":"id-2","name":"Sam"}]"#);
}

#[tokio::test]
async fn hiding_a_track_and_renaming_a_speaker_answer_their_rows() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    seed(&app);

    let (_, _, track) = app
        .send(put_json("/api/tracks/c1-f0", &cookie, r#"{"hidden":true}"#))
        .await;
    let (status, _, speaker) = app
        .send(put_json(
            "/api/speakers/c1-p0",
            &cookie,
            r#"{"display_name":"Mia"}"#,
        ))
        .await;

    assert!(
        track.ends_with(r#""person_name":null,"hidden":true}"#),
        "{track}"
    );
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        speaker,
        r#"{"speaker_id":"c1-p0","label":"A","display_name":"Mia"}"#
    );
}

#[tokio::test]
async fn another_users_track_or_speaker_is_403_and_an_unknown_one_404() {
    let app = TestApp::new();
    signed_in(&app).await;
    seed(&app);
    let mallory = app.cookie_for("mallory");

    let (s1, _, _) = app
        .send(put_json("/api/tracks/c1-f0", &mallory, r#"{"name":"X"}"#))
        .await;
    let (s2, _, _) = app
        .send(put_json(
            "/api/speakers/c1-p0",
            &mallory,
            r#"{"display_name":"X"}"#,
        ))
        .await;
    let (s3, _, _) = app
        .send(put_json("/api/tracks/nope", &mallory, r#"{"name":"X"}"#))
        .await;

    assert_eq!(
        (s1, s2, s3),
        (
            StatusCode::FORBIDDEN,
            StatusCode::FORBIDDEN,
            StatusCode::NOT_FOUND
        )
    );
}

#[tokio::test]
async fn costs_sum_the_ledger_per_model() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;
    let call = |id: &str, model: &str, cost_usd: f64| ModelCall {
        id: id.into(),
        at: "t".into(),
        model: model.into(),
        purpose: "p".into(),
        input_hash: "h".into(),
        usage: Some(Usage::Frames(50)),
        cost_usd,
        latency_ms: 1,
        cache_hit: false,
        error: None,
    };
    for c in [
        call("1", "sam-3.1", 0.01),
        call("2", "muse-spark-1.3", 0.25),
        call("3", "muse-spark-1.3", 0.25),
    ] {
        app.ledger.record(&c).await.unwrap();
    }

    let (_, _, body) = app.send(get("/api/costs", Some(&cookie))).await;

    assert_eq!(
        body,
        r#"{"total_usd":0.51,"by_model":[{"model":"muse-spark-1.3","calls":2,"cost_usd":0.5},{"model":"sam-3.1","calls":1,"cost_usd":0.01}]}"#
    );
}

#[tokio::test]
async fn logout_is_204_and_clears_the_cookie() {
    let app = TestApp::new();
    let cookie = signed_in(&app).await;

    let (status, headers, body) = app
        .send(post_json("/api/session/logout", Some(&cookie), ""))
        .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(body.is_empty());
    let set = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(
        set.starts_with("nb_session=;") && set.contains("Max-Age=0"),
        "{set}"
    );
}

#[tokio::test]
async fn the_new_endpoints_need_a_cookie() {
    let app = TestApp::new();
    let requests = [
        post_json("/api/search", None, r#"{"query":"x"}"#),
        get("/api/people?prefix=a", None),
        get("/api/costs", None),
    ];
    for req in requests {
        let uri = req.uri().to_string();
        assert_eq!(app.send(req).await.0, StatusCode::UNAUTHORIZED, "{uri}");
    }
}
