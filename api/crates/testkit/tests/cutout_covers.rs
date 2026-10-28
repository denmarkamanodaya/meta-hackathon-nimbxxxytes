//! Cut-out covers over fakes: the request checks, the subject cut from the hook frame, the scene or
//! blurred frame behind it, and the published cover made again from the stored layers.

#![cfg(test)]

use std::sync::Arc;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::cover::CoverStyle;
use nimbytes_core::domain::export::Platform;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::objects::CutoutBackground;
use nimbytes_core::domain::sam::SamPrompt;
use nimbytes_core::ports::ExportStore;
use nimbytes_core::usecases::exports::{
    CutoutPlan, bake_titled_cover, cutout_requested, draw_cutout_cover,
};
use nimbytes_core::usecases::shorts::save_timeline;
use nimbytes_core::usecases::subjects::SubjectPorts;
use nimbytes_testkit::publish_world::{PublishWorld, export_with_covers};
use nimbytes_testkit::shorts_world::{timeline, user};
use nimbytes_testkit::world::probe;
use nimbytes_testkit::{
    FakeMasks, FakeMediaTool, FakeNamer, InMemoryCatalogue, InMemorySubjects, ScriptedTracker,
    sam_record,
};

const REELS: Platform = Platform::Reels;

/// u1's short (s0 following "dog", then s1) with a Reels export of `covers` covers; SAM wired
/// when `sam`.
async fn world(covers: u32, sam: bool) -> (PublishWorld, ShortId, Arc<ScriptedTracker>) {
    let mut w = PublishWorld::default();
    let tracker = Arc::new(ScriptedTracker::default());
    if sam {
        w.base.subjects = Some(SubjectPorts {
            tracker: tracker.clone(),
            media: Arc::new(FakeMediaTool::new(probe(20.0, false), Vec::new())),
            store: Arc::new(InMemorySubjects::default()),
            catalogue: Arc::new(InMemoryCatalogue::default()),
            namer: Arc::new(FakeNamer::answering("dog")),
            masks: Arc::new(FakeMasks::default()),
        });
    }
    let id = w.base.create().await.unwrap();
    let mut cut = timeline(&[("s0", 1.0, 4.0), ("s1", 11.0, 14.0)]);
    cut.clips[0].subject = Some("dog".into());
    save_timeline(&w.base.deps(), &user("u1"), &id, cut)
        .await
        .unwrap();
    w.exports.put(export_with_covers(&id, REELS, covers));
    (w, id, tracker)
}

#[tokio::test]
async fn a_cutout_cover_is_one_new_cover_over_the_scene_by_default() {
    let (w, id, _) = world(3, true).await;
    let d = w.export_deps();
    let at = (&id, REELS);

    let plan = cutout_requested(&d, &user("u1"), at, None).await.unwrap();
    assert_eq!(
        plan,
        CutoutPlan {
            n: 3,
            background: CutoutBackground::Scene
        }
    );
    let blur = cutout_requested(&d, &user("u1"), at, Some(CutoutBackground::Blur)).await;
    assert_eq!(blur.unwrap().background, CutoutBackground::Blur);
    let other = cutout_requested(&d, &user("u2"), at, None).await;
    assert_eq!(other.unwrap_err().code, ErrorCode::Forbidden);
    w.exports.put(export_with_covers(&id, REELS, 9));
    let full = cutout_requested(&d, &user("u1"), at, None).await;
    assert_eq!(
        full.unwrap_err().code,
        ErrorCode::ValidationFailed,
        "the cap"
    );

    let (w, id, _) = world(3, false).await;
    let off = cutout_requested(&w.export_deps(), &user("u1"), (&id, REELS), None).await;
    assert_eq!(off.unwrap_err().code, ErrorCode::ValidationFailed);
}

/// A scene-backed cut-out cover number 3 drawn, with SAM finding the dog in the hook frame.
async fn drawn() -> (PublishWorld, ShortId, Arc<ScriptedTracker>) {
    let (w, id, tracker) = world(3, true).await;
    tracker.concept("dog", vec![sam_record(0, 0, (100.0, 200.0, 300.0, 600.0))]);
    let plan = CutoutPlan {
        n: 3,
        background: CutoutBackground::Scene,
    };
    draw_cutout_cover(&w.export_deps(), (&id, REELS), plan)
        .await
        .unwrap();
    (w, id, tracker)
}

