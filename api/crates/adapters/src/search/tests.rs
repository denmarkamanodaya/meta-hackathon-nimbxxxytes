//! Tantivy index in RAM: boosts, user filter, replace-on-reindex, and a disk round trip.

use nimbytes_core::domain::ids::{ClipId, SegmentId, UserId};
use nimbytes_core::domain::index::SegmentDoc;
use nimbytes_core::ports::TextIndex;

use super::TantivySearchIndex;

fn doc(id: &str, user: &str) -> SegmentDoc {
    SegmentDoc {
        segment_id: SegmentId::parse(id).unwrap(),
        clip_id: ClipId::parse("c1").unwrap(),
        user_id: UserId::parse(user).unwrap(),
        description: String::new(),
        actions: String::new(),
        objects: String::new(),
        place: String::new(),
        mood: String::new(),
        transcript: String::new(),
        people: String::new(),
        speakers: String::new(),
        recorded_at: Some("2026-01-28T05:59:00.000Z".into()),
        quality: Some(7),
        hook_score: None,
    }
}

fn ids(hits: &[(SegmentId, f32)]) -> Vec<&str> {
    hits.iter().map(|(s, _)| s.as_str()).collect()
}

fn u(id: &str) -> UserId {
    UserId::parse(id).unwrap()
}

#[tokio::test]
async fn a_description_match_outranks_a_mood_match() {
    let idx = TantivySearchIndex::in_memory().unwrap();
    let in_mood = SegmentDoc {
        mood: "cosy".into(),
        ..doc("s-mood", "u1")
    };
    let in_description = SegmentDoc {
        description: "A cosy cafe corner.".into(),
        ..doc("s-desc", "u1")
    };
    idx.upsert(&[in_mood, in_description]).await.unwrap();

    let hits = idx.search(&u("u1"), "cosy", 10).await.unwrap();

    assert_eq!(ids(&hits), ["s-desc", "s-mood"]);
}

#[tokio::test]
async fn people_and_transcript_are_searchable_and_odd_queries_do_not_fail() {
    let idx = TantivySearchIndex::in_memory().unwrap();
    let a = SegmentDoc {
        people: "Ana".into(),
        ..doc("s1", "u1")
    };
    let b = SegmentDoc {
        transcript: "with food.".into(),
        ..doc("s2", "u1")
    };
    idx.upsert(&[a, b]).await.unwrap();

    assert_eq!(ids(&idx.search(&u("u1"), "ana", 10).await.unwrap()), ["s1"]);
    assert_eq!(
        ids(&idx.search(&u("u1"), "food", 10).await.unwrap()),
        ["s2"]
    );
    assert!(idx.search(&u("u1"), "\"unbalanced (AND", 10).await.is_ok());
}

#[tokio::test]
async fn another_users_segments_are_never_returned() {
    let idx = TantivySearchIndex::in_memory().unwrap();
    let mine = SegmentDoc {
        description: "a dog".into(),
        ..doc("s1", "u1")
    };
    let theirs = SegmentDoc {
        description: "a dog".into(),
        ..doc("s2", "u2")
    };
    idx.upsert(&[mine, theirs]).await.unwrap();

    assert_eq!(ids(&idx.search(&u("u1"), "dog", 10).await.unwrap()), ["s1"]);
    assert!(
        idx.search(&u("nobody"), "dog", 10)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn reindexing_a_segment_replaces_its_document() {
    let idx = TantivySearchIndex::in_memory().unwrap();
    idx.upsert(&[SegmentDoc {
        description: "a dog".into(),
        ..doc("s1", "u1")
    }])
    .await
    .unwrap();

    idx.upsert(&[SegmentDoc {
        description: "a cat".into(),
        ..doc("s1", "u1")
    }])
    .await
    .unwrap();

    assert!(idx.search(&u("u1"), "dog", 10).await.unwrap().is_empty());
    assert_eq!(
        ids(&idx.search(&u("u1"), "cat", 10).await.unwrap()),
        ["s1"],
        "one document, not two"
    );
}

/// Durability is checked with a read-only open of the directory (no writer lock): reopening
/// with a second writer races the first writer's lock file, which other tests running in the same
/// process can keep busy for a moment after the first writer is dropped.
#[tokio::test]
async fn documents_are_on_disk_after_upsert() {
    let dir = tempfile::tempdir().unwrap();
    let idx = TantivySearchIndex::open(dir.path()).unwrap();
    idx.upsert(&[SegmentDoc {
        description: "a lake".into(),
        ..doc("s1", "u1")
    }])
    .await
    .unwrap();
    drop(idx);

    let on_disk = tantivy::Index::open_in_dir(dir.path()).unwrap();
    let searcher = on_disk.reader().unwrap().searcher();

    assert_eq!(searcher.num_docs(), 1);
}
