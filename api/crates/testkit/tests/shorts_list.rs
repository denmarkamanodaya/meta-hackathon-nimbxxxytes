//! The shorts list over fakes: one row per short, newest first, with the best version's score and
//! cover.

#![cfg(test)]

use nimbytes_core::domain::critique::Verdict;
use nimbytes_core::ports::ShortStore;
use nimbytes_core::usecases::shorts::list_shorts;
use nimbytes_testkit::shorts_world::{ShortsWorld, critique, timeline, user};

#[tokio::test]
async fn each_row_shows_the_best_versions_score_and_first_shot_as_cover() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    w.shorts
        .add_version(&id, 1, &timeline(&[("s1", 11.0, 14.0)]))
        .await
        .unwrap();
    w.shorts
        .add_version(&id, 2, &timeline(&[("s0", 1.0, 4.0)]))
        .await
        .unwrap();
    w.shorts
        .set_critique(&id, 1, &critique(9, 0, Verdict::Accept).settled(1))
        .await
        .unwrap();
    w.shorts
        .set_critique(&id, 2, &critique(3, 1, Verdict::Revise).settled(2))
        .await
        .unwrap();
    w.shorts.set_best_version(&id, 1).await.unwrap();

    let rows = list_shorts(&w.deps(), &user("u1")).await.unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!((rows[0].version_count, rows[0].best_score), (2, Some(29.0)));
    assert_eq!(
        rows[0].thumb_url.as_deref(),
        Some("https://signed/users/u1/thumbs/c2/s1.jpg?ttl=3600"),
        "first shot of the best version, not the latest"
    );
}

#[tokio::test]
async fn without_a_best_version_the_latest_is_shown_and_no_version_means_no_cover() {
    let w = ShortsWorld::new();
    let planned = w.create().await.unwrap();
    w.shorts
        .add_version(&planned, 1, &timeline(&[("s1", 11.0, 14.0)]))
        .await
        .unwrap();
    w.shorts
        .add_version(&planned, 2, &timeline(&[("s0", 1.0, 4.0)]))
        .await
        .unwrap();
    w.clock.advance(1_000);
    let fresh = w.create().await.unwrap();

    let rows = list_shorts(&w.deps(), &user("u1")).await.unwrap();
    let theirs = list_shorts(&w.deps(), &user("u2")).await.unwrap();

    assert_eq!(
        (rows[0].short.id.clone(), rows[1].short.id.clone()),
        (fresh, planned)
    );
    assert_eq!(
        (rows[0].version_count, rows[0].thumb_url.as_deref()),
        (0, None)
    );
    assert_eq!(
        rows[1].thumb_url.as_deref(),
        Some("https://signed/users/u1/thumbs/c1/s0.jpg?ttl=3600")
    );
    assert_eq!(rows[1].best_score, None);
    assert!(theirs.is_empty());
}
