//! Naming tracks and speakers over fakes: one person per name, exact re-indexing, validation.

#![cfg(test)]

use std::time::Duration;

use nimbytes_core::domain::ids::{SegmentId, SpeakerId, TrackId, UserId};
use nimbytes_core::usecases::people::{
    PeopleDeps, TrackChange, change_track, rename_speaker, suggest_people,
};
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::world::{CLIP, IngestWorld, clip, probe};
use nimbytes_testkit::{FakeSpeaker, FakeTrack, InMemoryPeople, InMemoryTextIndex, SequentialIds};

fn u(id: &str) -> UserId {
    UserId::parse(id).unwrap()
}

fn seg(i: u32) -> SegmentId {
    SegmentId::parse(format!("{CLIP}-s{i}")).unwrap()
}

struct Naming {
    world: IngestWorld,
    people: InMemoryPeople,
    text: InMemoryTextIndex,
    ids: SequentialIds,
}

/// An ingested clip (3 segments) with two tracks and one speaker owned by u1.
async fn naming() -> Naming {
    let world = IngestWorld::new(probe(21.5, false), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();
    world.run_once().await.unwrap();
    let people = InMemoryPeople::default();
    for (n, segs) in [(0, vec![seg(1)]), (1, vec![seg(0), seg(2)])] {
        let id = TrackId::parse(format!("{CLIP}-f{n}")).unwrap();
        people.add_track(FakeTrack {
            id,
            owner: u("u1"),
            segments: segs,
            person: None,
            hidden: false,
        });
    }
    let sp = SpeakerId::parse(format!("{CLIP}-p0")).unwrap();
    people.add_speaker(FakeSpeaker {
        id: sp,
        owner: u("u1"),
        segments: vec![seg(2)],
        label: "A".into(),
        name: None,
    });
    Naming {
        world,
        people,
        text: InMemoryTextIndex::default(),
        ids: SequentialIds::new("person"),
    }
}

impl Naming {
    fn deps(&self) -> PeopleDeps<'_> {
        PeopleDeps {
            people: &self.people,
            catalogue: self.world.catalogue.as_ref(),
            text: &self.text,
            ids: &self.ids,
            blobs: self.world.blobs.as_ref(),
            url_ttl: Duration::from_secs(3600),
        }
    }

    async fn name(&self, track: u32, name: &str) -> Result<(), AppError> {
        let id = TrackId::parse(format!("{CLIP}-f{track}")).unwrap();
        let change = TrackChange {
            name: Some(name.into()),
            hidden: None,
        };
        change_track(&self.deps(), &u("u1"), &id, change)
            .await
            .map(drop)
    }

    fn reindexed(&self) -> Vec<String> {
        self.text
            .docs()
            .iter()
            .map(|d| d.segment_id.to_string())
            .collect()
    }
}

#[tokio::test]
async fn naming_two_tracks_the_same_makes_one_person_and_reindexes_exactly_their_segments() {
    let n = naming().await;

    n.name(0, "Sam").await.unwrap();
    n.name(1, "  sam ").await.unwrap();

    assert_eq!(
        n.people.all_people().len(),
        1,
        "one person per name, case-insensitive"
    );
    let mut docs = n.reindexed();
    docs.sort();
    assert_eq!(docs, ["c1-s0", "c1-s1", "c1-s2"]);
}

