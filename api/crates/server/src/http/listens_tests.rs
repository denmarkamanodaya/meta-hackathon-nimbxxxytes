//! iListen handlers over fakes: status codes, the exact wire shapes (every key present, `null`
//! for empty), `VALIDATION_FAILED`, `NOT_FOUND` and `FORBIDDEN` on another user's listen for every
//! route, and a source body past the default 2 MB limit streamed through.

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use nimbytes_core::domain::ids::{ListenId, UserId};
use nimbytes_core::domain::listen::{
    Draft, HeardShare, LineScore, Listen, ListenSource, ListenStart, ListenStatus, ListenTurn,
    ListenVersion, Scored,
};
use nimbytes_core::keys::ObjectKey;
use serde_json::{Value, json};

use super::test_support::{TestApp, delete, get, patch_json, post_json};

const AT: &str = "2026-10-30T01:00:00.000Z";

fn start(source: ListenSource) -> ListenStart {
    let file = source == ListenSource::File;
    ListenStart {
        source,
        clip_id: None,
        source_name: "meeting.m4a".into(),
        content_type: if file { "audio/x-m4a" } else { "" }.into(),
        ext: if file { "m4a" } else { "" }.into(),
        size_bytes: if file { 5_000 } else { 0 },
        target: "en".into(),
    }
}

fn listen(id: &str, status: ListenStatus) -> Listen {
    let id = ListenId::parse(id).unwrap();
    let user = UserId::parse("u1").unwrap();
    Listen::new((id, user), start(ListenSource::File), status, AT)
}

/// A ready, checked listen of two languages, v2 kept.
fn ready_listen() -> Listen {
    let mut l = listen("l1", ListenStatus::Ready);
    l.title = "Meeting at 10".into();
    l.summary = "B confirms 10 AM.".into();
    l.key_points = vec!["10 AM".into()];
    let share = |code: &str, share| HeardShare {
        code: code.into(),
        share,
    };
    l.languages = vec![share("zh", 57), share("ja", 43)];
    (l.duration_ms, l.speakers, l.version) = (Some(26_160), 2, 2);
    (l.confidence, l.passed) = (Some(97), true);
    l.summary_audio_key = Some(ObjectKey::from_stored(
        "users/u1/listens/l1/voice_ab.wav".into(),
    ));
    l
}

/// Its two lines; line 1 was fixed in v2.
fn ready_turns() -> Vec<ListenTurn> {
    let mut a = ListenTurn::heard(0, (0, 4_460), Some("A".into()), "几点开始？");
    (a.lang, a.translation, a.score) = ("zh".into(), "What time?".into(), Some(100));
    let mut b = ListenTurn::heard(1, (5_340, 10_620), Some("B".into()), "午前十時です。");
    (b.lang, b.translation, b.score, b.fixed_in) = ("ja".into(), "At 10 AM.".into(), Some(97), 2);
    vec![a, b]
}

/// Version `n` whose line 1 scored `line_1`.
fn version(n: u32, line_1: u32, issue: &str) -> ListenVersion {
    let line = |index, score, issue: &str| LineScore {
        index,
        score,
        issue: issue.into(),
    };
    ListenVersion {
        version: n,
        draft: Draft::default(),
        check: Some(Scored {
            lines: vec![line(0, 100, ""), line(1, line_1, issue)],
            summary_score: 98,
            summary_issues: Vec::new(),
            confidence: line_1,
            passed: line_1 >= 90,
        }),
    }
}

/// u1 owns the ready l1 and l2, still uploading.
fn app() -> (TestApp, String, String) {
    let app = TestApp::new();
    let versions = vec![
        version(1, 30, "11 AM instead of 10 AM."),
        version(2, 97, ""),
    ];
    app.listens.put(ready_listen(), ready_turns(), versions);
    app.listens.put(
        listen("l2", ListenStatus::Uploading),
        Vec::new(),
        Vec::new(),
    );
    let (mine, theirs) = (app.cookie_for("u1"), app.cookie_for("u2"));
    (app, mine, theirs)
}

fn code(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap();
    v["error"]["code"].as_str().unwrap_or_default().to_owned()
}

fn json_of(body: &str) -> Value {
    serde_json::from_str(body).unwrap()
}

fn ready_row() -> Value {
    json!({
        "id": "l1", "title": "Meeting at 10", "source_name": "meeting.m4a",
        "source_kind": "file", "clip_id": null, "status": "ready", "step": null, "version": 2,
        "target": "en", "languages": [{"code": "zh", "share": 57}, {"code": "ja", "share": 43}],
        "duration_ms": 26160, "speakers": 2, "confidence": 97, "passed": true,
        "created_at": AT, "error": null
    })
}

