//! Muse Image routes over fakes: cover redraw, styled covers, the cover title and project key
//! art; wire shapes, validation, the 9-cover cap and ownership.

use axum::http::StatusCode;
use nimbytes_core::domain::export::Platform;
use nimbytes_core::domain::ids::{ProjectId, ShortId};
use nimbytes_core::domain::project::{Project, ProjectColor};
use nimbytes_core::ports::{ProjectStore, ShortStore};
use nimbytes_testkit::publish_world::export_with_covers;
use nimbytes_testkit::shorts_world::{moment, timeline, user};
use serde_json::Value;

use super::test_support::{TestApp, get, post_json, put_json};

/// A short `id-1` of u1 with version 1, and its Reels export with `covers` covers; returns the
/// app, u1's cookie and the short.
pub(super) async fn published(covers: u32) -> (TestApp, String, ShortId) {
    let app = TestApp::with_publishing();
    app.shorts
        .add_moment(moment("s0", "c1", (0.0, 8.0), None), &user("u1"));
    let cookie = app.cookie_for("u1");
    let create = r#"{"prompt":"calm","segment_ids":["s0"],"aspect":"4:5","target_s":6}"#;
    let (status, _, _) = app
        .send(post_json("/api/shorts", Some(&cookie), create))
        .await;
    assert_eq!(status, StatusCode::OK);
    let id = ShortId::parse("id-1").unwrap();
    let v1 = timeline(&[("s0", 1.0, 4.0)]);
    app.shorts.add_version(&id, 1, &v1).await.unwrap();
    app.exports
        .put(export_with_covers(&id, Platform::Reels, covers));
    (app, cookie, id)
}

pub(super) fn code_of(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap();
    v["error"]["code"].as_str().unwrap_or_default().to_owned()
}

#[tokio::test]
async fn a_redraw_starts_for_the_owner_and_is_refused_at_the_cap_or_with_bad_words() {
    let (app, cookie, _) = published(3).await;
    let uri = "/api/shorts/id-1/exports/reels/covers/1/redraw";

    let other = app.cookie_for("u2");
    let (status, _, body) = app
        .send(post_json(
            uri,
            Some(&other),
            r#"{"instruction":"golden hour"}"#,
        ))
        .await;
    assert_eq!(
        (status, code_of(&body).as_str()),
        (StatusCode::FORBIDDEN, "FORBIDDEN")
    );

    let (status, _, body) = app
        .send(post_json(
            uri,
            Some(&cookie),
            r#"{"instruction":"golden hour"}"#,
        ))
        .await;
    assert_eq!(
        (status, body.as_str()),
        (StatusCode::ACCEPTED, r#"{"started":true}"#)
    );

    let (app, cookie, _) = published(9).await;
    for (uri, body) in [
        (uri, r#"{"instruction":"golden hour"}"#),
        (uri, r#"{"instruction":"no"}"#),
        (uri, r#"{"instruction":"golden hour","x":1}"#),
        (
            "/api/shorts/id-1/exports/reels/covers/12/redraw",
            r#"{"instruction":"golden"}"#,
        ),
    ] {
        let (status, _, reply) = app.send(post_json(uri, Some(&cookie), body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri} {body}: {reply}");
        assert_eq!(code_of(&reply), "VALIDATION_FAILED");
    }
}

#[tokio::test]
async fn more_covers_take_an_optional_pickable_style() {
    let (app, cookie, _) = published(3).await;
    let uri = "/api/shorts/id-1/exports/reels/covers";
    for (body, want) in [
        (r#"{"style":"key_art"}"#, StatusCode::BAD_REQUEST),
        (r#"{"style":"neon"}"#, StatusCode::BAD_REQUEST),
    ] {
        let (status, _, reply) = app.send(post_json(uri, Some(&cookie), body)).await;
        assert_eq!(status, want, "{body}: {reply}");
        assert_eq!(code_of(&reply), "VALIDATION_FAILED");
    }
    let (status, _, _) = app
        .send(post_json(uri, Some(&cookie), r#"{"style":"illustrated"}"#))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
}

#[tokio::test]
async fn more_covers_without_a_body_still_start() {
    let (app, cookie, _) = published(3).await;
    let req = axum::http::Request::post("/api/shorts/id-1/exports/reels/covers")
        .header(axum::http::header::COOKIE, &cookie)
        .body(axum::body::Body::empty())
        .unwrap();
    let (status, _, body) = app.send(req).await;
    assert_eq!(
        (status, body.as_str()),
        (StatusCode::ACCEPTED, r#"{"started":true}"#)
    );
}

#[tokio::test]
async fn the_exports_list_carries_cover_tiles_the_title_and_the_published_cover() {
    let (app, cookie, _) = published(2).await;

    let (status, _, body) = app
        .send(get("/api/shorts/id-1/exports", Some(&cookie)))
        .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    let v: Value = serde_json::from_str(&body).unwrap();
    let reels = &v["exports"][0];
    assert_eq!(reels["covers"][1]["style"], "close_detail");
    assert!(reels["covers"][1]["instruction"].is_null());
    assert_eq!(
        reels["cover_title"],
        serde_json::json!({"text": "Nap champion of the street", "show": true, "position": "bottom"})
    );
    assert!(reels["download_cover_url"].is_null(), "the still is baking");
    assert!(reels.get("cover_urls").is_none());
}

#[tokio::test]
async fn a_cover_title_is_validated_and_saved() {
    let (app, cookie, id) = published(2).await;
    let uri = "/api/shorts/id-1/exports/reels";
    let long = format!(
        r#"{{"cover_title":{{"text":"{}","show":true,"position":"top"}}}}"#,
        "x".repeat(33)
    );
    let (status, _, body) = app.send(put_json(uri, &cookie, &long)).await;
    assert_eq!(
        (status, code_of(&body).as_str()),
        (StatusCode::BAD_REQUEST, "VALIDATION_FAILED")
    );

    let ok = r#"{"cover_title":{"text":"Nap champ","show":false,"position":"top"}}"#;
    let (status, _, _) = app.send(put_json(uri, &cookie, ok)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let row = app.exports.row(&id, Platform::Reels).unwrap();
    assert_eq!(row.cover_title.unwrap().text, "Nap champ");
}

#[tokio::test]
async fn project_art_is_the_owners_and_projects_carry_their_art_fields() {
    let app = TestApp::with_publishing();
    let p = Project {
        id: ProjectId::parse("pr1").unwrap(),
        user_id: user("u1"),
        name: "Tokyo".into(),
        color: ProjectColor::Blue,
        created_at: "t".into(),
        updated_at: "t".into(),
    };
    app.projects.create(&p, &[]).await.unwrap();
    let cookie = app.cookie_for("u1");

    let other = app.cookie_for("u2");
    let (status, _, _) = app
        .send(post_json("/api/projects/pr1/art", Some(&other), ""))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = app
        .send(post_json("/api/projects/pr1/art", Some(&cookie), ""))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let (_, _, body) = app.send(get("/api/projects", Some(&cookie))).await;
    let v: Value = serde_json::from_str(&body).unwrap();
    assert!(v[0]["art_url"].is_null());
    assert!(v[0]["art_drawing"].is_boolean());
    assert_eq!(v[0]["art_sources"], serde_json::json!([]));
}
