//! Hashes, duplicates, the pre-upload check, removal, and duplicates left out of reads, on SQLite.

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::{ClipId, PersonId, SegmentId, TrackId, UserId};
use nimbytes_core::domain::segment::TrackRow;
use nimbytes_core::ports::{Catalogue, PeopleStore, ShortStore, TrackUpdate};
use sqlx::SqlitePool;

use super::SqliteCatalogue;
use super::views_tests::{self, fixture};
use crate::sqlite::SqliteShortStore;

fn id(raw: &str) -> ClipId {
    ClipId::parse(raw).unwrap()
}

/// Adds clip `raw` of `user`, uploaded after c1, with c1's file name and size.
async fn add_clip(cat: &SqliteCatalogue, user: &UserId, raw: &str) {
    views_tests::add_clip(cat, user, (&id(raw), "2026-10-27T02:00:00.000Z")).await;
}

async fn count(pool: &SqlitePool, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn twins_are_found_by_hash_and_marked_and_unhashed_clips_listed() {
    let (cat, _, user, c1) = fixture().await;
    add_clip(&cat, &user, "c2").await;
    for c in [&c1, &id("c2")] {
        cat.set_clip_status(c, ClipStatus::Ready, None)
            .await
            .unwrap();
    }
    add_clip(&cat, &user, "c3").await;
    assert_eq!(
        cat.unhashed().await.unwrap(),
        [c1.clone(), id("c2")],
        "c3 is still uploading"
    );

    cat.record_hash(&c1, "abc").await.unwrap();
    cat.record_hash(&id("c2"), "abc").await.unwrap();
    let twins: Vec<ClipId> = cat
        .same_content(&user, "abc")
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();
    cat.mark_duplicate(&id("c2"), &c1).await.unwrap();

    assert_eq!(twins, [c1.clone(), id("c2")], "oldest first");
    let c2 = cat.get_clip(&id("c2")).await.unwrap().unwrap();
    assert_eq!(
        (c2.status, c2.duplicate_of, c2.content_sha256.as_deref()),
        (ClipStatus::Duplicate, Some(c1.clone()), Some("abc"))
    );
    let left: Vec<ClipId> = cat
        .same_content(&user, "abc")
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();
    assert_eq!(left, [c1], "a duplicate is never a twin");
    assert!(cat.unhashed().await.unwrap().is_empty());
    let stranger = UserId::parse("u9").unwrap();
    assert!(cat.same_content(&stranger, "abc").await.unwrap().is_empty());
}

#[tokio::test]
async fn the_upload_check_matches_name_and_size_of_the_owners_live_clips_only() {
    let (cat, _, user, c1) = fixture().await;
    add_clip(&cat, &user, "c2").await;
    cat.mark_duplicate(&id("c2"), &c1).await.unwrap();

    let found = cat
        .same_upload(&user, "a.mov", 1)
        .await
        .unwrap()
        .map(|c| c.id);
    let other_size = cat.same_upload(&user, "a.mov", 2).await.unwrap();
    let other_name = cat.same_upload(&user, "b.mov", 1).await.unwrap();
    let stranger = cat
        .same_upload(&UserId::parse("u9").unwrap(), "a.mov", 1)
        .await
        .unwrap();
    cat.set_clip_status(&c1, ClipStatus::Failed, None)
        .await
        .unwrap();
    let failed = cat.same_upload(&user, "a.mov", 1).await.unwrap();

    assert_eq!(found, Some(c1));
    assert!(other_size.is_none() && other_name.is_none() && stranger.is_none());
    assert!(
        failed.is_none(),
        "a failed clip and a duplicate do not count"
    );
}

#[tokio::test]
async fn deleting_a_clip_removes_its_upload_and_every_row_about_it() {
    let (cat, pool, user, c1) = fixture().await;
    add_clip(&cat, &user, "c2").await;

    cat.delete_clip(&c1).await.unwrap();

    assert!(cat.get_clip(&c1).await.unwrap().is_none());
    for sql in [
        "SELECT COUNT(*) FROM uploads WHERE clip_id = 'c1'",
        "SELECT COUNT(*) FROM segments WHERE clip_id = 'c1'",
        "SELECT COUNT(*) FROM transcript_turns WHERE clip_id = 'c1'",
        "SELECT COUNT(*) FROM speakers WHERE clip_id = 'c1'",
    ] {
        assert_eq!(count(&pool, sql).await, 0, "{sql}");
    }
    assert_eq!(
        count(&pool, "SELECT COUNT(*) FROM clips").await,
        1,
        "c2 stays"
    );
}

#[tokio::test]
async fn search_candidates_leave_out_duplicate_clips() {
    let (cat, _, user, c1) = fixture().await;
    let s0 = SegmentId::parse("c1-s0").unwrap();
    let before = cat
        .candidates(&user, std::slice::from_ref(&s0))
        .await
        .unwrap();

    cat.mark_duplicate(&c1, &id("c0")).await.unwrap();

    assert_eq!(before.len(), 1);
    assert!(cat.candidates(&user, &[s0]).await.unwrap().is_empty());
}

/// Tracks c1-f0 named Ana, c1-f1 unnamed, c1-f2 hidden.
async fn three_faces(cat: &SqliteCatalogue, user: &UserId, c1: &ClipId) {
    let track = |n: u32| TrackRow {
        id: TrackId::parse(format!("c1-f{n}")).unwrap(),
        ordinal: n,
        first_s: 1.0,
        last_s: 3.0,
        crop_key: format!("users/u1/faces/c1/c1-f{n}.jpg"),
        max_area: 0.1,
    };
    cat.replace_face_tracks(c1, &[track(0), track(1), track(2)], &[])
        .await
        .unwrap();
    let ana = cat
        .upsert_person(user, &PersonId::parse("p-ana").unwrap(), "Ana")
        .await
        .unwrap();
    let named = TrackUpdate {
        person: Some(ana),
        hidden: None,
    };
    cat.update_track(&TrackId::parse("c1-f0").unwrap(), &named)
        .await
        .unwrap();
    let hide = TrackUpdate {
        person: None,
        hidden: Some(true),
    };
    cat.update_track(&TrackId::parse("c1-f2").unwrap(), &hide)
        .await
        .unwrap();
}

#[tokio::test]
async fn the_people_overview_leaves_out_faces_of_duplicate_clips() {
    let (cat, _, user, c1) = fixture().await;
    three_faces(&cat, &user, &c1).await;
    let before = cat.overview(&user).await.unwrap();

    cat.mark_duplicate(&c1, &id("c0")).await.unwrap();
    let after = cat.overview(&user).await.unwrap();

    assert_eq!(
        (
            before.people[0].clip_count,
            before.unnamed.len(),
            before.hidden.len()
        ),
        (1, 1, 1)
    );
    assert_eq!(
        after.people.len(),
        1,
        "the person stays, with nothing from the copy"
    );
    assert_eq!(
        (
            after.people[0].clip_count,
            after.people[0].crop_key.as_deref()
        ),
        (0, None)
    );
    assert!(after.unnamed.is_empty() && after.hidden.is_empty());
}

#[tokio::test]
async fn planner_lookups_leave_out_moments_of_duplicate_clips() {
    let (cat, pool, user, c1) = fixture().await;
    let store = SqliteShortStore::new(pool);
    let s0 = SegmentId::parse("c1-s0").unwrap();
    let before = (
        store
            .moments(&user, std::slice::from_ref(&s0))
            .await
            .unwrap()
            .len(),
        store.library(&user).await.unwrap().len(),
    );

    cat.mark_duplicate(&c1, &id("c0")).await.unwrap();

    assert_eq!(before, (1, 2));
    assert!(store.moments(&user, &[s0]).await.unwrap().is_empty());
    assert!(store.library(&user).await.unwrap().is_empty());
}
