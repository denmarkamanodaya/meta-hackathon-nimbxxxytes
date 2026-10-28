//! Key art, footage storyboards and "use as cover" over in-memory fakes: ownership, what each
//! drawing is anchored on, what is stored, and that a failed drawing never fails anything.

#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::cover::CoverStyle;
use nimbytes_core::domain::ids::{ProductionId, ShortId, ShotId};
use nimbytes_core::domain::production::{Platform, ProductionStatus};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::usecases::exports::use_art_as_cover;
use nimbytes_core::usecases::productions::{
    auto_art_due, draw_production_art, footage_board_requested, redraw_footage_board,
};
use nimbytes_testkit::shorts_world::user;
use nimbytes_testkit::studio_world::{StudioWorld, export_with_covers, production, shot};

fn pid() -> ProductionId {
    ProductionId::parse("p1").unwrap()
}

fn shot_id(id: &str) -> ShotId {
    ShotId::parse(id).unwrap()
}

/// Production p1 of u1 with shots a (covered by m1 of clip k1), b (uncovered), c (covered by m2
/// of clip k2).
async fn covered_world() -> StudioWorld {
    let w = StudioWorld::default();
    w.put_moment("u1", ("k1", "m1"), Some(5)).await;
    w.put_moment("u1", ("k2", "m2"), Some(9)).await;
    w.productions.put(
        production("p1", "u1", None),
        vec![
            shot("a", 1, Some("m1")),
            shot("b", 2, None),
            shot("c", 3, Some("m2")),
        ],
    );
    w
}

#[tokio::test]
async fn a_footage_board_is_only_redrawn_for_the_owners_covered_shot() {
    let w = covered_world().await;
    let d = w.studio_deps();
    let ask = |user: &'static str, shot: &'static str| {
        let d = &d;
        async move { footage_board_requested(d, &user_of(user), (&pid(), &shot_id(shot))).await }
    };

    assert!(ask("u1", "a").await.is_ok());
    assert_eq!(ask("u2", "a").await.unwrap_err().code, ErrorCode::Forbidden);
    assert_eq!(
        ask("u1", "b").await.unwrap_err().code,
        ErrorCode::ValidationFailed,
        "an uncovered shot"
    );
    assert_eq!(ask("u1", "zz").await.unwrap_err().code, ErrorCode::NotFound);
}

fn user_of(id: &str) -> nimbytes_core::domain::ids::UserId {
    user(id)
}

#[tokio::test]
async fn a_footage_board_is_drawn_from_the_covering_moments_frame_and_recorded_with_it() {
    let w = covered_world().await;

    redraw_footage_board(&w.studio_deps(), (&pid(), &shot_id("c")), 42)
        .await
        .unwrap();

    let sent = w.images.footage.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].title, "Shot 3");
    assert_eq!(sent[0].take, 42);
    assert!(sent[0].frame.ends_with("footage_frame_c.jpg"));
    assert!(
        w.base
            .blobs
            .gets()
            .contains(&"users/u1/thumbs/k2/m2.jpg".to_owned())
    );
    let stored = w.productions.shot(&shot_id("c")).unwrap();
    assert_eq!(
        stored.footage_board_key.unwrap().as_str(),
        "users/u1/productions/p1/boards/c_footage.webp"
    );
    assert_eq!(stored.footage_board_segment.unwrap().as_str(), "m2");
    assert_eq!(
        w.progress.events(),
        [
            "p1 footage_boards 0/1 Running",
            "p1 footage_boards 1/1 Done",
            "p1 done Done"
        ]
    );
}

#[tokio::test]
async fn a_footage_board_the_model_cannot_draw_is_skipped_and_the_production_is_untouched() {
    let w = covered_world().await;
    w.images.fail();

    redraw_footage_board(&w.studio_deps(), (&pid(), &shot_id("a")), 1)
        .await
        .unwrap();

    let stored = w.productions.shot(&shot_id("a")).unwrap();
    assert_eq!(stored.footage_board_key, None);
    let p = w.productions.productions.lock().unwrap()[0].clone();
    assert_eq!((p.status, p.error), (ProductionStatus::Shooting, None));
}