#[tokio::test]
async fn creating_a_file_listen_answers_201_uploading_and_refuses_bad_input() {
    let (app, cookie, _) = app();
    let ok = r#"{"filename":"talk.mp3","content_type":"audio/mpeg","size_bytes":5000,"clip_id":null,"target":"zh"}"#;

    let (status, _, body) = app.send(post_json("/api/listens", Some(&cookie), ok)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"listen_id": "l-1", "status": "uploading"})
    );
    for bad in [
        ok.replace("audio/mpeg", "image/png"),
        ok.replace("\"zh\"", "\"xx\""),
        ok.replace("5000", "null"),
        ok.replace("talk.mp3", "talk.exe"),
    ] {
        let (s, _, b) = app
            .send(post_json("/api/listens", Some(&cookie), &bad))
            .await;
        assert_eq!(
            (s, code(&b).as_str()),
            (StatusCode::BAD_REQUEST, "VALIDATION_FAILED"),
            "{bad}"
        );
    }
    let (anon, _, _) = app.send(post_json("/api/listens", None, ok)).await;
    assert_eq!(anon, StatusCode::UNAUTHORIZED);
    assert!(
        app.jobs.all().is_empty(),
        "nothing queued before the upload"
    );
}

#[tokio::test]
async fn creating_a_clip_listen_answers_listening_and_refuses_another_users_clip() {
    let (app, cookie, other) = app();
    let mut clip =
        nimbytes_testkit::world::clip(Some(nimbytes_testkit::world::probe(26.0, true))).unwrap();
    clip.title = Some("Team call".into());
    app.catalogue.put_clip(clip);
    let body =
        r#"{"filename":null,"content_type":null,"size_bytes":null,"clip_id":"c1","target":"en"}"#;

    let (foreign, _, foreign_body) = app
        .send(post_json("/api/listens", Some(&other), body))
        .await;
    let (status, _, made) = app
        .send(post_json("/api/listens", Some(&cookie), body))
        .await;

    assert_eq!(
        (foreign, code(&foreign_body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );
    assert_eq!(status, StatusCode::CREATED, "{made}");
    assert_eq!(
        json_of(&made),
        json!({"listen_id": "l-1", "status": "listening"})
    );
    assert_eq!(app.jobs.all().len(), 1, "one listen job");
}

/// `PUT /api/listens/{id}/source` with a raw body.
fn source_put(id: &str, cookie: &str, content_type: Option<&str>, bytes: Vec<u8>) -> Request<Body> {
    let mut req = Request::put(format!("/api/listens/{id}/source")).header(header::COOKIE, cookie);
    if let Some(t) = content_type {
        req = req.header(header::CONTENT_TYPE, t);
    }
    req.body(Body::from(bytes)).unwrap()
}

#[tokio::test]
async fn the_source_streams_past_the_default_limit_and_queues_the_job() {
    let (app, cookie, _) = app();
    let three_mb = vec![7u8; 3 * 1024 * 1024];

    let req = source_put("l2", &cookie, Some("audio/x-m4a"), three_mb);
    let (status, _, body) = app.send(req).await;

    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"listen_id": "l2", "status": "listening"})
    );
    assert_eq!(
        app.blobs.puts(),
        [(
            "users/u1/listens/l2/source.m4a".to_owned(),
            "audio/x-m4a".to_owned()
        )]
    );
    let written = app.scratch.written();
    assert_eq!(written.last().unwrap().1.len(), 3 * 1024 * 1024);
    assert_eq!(app.jobs.all().len(), 1);
}

#[tokio::test]
async fn the_source_refuses_a_bad_type_an_empty_body_another_user_and_a_missing_listen() {
    let (app, cookie, other) = app();
    for req in [
        source_put("l2", &cookie, Some("text/plain"), b"x".to_vec()),
        source_put("l2", &cookie, None, b"x".to_vec()),
        source_put("l2", &cookie, Some("audio/mpeg"), Vec::new()),
    ] {
        let (status, _, body) = app.send(req).await;
        assert_eq!(
            (status, code(&body).as_str()),
            (StatusCode::BAD_REQUEST, "VALIDATION_FAILED"),
            "{body}"
        );
    }
    let (status, _, _) = app
        .send(source_put("l2", &other, Some("audio/mpeg"), b"x".to_vec()))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = app
        .send(source_put(
            "nope",
            &cookie,
            Some("audio/mpeg"),
            b"x".to_vec(),
        ))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(app.blobs.puts().is_empty() && app.jobs.all().is_empty());
}