#[tokio::test]
async fn naming_one_track_touches_only_its_segments_and_returns_its_crop_url() {
    let n = naming().await;
    let id = TrackId::parse("c1-f0").unwrap();

    let (track, crop) = change_track(
        &n.deps(),
        &u("u1"),
        &id,
        TrackChange {
            name: Some("Ana".into()),
            hidden: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(n.reindexed(), ["c1-s1"]);
    assert_eq!(track.person_name.as_deref(), Some("Ana"));
    assert_eq!(
        crop.as_deref(),
        Some("https://signed/users/u1/faces/c1/c1-f0.jpg?ttl=3600")
    );
    assert_eq!(
        suggest_people(&n.people, &u("u1"), " an").await.unwrap()[0].name,
        "Ana"
    );
}

#[tokio::test]
async fn hiding_sets_the_flag_and_reindexes() {
    let n = naming().await;
    let id = TrackId::parse("c1-f1").unwrap();

    let (track, _) = change_track(
        &n.deps(),
        &u("u1"),
        &id,
        TrackChange {
            name: None,
            hidden: Some(true),
        },
    )
    .await
    .unwrap();

    assert!(track.hidden);
    assert_eq!(n.reindexed().len(), 2);
}

#[tokio::test]
async fn bad_requests_are_refused_before_anything_changes() {
    let n = naming().await;
    let id = TrackId::parse("c1-f0").unwrap();
    let code = |r: Result<_, AppError>| r.err().map(|e| e.code);

    assert_eq!(
        code(n.name(0, "   ").await),
        Some(ErrorCode::ValidationFailed)
    );
    assert_eq!(
        code(
            change_track(&n.deps(), &u("u1"), &id, TrackChange::default())
                .await
                .map(drop)
        ),
        Some(ErrorCode::ValidationFailed)
    );
    let other = change_track(
        &n.deps(),
        &u("mallory"),
        &id,
        TrackChange {
            name: Some("X".into()),
            hidden: None,
        },
    )
    .await;
    assert_eq!(code(other.map(drop)), Some(ErrorCode::Forbidden));
    let missing = TrackId::parse("nope").unwrap();
    let gone = change_track(
        &n.deps(),
        &u("u1"),
        &missing,
        TrackChange {
            name: Some("X".into()),
            hidden: None,
        },
    )
    .await;
    assert_eq!(code(gone.map(drop)), Some(ErrorCode::NotFound));
    assert!(n.people.all_people().is_empty() && n.reindexed().is_empty());
}

#[tokio::test]
async fn renaming_a_speaker_trims_and_reindexes_where_they_speak() {
    let n = naming().await;
    let id = SpeakerId::parse("c1-p0").unwrap();

    let s = rename_speaker(&n.deps(), &u("u1"), &id, " Mia ")
        .await
        .unwrap();

    assert_eq!(
        (s.label.as_str(), s.display_name.as_deref()),
        ("A", Some("Mia"))
    );
    assert_eq!(n.reindexed(), ["c1-s2"]);
    assert_eq!(
        rename_speaker(&n.deps(), &u("u1"), &id, "")
            .await
            .unwrap_err()
            .code,
        ErrorCode::ValidationFailed
    );
}

mod bulk {
    use nimbytes_core::ports::PeopleStore;
    use nimbytes_core::usecases::people::name_tracks;

    use super::*;

    fn t(id: &str) -> TrackId {
        TrackId::parse(id).unwrap()
    }

    async fn person_of(n: &Naming, id: &str) -> Option<String> {
        n.people
            .track(&t(id))
            .await
            .unwrap()
            .and_then(|v| v.person_name)
    }

    #[tokio::test]
    async fn a_confirmed_group_is_named_as_one_person_and_every_segment_reindexed() {
        let n = naming().await;

        name_tracks(&n.deps(), &u("u1"), &[t("c1-f0"), t("c1-f1")], " Rex ")
            .await
            .unwrap();

        assert_eq!(person_of(&n, "c1-f0").await.as_deref(), Some("Rex"));
        assert_eq!(person_of(&n, "c1-f1").await.as_deref(), Some("Rex"));
        assert_eq!(n.people.all_people().len(), 1);
        let mut docs = n.reindexed();
        docs.sort();
        assert_eq!(docs, ["c1-s0", "c1-s1", "c1-s2"]);
    }

    #[tokio::test]
    async fn one_track_of_another_user_forbids_the_call_and_changes_nothing() {
        let n = naming().await;
        n.people.add_track(FakeTrack {
            id: t("c9-f0"),
            owner: u("u2"),
            segments: vec![],
            person: None,
            hidden: false,
        });

        let theirs = name_tracks(&n.deps(), &u("u1"), &[t("c1-f0"), t("c9-f0")], "Rex").await;
        let missing = name_tracks(&n.deps(), &u("u1"), &[t("c1-f0"), t("nope")], "Rex").await;

        assert_eq!(theirs.unwrap_err().code, ErrorCode::Forbidden);
        assert_eq!(missing.unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(person_of(&n, "c1-f0").await, None, "nothing named");
        assert!(n.people.all_people().is_empty(), "no person created");
        assert!(n.reindexed().is_empty());
    }

    #[tokio::test]
    async fn no_tracks_too_many_tracks_or_a_bad_name_is_a_validation_error() {
        let n = naming().await;
        let many: Vec<TrackId> = (0..101).map(|i| t(&format!("c1-f{i}"))).collect();

        for (tracks, name) in [(vec![], "Rex"), (many, "Rex"), (vec![t("c1-f0")], "  ")] {
            let err = name_tracks(&n.deps(), &u("u1"), &tracks, name)
                .await
                .unwrap_err();
            assert_eq!(err.code, ErrorCode::ValidationFailed);
        }
    }
}
