//! People, track names, speaker names and search candidates on SQLite.

use nimbytes_core::domain::ids::{PersonId, SegmentId, SpeakerId, TrackId, UserId};
use nimbytes_core::ports::{Catalogue, PeopleStore, TrackUpdate};

use nimbytes_core::domain::ids::ClipId;

use super::SqliteCatalogue;
use super::views_tests::{fixture, track};

fn pid(s: &str) -> PersonId {
    PersonId::parse(s).unwrap()
}

#[tokio::test]
async fn one_person_per_name_case_insensitive_and_prefix_search_escapes_wildcards() {
    let (cat, _pool, user, _clip) = fixture().await;

    let a = cat.upsert_person(&user, &pid("p1"), "Ana").await.unwrap();
    let again = cat.upsert_person(&user, &pid("p2"), "ana").await.unwrap();
    cat.upsert_person(&user, &pid("p3"), "50%_off")
        .await
        .unwrap();

    assert_eq!((a.as_str(), again.as_str()), ("p1", "p1"));
    let names =
        |v: Vec<nimbytes_core::ports::Person>| v.into_iter().map(|p| p.name).collect::<Vec<_>>();
    assert_eq!(
        names(cat.people_with_prefix(&user, "AN", 20).await.unwrap()),
        ["Ana"]
    );
    assert_eq!(
        names(cat.people_with_prefix(&user, "50%", 20).await.unwrap()),
        ["50%_off"]
    );
    assert!(
        cat.people_with_prefix(&user, "%", 20)
            .await
            .unwrap()
            .is_empty(),
        "% is literal"
    );
    assert!(
        cat.people_with_prefix(&UserId::parse("other").unwrap(), "", 20)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn track_updates_change_only_the_fields_sent_and_owner_and_segments_resolve() {
    let (cat, _pool, user, clip) = fixture().await;
    let s0 = SegmentId::parse("c1-s0").unwrap();
    cat.replace_face_tracks(&clip, &[track(0, 1.0)], &[(track(0, 1.0).id, s0.clone())])
        .await
        .unwrap();
    let id = TrackId::parse("c1-f0").unwrap();
    let p = cat.upsert_person(&user, &pid("p1"), "Sam").await.unwrap();

    cat.update_track(
        &id,
        &TrackUpdate {
            person: Some(p),
            hidden: None,
        },
    )
    .await
    .unwrap();
    cat.update_track(
        &id,
        &TrackUpdate {
            person: None,
            hidden: Some(true),
        },
    )
    .await
    .unwrap();

    let t = cat.track(&id).await.unwrap().unwrap();
    assert_eq!((t.person_name.as_deref(), t.hidden), (Some("Sam"), true));
    assert_eq!(cat.track_owner(&id).await.unwrap(), Some(user.clone()));
    assert_eq!(
        cat.track_owner(&TrackId::parse("nope").unwrap())
            .await
            .unwrap(),
        None
    );
    assert_eq!(cat.track_segments(&id).await.unwrap(), [s0]);
    assert_eq!(cat.known_names(&user).await.unwrap().0, ["Sam"]);
}

#[tokio::test]
async fn speakers_rename_list_their_segments_and_become_known_names() {
    let (cat, _pool, user, _clip) = fixture().await;
    let id = SpeakerId::parse("c1-p0").unwrap();

    cat.rename_speaker(&id, "Mia").await.unwrap();

    let s = cat.speaker(&id).await.unwrap().unwrap();
    assert_eq!(
        (s.label.as_str(), s.display_name.as_deref()),
        ("A", Some("Mia"))
    );
    assert_eq!(
        cat.speaker_segments(&id).await.unwrap(),
        [SegmentId::parse("c1-s0").unwrap()]
    );
    assert_eq!(cat.speaker_owner(&id).await.unwrap(), Some(user.clone()));
    assert_eq!(cat.known_names(&user).await.unwrap().1, ["Mia"]);
}

/// Ana (visible) and Ben (hidden) in segment 0; the speaker is named Mia.
async fn ana_and_hidden_ben(
    cat: &SqliteCatalogue,
    pool: &sqlx::SqlitePool,
    user: &UserId,
    clip: &ClipId,
) {
    let s0 = SegmentId::parse("c1-s0").unwrap();
    let links = [
        (track(0, 1.0).id, s0.clone()),
        (track(1, 1.0).id, s0.clone()),
    ];
    cat.replace_face_tracks(clip, &[track(0, 1.0), track(1, 1.0)], &links)
        .await
        .unwrap();
    for (t, name, hidden) in [("c1-f0", "Ana", false), ("c1-f1", "Ben", true)] {
        let p = cat
            .upsert_person(user, &pid(&format!("p-{name}")), name)
            .await
            .unwrap();
        let id = TrackId::parse(t).unwrap();
        cat.update_track(
            &id,
            &TrackUpdate {
                person: Some(p),
                hidden: Some(hidden),
            },
        )
        .await
        .unwrap();
    }
    sqlx::query("UPDATE speakers SET display_name = 'Mia'")
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn candidates_are_the_users_own_with_names_split_and_hidden_people_left_out() {
    let (cat, pool, user, clip) = fixture().await;
    let s0 = SegmentId::parse("c1-s0").unwrap();
    ana_and_hidden_ben(&cat, &pool, &user, &clip).await;

    let got = cat
        .candidates(&user, &[s0.clone(), SegmentId::parse("c1-s1").unwrap()])
        .await
        .unwrap();
    let theirs = cat
        .candidates(&UserId::parse("other").unwrap(), &[s0])
        .await
        .unwrap();

    assert_eq!(got.len(), 2);
    let c0 = got
        .iter()
        .find(|c| c.segment_id.as_str() == "c1-s0")
        .unwrap();
    assert_eq!(
        (c0.people.as_slice(), c0.speakers.as_slice()),
        (["Ana".to_owned()].as_slice(), ["Mia".to_owned()].as_slice())
    );
    assert_eq!(
        (
            c0.clip_filename.as_str(),
            c0.start_s,
            c0.end_s,
            c0.speech.as_str()
        ),
        ("a.mov", 0.0, 7.0, "with food.")
    );
    assert_eq!(c0.description, "A latte, poured.");
    assert!(theirs.is_empty());
    assert!(cat.candidates(&user, &[]).await.unwrap().is_empty());
}
