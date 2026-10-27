//! Storage, people overview, shorts list and the clip's last view over fakes: exact wire shapes.

use axum::http::StatusCode;
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::critique::Verdict;
use nimbytes_core::domain::ids::{ClipId, PersonId, ShortId, TrackId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::people::{FaceRow, PeopleOverviewRows, PersonRow};
use nimbytes_core::ports::ShortStore;
use nimbytes_testkit::shorts_world::{critique, moment, timeline, user};

use super::test_support::{TestApp, get, post_json};

fn clip(id: &str, owner: &str, (size, created): (u64, &str), title: Option<&str>) -> Clip {
    Clip {
        id: ClipId::parse(id).unwrap(),
        user_id: UserId::parse(owner).unwrap(),
        filename: "IMG_7.MOV".into(),
        ext: MediaExt::Mov,
        size_bytes: size,
        status: ClipStatus::Ready,
        probe: None,
        created_at: created.into(),
        title: title.map(str::to_owned),
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    }
}

#[tokio::test]
async fn storage_splits_the_owners_originals_into_frequent_and_resting() {
    let app = TestApp::new();
    let old = clip("c1", "u1", (100, "2026-08-01T00:00:00.000Z"), None);
    let new = clip("c2", "u1", (40, "2026-10-26T00:00:00.000Z"), None);
    let theirs = clip("c3", "u2", (999, "2026-10-26T00:00:00.000Z"), None);
    for c in [old, new, theirs] {
        app.catalogue.put_clip(c);
    }

    let (status, _, body) = app
        .send(get("/api/storage", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        r#"{"cloud_bytes":140,"phone_bytes":0,"frequent_bytes":40,"resting_bytes":100,"clip_count":2}"#
    );
    let (status, _, _) = app.send(get("/api/storage", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn opening_a_clip_records_the_view_and_another_users_clip_does_not() {
    let app = TestApp::new();
    app.catalogue.put_clip(clip(
        "c1",
        "u1",
        (1, "2026-08-01T00:00:00.000Z"),
        Some("Beach walk"),
    ));

    let (other, _, _) = app
        .send(get("/api/clips/c1", Some(&app.cookie_for("u2"))))
        .await;
    let id = ClipId::parse("c1").unwrap();
    let unseen = app.catalogue.clip(&id).unwrap().last_viewed_at;
    let (status, _, body) = app
        .send(get("/api/clips/c1", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!((other, unseen), (StatusCode::FORBIDDEN, None));
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains(r#""filename":"IMG_7.MOV","title":"Beach walk""#),
        "{body}"
    );
    let viewed = app.catalogue.clip(&id).unwrap().last_viewed_at;
    assert_eq!(viewed.as_deref(), Some("2026-10-27T01:02:03.456Z"));
}

pub(super) fn overview_rows() -> PeopleOverviewRows {
    let person = |id: &str, name: &str, clips: u32| PersonRow {
        id: PersonId::parse(id).unwrap(),
        name: name.into(),
        clip_count: clips,
        crop_key: Some(format!("users/u1/faces/c1/{id}.jpg")),
    };
    let face = |track: &str, (clip_id, created): (&str, &str), title: Option<&str>| FaceRow {
        track_id: TrackId::parse(track).unwrap(),
        clip: clip(clip_id, "u1", (1, created), title),
        first_s: 4.0,
        last_s: 6.0,
        crop_key: title.map(|_| format!("users/u1/faces/{clip_id}/{track}.jpg")),
    };
    PeopleOverviewRows {
        people: vec![person("p1", "Ben", 1), person("p2", "Ana", 3)],
        unnamed: vec![face("c1-f3", ("c1", "2026-10-26T00:00:00.000Z"), None)],
        hidden: vec![
            face("c0-f1", ("c0", "2026-10-01T00:00:00.000Z"), None),
            face(
                "c2-f0",
                ("c2", "2026-10-26T09:00:00.000Z"),
                Some("Beach walk"),
            ),
        ],
    }
}

#[tokio::test]
async fn the_people_overview_answers_the_agreed_shape_in_screen_order() {
    let app = TestApp::new();
    app.people.set_overview(overview_rows());

    let (status, _, body) = app
        .send(get("/api/people/overview", Some(&app.cookie_for("u1"))))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        concat!(
            r#"{"people":[{"person_id":"p2","name":"Ana","clip_count":3,"#,
            r#""crop_url":"https://signed/users/u1/faces/c1/p2.jpg?ttl=3600"},"#,
            r#"{"person_id":"p1","name":"Ben","clip_count":1,"#,
            r#""crop_url":"https://signed/users/u1/faces/c1/p1.jpg?ttl=3600"}],"#,
            r#""unnamed":[{"track_id":"c1-f3","clip_id":"c1","clip_title":"IMG_7","#,
            r#""recorded_at":null,"on_screen_s":3.0,"crop_url":null,"group_id":null,"suggested":null}],"#,
            r#""hidden":[{"track_id":"c2-f0","clip_id":"c2","clip_title":"Beach walk","#,
            r#""recorded_at":null,"crop_url":"https://signed/users/u1/faces/c2/c2-f0.jpg?ttl=3600"},"#,
            r#"{"track_id":"c0-f1","clip_id":"c0","clip_title":"IMG_7","recorded_at":null,"#,
            r#""crop_url":null}],"hidden_count":2}"#
        )
    );
    let (status, _, _) = app.send(get("/api/people/overview", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_shorts_list_answers_the_agreed_shape() {
    let app = TestApp::new();
    app.shorts
        .add_moment(moment("s0", "c1", (0.0, 8.0), None), &user("u1"));
    let cookie = app.cookie_for("u1");
    let create = r#"{"prompt":"calm","segment_ids":["s0"],"aspect":"1:1","target_s":6}"#;
    app.send(post_json("/api/shorts", Some(&cookie), create))
        .await;
    let id = ShortId::parse("id-1").unwrap();
    app.shorts
        .add_version(&id, 1, &timeline(&[("s0", 1.0, 4.0)]))
        .await
        .unwrap();
    let scored = critique(9, 0, Verdict::Accept).settled(1);
    app.shorts.set_critique(&id, 1, &scored).await.unwrap();

    let (status, _, body) = app.send(get("/api/shorts", Some(&cookie))).await;
    let (theirs, _, other) = app
        .send(get("/api/shorts", Some(&app.cookie_for("u2"))))
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        concat!(
            r#"[{"short_id":"id-1","prompt":"calm","aspect":"1:1","target_s":6.0,"#,
            r#""status":"planning","created_at":"2026-10-27T01:02:03.456Z","version_count":1,"#,
            r#""best_score":29.0,"thumb_url":"https://signed/users/u1/thumbs/c1/s0.jpg?ttl=3600"}]"#
        )
    );
    assert_eq!((theirs, other.as_str()), (StatusCode::OK, "[]"));
}