#[tokio::test]
async fn production_art_is_anchored_on_the_covered_shots_frames_in_play_order() {
    let w = covered_world().await;

    draw_production_art(&w.studio_deps(), &pid(), 0)
        .await
        .unwrap();

    let sent = w.images.art.lock().unwrap().clone();
    let names: Vec<String> = sent[0]
        .anchors
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["art_p1_0.jpg", "art_p1_1.jpg"]);
    let gets = w.base.blobs.gets();
    let k1 = gets.iter().position(|g| g == "users/u1/thumbs/k1/m1.jpg");
    let k2 = gets.iter().position(|g| g == "users/u1/thumbs/k2/m2.jpg");
    assert!(k1 < k2 && k1.is_some(), "{gets:?}");
    assert_eq!((sent[0].shape, sent[0].size), ("4:5", "1080x1350"));
    assert_eq!(sent[0].theme, "Beach day");
    let p = w.productions.productions.lock().unwrap()[0].clone();
    assert_eq!(
        p.art_key.unwrap().as_str(),
        "users/u1/productions/p1/art.webp"
    );
}

#[tokio::test]
async fn production_art_falls_back_to_the_storyboards_and_a_failure_changes_nothing() {
    let w = StudioWorld::default();
    w.productions.put(
        production("p1", "u1", None),
        vec![shot("a", 1, None), shot("b", 2, None)],
    );

    draw_production_art(&w.studio_deps(), &pid(), 0)
        .await
        .unwrap();
    let names: Vec<String> = w.images.art.lock().unwrap()[0]
        .anchors
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["art_p1_0.webp", "art_p1_1.webp"]);

    let failing = StudioWorld::default();
    failing.images.fail();
    failing
        .productions
        .put(production("p1", "u1", None), vec![shot("a", 1, None)]);
    let err = draw_production_art(&failing.studio_deps(), &pid(), 0).await;
    assert_eq!(err.unwrap_err().code, ErrorCode::ModelUnavailable);
    let p = failing.productions.productions.lock().unwrap()[0].clone();
    assert_eq!((p.art_key, p.status), (None, ProductionStatus::Shooting));
}

#[tokio::test]
async fn the_automatic_art_runs_once_and_only_after_planning() {
    let w = StudioWorld::default();
    let mut planning = production("p1", "u1", None);
    planning.status = ProductionStatus::Planning;
    w.productions.put(planning, vec![]);
    assert!(!auto_art_due(&w.productions, &pid()).await.unwrap());

    w.productions.productions.lock().unwrap()[0].status = ProductionStatus::Shooting;
    assert!(auto_art_due(&w.productions, &pid()).await.unwrap());
    assert!(!auto_art_due(&w.productions, &pid()).await.unwrap());
}

/// p1 of u1 (with art when `art`), linked to a story short of u1.
async fn art_world(art: bool) -> (StudioWorld, ShortId) {
    let w = StudioWorld::default();
    let x1 = w.base.create().await.unwrap();
    let mut p = production("p1", "u1", Some(&x1));
    if art {
        p.art_key = Some(ObjectKey::from_stored(
            "users/u1/productions/p1/art.webp".into(),
        ));
    }
    w.productions.put(p, vec![]);
    (w, x1)
}

#[tokio::test]
async fn art_used_as_a_cover_is_appended_to_every_export_below_the_cap() {
    let (w, x1) = art_world(true).await;
    w.exports.put(export_with_covers(&x1, Platform::Reels, 2));
    w.exports.put(export_with_covers(&x1, Platform::Tiktok, 9));

    let added = use_art_as_cover(&w.export_deps(), &user("u1"), &pid())
        .await
        .unwrap();

    assert_eq!(added, [Platform::Reels], "TikTok is at the cap");
    let reels = w.exports.row(&x1, Platform::Reels).unwrap();
    assert_eq!(
        reels.cover_keys[2].as_str(),
        format!("users/u1/exports/{x1}/reels_cover_2.webp")
    );
    assert_eq!(reels.cover_info[2].style, CoverStyle::KeyArt);
    assert_eq!(
        w.exports
            .row(&x1, Platform::Tiktok)
            .unwrap()
            .cover_keys
            .len(),
        9
    );
    assert!(
        w.base
            .blobs
            .gets()
            .contains(&"users/u1/productions/p1/art.webp".to_owned())
    );
}

#[tokio::test]
async fn art_as_a_cover_needs_the_owner_art_and_exports() {
    let (w, _) = art_world(false).await;
    let d = w.export_deps();
    let code = |r: Result<Vec<Platform>, nimbytes_core::AppError>| r.unwrap_err().code;
    assert_eq!(
        code(use_art_as_cover(&d, &user("u1"), &pid()).await),
        ErrorCode::ValidationFailed,
        "no art yet"
    );
    let (w, _) = art_world(true).await;
    let d = w.export_deps();
    assert_eq!(
        code(use_art_as_cover(&d, &user("u1"), &pid()).await),
        ErrorCode::ValidationFailed,
        "no exports yet"
    );
    assert_eq!(
        code(use_art_as_cover(&d, &user("u2"), &pid()).await),
        ErrorCode::Forbidden
    );
}
