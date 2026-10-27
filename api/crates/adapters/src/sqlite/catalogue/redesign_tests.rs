//! Titles, last views, named faces on candidates and the people overview on SQLite.

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::{PersonId, SegmentId, TrackId};
use nimbytes_core::domain::search::FaceSeen;
use nimbytes_core::domain::segment::TrackRow;
use nimbytes_core::ports::{Catalogue, PeopleStore, TrackUpdate};

use super::SqliteCatalogue;
use super::views_tests::fixture;

fn face(n: u32, max_area: f64) -> TrackRow {
    TrackRow {
        id: TrackId::parse(format!("c1-f{n}")).unwrap(),
        ordinal: n,
        first_s: 1.0,
        last_s: 3.0,
        crop_key: format!("users/u1/faces/c1/c1-f{n}.jpg"),
        max_area,
    }
}

/// Tracks f0 (small) and f1 (big) named Ana, f2 named Ben but hidden, f3 unnamed; all in s0.
async fn faces(cat: &SqliteCatalogue, user: &nimbytes_core::domain::ids::UserId) {
    let clip = nimbytes_core::domain::ids::ClipId::parse("c1").unwrap();
    let s0 = SegmentId::parse("c1-s0").unwrap();
    let rows = [face(0, 0.01), face(1, 0.05), face(2, 0.09), face(3, 0.02)];
    let links: Vec<_> = rows.iter().map(|r| (r.id.clone(), s0.clone())).collect();
    cat.replace_face_tracks(&clip, &rows, &links).await.unwrap();
    let ana = cat
        .upsert_person(user, &PersonId::parse("p-ana").unwrap(), "Ana")
        .await
        .unwrap();
    let ben = cat
        .upsert_person(user, &PersonId::parse("p-ben").unwrap(), "Ben")
        .await
        .unwrap();
    let name = |person, hidden| TrackUpdate {
        person: Some(person),
        hidden,
    };
    for (n, update) in [
        (0, name(ana.clone(), None)),
        (1, name(ana, None)),
        (2, name(ben, Some(true))),
    ] {
        let id = TrackId::parse(format!("c1-f{n}")).unwrap();
        cat.update_track(&id, &update).await.unwrap();
    }
}

#[tokio::test]
async fn titles_and_last_views_are_stored_and_untitled_ready_clips_listed() {
    let (cat, _, _, clip) = fixture().await;
    cat.set_clip_status(&clip, ClipStatus::Ready, None)
        .await
        .unwrap();
    assert_eq!(
        cat.untitled_ready().await.unwrap(),
        std::slice::from_ref(&clip)
    );

    cat.set_title(&clip, "Latte pour").await.unwrap();
    cat.mark_viewed(&clip, "2026-10-27T05:00:00.000Z")
        .await
        .unwrap();

    let stored = cat.get_clip(&clip).await.unwrap().unwrap();
    assert_eq!(stored.title.as_deref(), Some("Latte pour"));
    assert_eq!(
        stored.last_viewed_at.as_deref(),
        Some("2026-10-27T05:00:00.000Z")
    );
    assert!(cat.untitled_ready().await.unwrap().is_empty());
}

#[tokio::test]
async fn candidates_carry_the_clip_title_and_named_visible_faces_biggest_first() {
    let (cat, _, user, clip) = fixture().await;
    faces(&cat, &user).await;
    let s0 = SegmentId::parse("c1-s0").unwrap();

    let before = cat
        .candidates(&user, std::slice::from_ref(&s0))
        .await
        .unwrap();
    cat.set_title(&clip, "Latte pour").await.unwrap();
    let after = cat
        .candidates(&user, std::slice::from_ref(&s0))
        .await
        .unwrap();

    assert_eq!(
        before[0].clip_title, "a",
        "file name without extension until titled"
    );
    assert_eq!(after[0].clip_title, "Latte pour");
    let crop = |n: u32| Some(format!("users/u1/faces/c1/c1-f{n}.jpg"));
    assert_eq!(
        after[0].faces,
        [
            FaceSeen {
                name: "Ana".into(),
                crop_key: crop(1)
            },
            FaceSeen {
                name: "Ana".into(),
                crop_key: crop(0)
            },
        ],
        "hidden Ben and the unnamed track are left out"
    );
}

#[tokio::test]
async fn the_overview_counts_clips_per_person_lists_unnamed_and_counts_hidden() {
    let (cat, _, user, _) = fixture().await;
    faces(&cat, &user).await;

    let o = cat.overview(&user).await.unwrap();

    let mut people: Vec<(String, u32, Option<String>)> = o
        .people
        .iter()
        .map(|p| (p.name.clone(), p.clip_count, p.crop_key.clone()))
        .collect();
    people.sort();
    assert_eq!(
        people,
        [
            ("Ana".into(), 1, Some("users/u1/faces/c1/c1-f1.jpg".into())),
            ("Ben".into(), 0, None),
        ]
    );
    let unnamed: Vec<&str> = o.unnamed.iter().map(|u| u.track_id.as_str()).collect();
    assert_eq!(unnamed, ["c1-f3"]);
    assert_eq!(
        (o.unnamed[0].clip.filename.as_str(), o.unnamed[0].first_s),
        ("a.mov", 1.0)
    );
    let hidden: Vec<&str> = o.hidden.iter().map(|h| h.track_id.as_str()).collect();
    assert_eq!(
        hidden,
        ["c1-f2"],
        "hidden Ben is listed so he can be unhidden"
    );
    let stranger = nimbytes_core::domain::ids::UserId::parse("u9").unwrap();
    let none = cat.overview(&stranger).await.unwrap();
    assert!(none.people.is_empty() && none.unnamed.is_empty() && none.hidden.is_empty());
}