#[tokio::test]
async fn completing_needs_the_file_and_then_answers_202_listening() {
    let (app, cookie, other) = app();
    let uri = "/api/listens/l2/complete";

    let (early, _, early_body) = app.send(post_json(uri, Some(&cookie), "")).await;
    app.blobs.store("users/u1/listens/l2/source.m4a", 5_000);
    let (foreign, _, _) = app.send(post_json(uri, Some(&other), "")).await;
    let (status, _, body) = app.send(post_json(uri, Some(&cookie), "")).await;

    assert_eq!(
        (early, code(&early_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(foreign, StatusCode::FORBIDDEN);
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(
        json_of(&body),
        json!({"listen_id": "l2", "status": "listening"})
    );
}

#[tokio::test]
async fn the_list_shows_every_key_newest_first_and_only_the_owners() {
    let (app, cookie, other) = app();
    let (status, _, body) = app.send(get("/api/listens", Some(&cookie))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = json_of(&body);
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    let ready = rows.iter().find(|r| r["id"] == "l1").unwrap();
    assert_eq!(ready, &ready_row());
    let uploading = rows.iter().find(|r| r["id"] == "l2").unwrap();
    assert_eq!(
        (
            &uploading["title"],
            &uploading["confidence"],
            &uploading["duration_ms"]
        ),
        (&json!(""), &Value::Null, &Value::Null)
    );
    assert_eq!(uploading["languages"], json!([]));

    let (_, _, theirs) = app.send(get("/api/listens", Some(&other))).await;
    assert_eq!(json_of(&theirs), json!([]));
}

#[tokio::test]
async fn the_detail_flattens_the_row_with_summary_lines_versions_and_voice() {
    let (app, cookie, other) = app();
    let (status, _, body) = app.send(get("/api/listens/l1", Some(&cookie))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mut expected = ready_row();
    let extra = json!({
        "summary": "B confirms 10 AM.",
        "key_points": ["10 AM"],
        "turns": [
            {"index": 0, "start_ms": 0, "end_ms": 4460, "speaker": "A", "lang": "zh",
             "text": "几点开始？", "translation": "What time?", "score": 100, "issue": "",
             "fixed_in": 1},
            {"index": 1, "start_ms": 5340, "end_ms": 10620, "speaker": "B", "lang": "ja",
             "text": "午前十時です。", "translation": "At 10 AM.", "score": 97, "issue": "",
             "fixed_in": 2}
        ],
        "versions": [
            {"version": 1, "confidence": 30, "summary_score": 98, "passed": false,
             "notes": ["line 2: 11 AM instead of 10 AM."]},
            {"version": 2, "confidence": 97, "summary_score": 98, "passed": true, "notes": []}
        ],
        "summary_audio_url": "https://signed/users/u1/listens/l1/voice_ab.wav?ttl=3600"
    });
    for (k, v) in extra.as_object().unwrap() {
        expected[k] = v.clone();
    }
    assert_eq!(json_of(&body), expected);

    let (foreign, _, foreign_body) = app.send(get("/api/listens/l1", Some(&other))).await;
    assert_eq!(
        (foreign, code(&foreign_body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );
    let (missing, _, _) = app.send(get("/api/listens/nope", Some(&cookie))).await;
    assert_eq!(missing, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn renaming_answers_the_listen_and_refuses_an_empty_title_or_another_user() {
    let (app, cookie, other) = app();
    let (status, _, body) = app
        .send(patch_json(
            "/api/listens/l1",
            &cookie,
            r#"{"title":" Team  call "}"#,
        ))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(json_of(&body)["title"], "Team call");
    let (empty, _, _) = app
        .send(patch_json("/api/listens/l1", &cookie, r#"{"title":"  "}"#))
        .await;
    assert_eq!(empty, StatusCode::BAD_REQUEST);
    let (foreign, _, _) = app
        .send(patch_json("/api/listens/l1", &other, r#"{"title":"x"}"#))
        .await;
    assert_eq!(foreign, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_language_change_answers_listening_with_the_transcript_kept() {
    let (app, cookie, other) = app();
    let uri = "/api/listens/l1/language";

    let (foreign, _, _) = app
        .send(post_json(uri, Some(&other), r#"{"target":"ja"}"#))
        .await;
    let (bad, _, bad_body) = app
        .send(post_json(uri, Some(&cookie), r#"{"target":"xx"}"#))
        .await;
    let (status, _, body) = app
        .send(post_json(uri, Some(&cookie), r#"{"target":"ja"}"#))
        .await;

    assert_eq!(foreign, StatusCode::FORBIDDEN);
    assert_eq!(
        (bad, code(&bad_body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );
    assert_eq!(status, StatusCode::OK, "{body}");
    let v = json_of(&body);
    assert_eq!(
        (&v["status"], &v["target"]),
        (&json!("listening"), &json!("ja"))
    );
    assert_eq!(v["versions"], json!([]));
    assert_eq!(v["turns"][1]["text"], "午前十時です。");
    assert_eq!(v["turns"][1]["translation"], "");
    assert_eq!(v["summary_audio_url"], Value::Null);
    assert_eq!(app.jobs.all().len(), 1);
}

#[tokio::test]
async fn deleting_answers_204_then_404_and_refuses_another_user() {
    let (app, cookie, other) = app();
    let (foreign, _, _) = app.send(delete("/api/listens/l1", &other)).await;
    let (status, _, _) = app.send(delete("/api/listens/l1", &cookie)).await;
    let (again, _, _) = app.send(delete("/api/listens/l1", &cookie)).await;

    assert_eq!(foreign, StatusCode::FORBIDDEN);
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(again, StatusCode::NOT_FOUND);
    assert_eq!(
        app.blobs.deleted(),
        [
            "users/u1/listens/l1/source.m4a",
            "users/u1/listens/l1/audio.wav"
        ]
    );
}
