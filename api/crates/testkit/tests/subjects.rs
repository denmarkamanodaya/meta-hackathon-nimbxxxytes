//! SAM features over fakes: keep subject in frame (reframe runs, status, camera paths in props)
//! and screens and number plates in renders.

#![cfg(test)]

use std::sync::Arc;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::{ClipId, ShortId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::privacy::{Effect, ShortFinish};
use nimbytes_core::domain::reframe::{CropKey, ReframeStatus, ShotReframe};
use nimbytes_core::domain::sam::SamPrompt;
use nimbytes_core::domain::short::ShortStatus;
use nimbytes_core::ports::{PrivacyStore, StepRunner, SubjectStore};
use nimbytes_core::usecases::shorts::{request_render, short_detail};
use nimbytes_core::usecases::subjects::{SubjectPorts, reframe_short, reframe_view};
use nimbytes_testkit::shorts_world::{ShortsWorld, seg, timeline, user};
use nimbytes_testkit::world::{clip, probe};
use nimbytes_testkit::{
    FakeMasks, FakeMediaTool, FakeNamer, InMemoryCatalogue, InMemorySubjects, RecordedProgress,
    ScriptedTracker, sam_record,
};

struct Sam {
    tracker: Arc<ScriptedTracker>,
    store: Arc<InMemorySubjects>,
    media: Arc<FakeMediaTool>,
}

/// Version 1 cuts `s0` 1–4 s following "dog" and `s1` 11–14 s with no subject; SAM ports wired.
async fn planned() -> (ShortsWorld, ShortId, Sam) {
    let mut w = ShortsWorld::new();
    let sam = Sam {
        tracker: Arc::default(),
        store: Arc::default(),
        media: Arc::new(FakeMediaTool::new(probe(20.0, false), Vec::new())),
    };
    let catalogue = Arc::new(InMemoryCatalogue::default());
    let mut c1 = clip(Some(probe(20.0, false))).unwrap();
    catalogue.put_clip(c1.clone());
    c1.id = ClipId::parse("c2").unwrap();
    catalogue.put_clip(c1);
    w.subjects = Some(SubjectPorts {
        tracker: sam.tracker.clone(),
        media: sam.media.clone(),
        store: sam.store.clone(),
        catalogue,
        namer: Arc::new(FakeNamer::answering("dog")),
        masks: Arc::new(FakeMasks::default()),
    });
    let id = w.create().await.unwrap();
    let mut t = timeline(&[("s0", 1.0, 4.0), ("s1", 11.0, 14.0)]);
    t.clips[0].subject = Some("dog".into());
    w.reasoner.plans(t);
    w.run(JobKind::Agent, "edit").await.unwrap();
    (w, id, sam)
}

/// A dog walking right through every 12 fps frame of a 3 s shot.
fn walking_dog() -> Vec<nimbytes_core::domain::sam::SamRecord> {
    (0..36)
        .map(|f| {
            let x = 100.0 + f64::from(f) * 4.0;
            sam_record(f, 0, (x, 300.0, x + 60.0, 360.0))
        })
        .collect()
}

#[tokio::test]
async fn a_reframe_tracks_each_subject_shot_once_in_clip_seconds() {
    let (w, id, sam) = planned().await;
    sam.tracker.concept("dog", walking_dog());
    let progress = RecordedProgress::default();
    let sp = w.subjects.clone().unwrap();

    reframe_short((&w.deps(), &sp, &progress), &id)
        .await
        .unwrap();
    reframe_short((&w.deps(), &sp, &progress), &id)
        .await
        .unwrap();

    let rows = sam.store.stored_reframes();
    assert_eq!(rows.len(), 1, "only the shot with a subject");
    let r = &rows[0];
    assert_eq!((r.segment_id.as_str(), r.subject.as_str()), ("s0", "dog"));
    assert_eq!((r.frames_tracked, r.frames_total, r.lost_s), (36, 36, 0.0));
    assert_eq!(r.crop_path.len(), 36);
    assert!(
        (r.crop_path[24].t_s - 3.0).abs() < 1e-9,
        "frame 24 from 1.0 s"
    );
    assert!(r.crop_path[35].cx > r.crop_path[0].cx, "follows the dog");
    let seen = sam.tracker.seen();
    assert_eq!(seen.len(), 1, "a shot already tracked is not sent again");
    assert_eq!(seen[0].prompt, SamPrompt::Concept("dog".into()));
    assert_eq!(seen[0].purpose, "reframe");
    assert_eq!(seen[0].media, "sam_range_1000_4000_12.mp4");
    assert!(
        sam.media
            .calls()
            .contains(&"range 1-4@12 sam_proxy.mp4 -> sam_range_1000_4000_12.mp4".to_owned())
    );
    let events = progress.events();
    assert_eq!(
        events,
        [
            format!("{id} reframe 0/1 Running"),
            format!("{id} reframe_done Done"),
            format!("{id} reframe_done Done"),
        ]
    );
}

#[tokio::test]
async fn the_status_is_idle_then_ready_and_only_the_owner_may_read_it() {
    let (w, id, sam) = planned().await;
    let sp = w.subjects.clone().unwrap();
    let idle = reframe_view((&w.deps(), &sp), &user("u1"), &id, (false, false))
        .await
        .unwrap();
    assert_eq!(idle.status, ReframeStatus::Idle);
    assert_eq!(idle.shots.len(), 1);
    assert_eq!(idle.shots[0].frames_total, 0);
    let other = reframe_view((&w.deps(), &sp), &user("u2"), &id, (false, false)).await;
    assert_eq!(other.unwrap_err().code, ErrorCode::Forbidden);

    sam.tracker.concept("dog", walking_dog());
    reframe_short((&w.deps(), &sp, &RecordedProgress::default()), &id)
        .await
        .unwrap();
    let ready = reframe_view((&w.deps(), &sp), &user("u1"), &id, (false, true))
        .await
        .unwrap();
    assert_eq!(ready.status, ReframeStatus::Ready);
    assert_eq!(ready.shots[0].frames_tracked, 36);
}

#[tokio::test]
async fn a_sam_failure_fails_only_the_reframe_run() {
    let (w, id, sam) = planned().await;
    sam.tracker.fail();
    let sp = w.subjects.clone().unwrap();
    let run = reframe_short((&w.deps(), &sp, &RecordedProgress::default()), &id).await;
    assert_eq!(run.unwrap_err().code, ErrorCode::ModelUnavailable);
    assert!(sam.store.stored_reframes().is_empty());
    let short = w.shorts.short(&id).unwrap();
    assert_ne!(short.status, ShortStatus::Failed, "the short is untouched");
}

fn row(n: u32, subject: &str) -> ShotReframe {
    ShotReframe {
        short_id: ShortId::parse("x").unwrap(),
        version_n: n,
        segment_id: seg("s0"),
        subject: subject.into(),
        crop_path: vec![
            CropKey {
                t_s: 1.0,
                cx: 0.42,
                cy: 0.5,
            },
            CropKey {
                t_s: 4.0,
                cx: 0.6,
                cy: 0.48,
            },
        ],
        frames_tracked: 36,
        frames_total: 36,
        lost_s: 0.0,
        updated_at: "t".into(),
    }
}

#[tokio::test]
async fn the_short_page_props_carry_the_camera_path_and_source_aspect_while_keep_subject_is_on() {
    let (w, id, sam) = planned().await;
    let r = ShotReframe {
        short_id: id.clone(),
        ..row(1, "dog")
    };
    sam.store.put_reframe(&r).await.unwrap();

    let view = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    let clips = &view.versions[0].props.clips;
    assert_eq!(clips[0].crop_path.as_ref(), Some(&r.crop_path));
    assert_eq!(
        clips[0].source_aspect,
        Some(720.0 / 1280.0),
        "from the probe"
    );
    assert_eq!(
        (clips[1].crop_path.as_ref(), clips[1].source_aspect),
        (None, None)
    );

    let off = ShortFinish {
        blur_bystanders: true,
        title_text: None,
        speaker_colors: false,
        effect: Effect::None,
        keep_subject: false,
    };
    w.privacy.put_finish(&id, &off).await.unwrap();
    let view = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    assert!(
        view.versions[0]
            .props
            .clips
            .iter()
            .all(|c| c.crop_path.is_none())
    );
}

#[tokio::test]
async fn a_changed_subject_drops_its_camera_path() {
    let (w, id, sam) = planned().await;
    let r = ShotReframe {
        short_id: id.clone(),
        ..row(1, "cat")
    };
    sam.store.put_reframe(&r).await.unwrap();
    let view = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    assert!(view.versions[0].props.clips[0].crop_path.is_none());
}

#[tokio::test]
async fn renders_blur_screens_and_plates_only_when_the_owner_turned_it_on() {
    let (w, id, sam) = planned().await;
    sam.tracker.concept(
        "license plate",
        vec![sam_record(5, 2, (50.0, 329.0, 84.0, 346.0))],
    );
    request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();
    w.run(JobKind::Render, "render").await.unwrap();
    let off = w.renderer.calls().last().unwrap().props.blur.clone();
    assert!(off.is_empty());
    assert!(sam.tracker.seen().is_empty(), "no SAM call while off");

    sam.store.set_blur_objects(&user("u1"), true).await.unwrap();
    let props = w.renderer.calls().len();
    let job = w.job(JobKind::Render).unwrap();
    w.steps().run(&job, "render").await.unwrap();
    assert!(w.renderer.calls().len() > props);
    let blur = w.renderer.calls().last().unwrap().props.blur.clone();
    assert_eq!(blur.len(), 2, "one plate in each of the two shots");
    assert_eq!(blur[0].segment_id, seg("s0"));
    assert!(
        (blur[0].boxes[0].t_s - 1.5).abs() < 1e-9,
        "frame 5 at 10 fps from 1.0 s"
    );
    let phrases: Vec<SamPrompt> = sam.tracker.seen().into_iter().map(|s| s.prompt).collect();
    assert_eq!(
        phrases,
        [
            SamPrompt::Concept("screen".into()),
            SamPrompt::Concept("license plate".into()),
            SamPrompt::Concept("screen".into()),
            SamPrompt::Concept("license plate".into()),
        ]
    );
}

#[tokio::test]
async fn a_failed_screens_and_plates_lookup_never_fails_the_render() {
    let (w, id, sam) = planned().await;
    sam.store.set_blur_objects(&user("u1"), true).await.unwrap();
    sam.tracker.fail();
    request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();
    w.run(JobKind::Render, "render").await.unwrap();
    assert!(w.renderer.calls().last().unwrap().props.blur.is_empty());
}