#[tokio::test]
async fn a_drawn_cutout_cover_is_recorded_with_its_layers() {
    let (w, id, _) = drawn().await;
    let row = w.exports.exports(&id).await.unwrap().remove(0);
    assert_eq!(row.cover_keys.len(), 4);
    let info = &row.cover_info[3];
    assert_eq!(
        (info.style, info.background),
        (CoverStyle::Cutout, Some(CutoutBackground::Scene))
    );
    assert!(info.layers.is_some());
    assert!(
        w.progress
            .events()
            .ends_with(&[format!("{id} covers Running"), format!("{id} done Done")])
    );
}

#[tokio::test]
async fn the_subject_is_cut_from_the_hook_frame_and_laid_over_a_scene_of_the_place() {
    let (w, id, tracker) = drawn().await;
    let seen = tracker.seen();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].image, "SAM on the hook frame");
    assert_eq!(seen[0].prompt, SamPrompt::Concept("dog".into()));
    let scenes = w.images.scenes.lock().unwrap().clone();
    assert_eq!(scenes.len(), 1);
    assert!(scenes[0].frame.ends_with("cutout_reels_3.jpg"));
    let stills = w.base.renderer.stills();
    let (props, out) = stills.last().unwrap();
    assert!(
        props.image_url.contains("reels_cutout_3_scene.webp"),
        "{props:?}"
    );
    assert_eq!(props.background_blur, None);
    let cut = props.cutout.as_ref().unwrap();
    assert!(cut.image_url.contains("reels_cutout_3_frame.jpg"));
    assert_eq!(cut.path, "M100 200Z");
    assert_eq!(
        (cut.bbox.x1, cut.bbox.y1, cut.bbox.x2, cut.bbox.y2),
        (100, 200, 300, 600)
    );
    assert_eq!((cut.frame.w, cut.frame.h), (480, 640));
    assert!(out.contains(&format!("users/u1/exports/{id}/reels_cover_3.jpg")));
}

#[tokio::test]
async fn a_blurred_frame_background_draws_no_scene_and_blurs_the_frame() {
    let (w, id, tracker) = world(3, true).await;
    tracker.concept("dog", vec![sam_record(0, 0, (100.0, 200.0, 300.0, 600.0))]);
    let plan = CutoutPlan {
        n: 3,
        background: CutoutBackground::Blur,
    };

    draw_cutout_cover(&w.export_deps(), (&id, REELS), plan)
        .await
        .unwrap();

    assert!(w.images.scenes.lock().unwrap().is_empty());
    let (props, _) = w.base.renderer.stills().pop().unwrap();
    assert!(props.image_url.contains("reels_cutout_3_frame.jpg"));
    assert_eq!(props.background_blur, Some(true));
}

#[tokio::test]
async fn no_subject_in_the_hook_frame_adds_nothing_and_fails_the_covers_step() {
    let (w, id, _) = world(3, true).await;
    let plan = CutoutPlan {
        n: 3,
        background: CutoutBackground::Scene,
    };

    draw_cutout_cover(&w.export_deps(), (&id, REELS), plan)
        .await
        .unwrap();

    assert_eq!(w.exports.exports(&id).await.unwrap()[0].cover_keys.len(), 3);
    assert_eq!(
        w.progress.events().last().unwrap(),
        &format!("{id} covers Failed")
    );
}

#[tokio::test]
async fn the_published_cut_out_cover_is_made_again_from_its_layers() {
    let (w, id, tracker) = world(3, true).await;
    tracker.concept("dog", vec![sam_record(0, 0, (100.0, 200.0, 300.0, 600.0))]);
    let d = w.export_deps();
    let plan = CutoutPlan {
        n: 3,
        background: CutoutBackground::Scene,
    };
    draw_cutout_cover(&d, (&id, REELS), plan).await.unwrap();
    w.exports.set_cover_pick(&id, REELS, 3).await.unwrap();

    assert!(bake_titled_cover(&d, (&id, REELS)).await.unwrap());

    let (props, out) = w.base.renderer.stills().pop().unwrap();
    assert!(out.contains("reels_cover_titled.jpg"));
    assert!(props.image_url.contains("reels_cutout_3_scene.webp"));
    assert!(
        props.cutout.is_some(),
        "the subject stays in front of the title"
    );
}
