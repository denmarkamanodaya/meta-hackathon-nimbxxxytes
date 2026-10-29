//! MyWay use cases over fakes: start (idempotent, ownership, limits), the guide job's stages,
//! the safety refusal, step edits and deleting.
#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::guide::{GuideStage, GuideStatus, Safety};
use nimbytes_core::domain::ids::{ClipId, GuideId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::sam::SamPrompt;
use nimbytes_core::usecases::guides::{
    StepEdit, delete_guide, edit_step, get_guide, list_guides, start_guide,
};
use nimbytes_testkit::guides_world::{GuideWorld, washing_draft};
use nimbytes_testkit::sam_record;
use nimbytes_testkit::world::{clip, probe};

fn user(id: &str) -> UserId {
    UserId::parse(id).unwrap()
}

fn c1() -> ClipId {
    ClipId::parse("c1").unwrap()
}

fn g1() -> GuideId {
    GuideId::parse("id-1").unwrap()
}

/// Starts c1's guide and runs its job to the end with the washing draft; SAM finds the dial.
async fn made() -> GuideWorld {
    let w = GuideWorld::new().unwrap();
    w.writer.answers(washing_draft());
    w.tracker
        .concept("dial", vec![sam_record(0, 1, (100.0, 120.0, 180.0, 200.0))]);
    start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();
    w.run_once().await.unwrap();
    w
}

#[tokio::test]
async fn starting_queues_one_guide_job_and_a_second_start_answers_the_same_guide() {
    let w = GuideWorld::new().unwrap();

    let first = start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();
    let again = start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();

    assert_eq!(first.guide_id, g1());
    assert_eq!(first.status, GuideStatus::Queued);
    assert_eq!(again.guide_id, g1(), "one guide per clip");
    let jobs = w.jobs.all();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        (jobs[0].job.kind, jobs[0].job.subject_id.as_str()),
        (JobKind::Guide, "id-1")
    );
}

#[tokio::test]
async fn another_users_clip_is_forbidden_and_a_missing_one_not_found() {
    let w = GuideWorld::new().unwrap();

    let foreign = start_guide(&w.ports, &user("u2"), &c1()).await.unwrap_err();
    let missing = start_guide(&w.ports, &user("u1"), &ClipId::parse("nope").unwrap())
        .await
        .unwrap_err();

    assert_eq!(foreign.code, ErrorCode::Forbidden);
    assert_eq!(missing.code, ErrorCode::NotFound);
    assert!(w.jobs.all().is_empty());
}

#[tokio::test]
async fn a_clip_not_ready_or_over_five_minutes_makes_no_guide() {
    for (status, duration_s) in [(ClipStatus::Processing, 60.0), (ClipStatus::Ready, 301.0)] {
        let w = GuideWorld::new().unwrap();
        let mut other = clip(Some(probe(duration_s, true))).unwrap();
        other.id = ClipId::parse("c2").unwrap();
        other.status = status;
        w.catalogue.put_clip(other);

        let err = start_guide(&w.ports, &user("u1"), &ClipId::parse("c2").unwrap())
            .await
            .unwrap_err();

        assert_eq!(
            err.code,
            ErrorCode::ValidationFailed,
            "{status:?} {duration_s}"
        );
        assert!(w.jobs.all().is_empty());
    }
}

#[tokio::test]
async fn the_job_makes_every_step_with_a_frame_clip_voice_and_the_found_control_circled() {
    let w = made().await;

    let g = w.guides.guide("id-1").unwrap();
    assert_eq!(
        (g.status, g.stage, g.safety, g.title.as_str()),
        (
            GuideStatus::Ready,
            Some(GuideStage::Ready),
            Some(Safety::Everyday),
            "Start a quick wash"
        )
    );
    let steps = w.guides.steps_of("id-1");
    let images: Vec<Option<String>> = steps
        .iter()
        .map(|s| s.image_key.as_ref().map(ToString::to_string))
        .collect();
    assert_eq!(
        images,
        [
            Some("users/u1/guides/id-1/step_1.jpg".into()),
            Some("users/u1/guides/id-1/step_2_frame.jpg".into()),
            Some("users/u1/guides/id-1/step_3_frame.jpg".into()),
        ],
        "only the step whose control SAM found shows the circled still"
    );
    let highlights: Vec<Option<&str>> = steps.iter().map(|s| s.highlight.as_deref()).collect();
    assert_eq!(highlights, [Some("dial"), None, None]);
    assert_eq!(
        steps[1].clip_key.as_ref().unwrap().as_str(),
        "users/u1/guides/id-1/step_2.mp4"
    );
    assert!(steps.iter().all(|s| s.audio_key.is_some()));
    assert_eq!(
        w.narrator.spoken(),
        [
            "Step 1. Do the thing at 0.",
            "Step 2. Do the thing at 10.",
            "Step 3. Do the thing at 20."
        ]
    );
}

#[tokio::test]
async fn spark_sees_the_whole_clip_at_360p_and_frames_and_clips_come_from_the_proxy() {
    let w = made().await;

    assert_eq!(
        w.writer.seen(),
        [("guide_id-1_360p.mp4".into(), 60.0, "(no speech)".into())]
    );
    let calls = w.media.calls();
    assert_eq!(
        calls[0],
        "snippet 0-60 sam_proxy.mp4 -> guide_id-1_360p.mp4"
    );
    assert!(calls.contains(&"frame@1 sam_proxy.mp4 -> guide_id-1_frame_1.jpg".to_owned()));
    assert!(calls.contains(&"range 10-20@30 sam_proxy.mp4 -> guide_id-1_step_2.mp4".to_owned()));
    assert_eq!(w.blobs.gets(), ["users/u1/proxies/c1_720p.mp4"]);
}

#[tokio::test]
async fn sam_gets_each_named_control_on_its_frame_and_the_still_rings_its_outline() {
    let w = made().await;

    let seen = w.tracker.seen();
    let prompts: Vec<&SamPrompt> = seen.iter().map(|s| &s.prompt).collect();
    assert_eq!(
        prompts,
        [
            &SamPrompt::Concept("dial".into()),
            &SamPrompt::Concept("start button".into())
        ],
        "a step without a control asks nothing"
    );
    assert!(
        seen.iter()
            .all(|s| s.image && s.purpose == "guide_highlight")
    );
    assert_eq!(seen[0].media, "guide_id-1_frame_1.jpg");
    let stills = w.masks.stills();
    assert_eq!(stills.len(), 1);
    let (props, out) = &stills[0];
    assert_eq!(
        props.image_url,
        "https://signed/users/u1/guides/id-1/step_1_frame.jpg?ttl=3600"
    );
    assert_eq!((props.width, props.height), (480, 640));
    assert_eq!(props.outline, "M100 120Z");
    assert_eq!(out, "https://put/users/u1/guides/id-1/step_1.jpg?ttl=3600");
}

#[tokio::test]
async fn a_weak_sam_match_or_a_failed_still_keeps_the_plain_frame() {
    let w = GuideWorld::new().unwrap();
    w.writer.answers(washing_draft());
    let mut weak = sam_record(0, 1, (1.0, 1.0, 50.0, 50.0));
    weak.conf = 0.3;
    w.tracker.concept("dial", vec![weak]);
    w.tracker
        .concept("start button", vec![sam_record(0, 1, (1.0, 1.0, 9.0, 9.0))]);
    w.masks.fail_stills();
    start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();

    w.run_once().await.unwrap();

    let steps = w.guides.steps_of("id-1");
    assert!(steps.iter().all(|s| s.highlight.is_none()));
    assert_eq!(
        steps[1].image_key.as_ref().unwrap().as_str(),
        "users/u1/guides/id-1/step_2_frame.jpg"
    );
    assert_eq!(
        w.masks.stills().len(),
        1,
        "only the confident match was drawn"
    );
    assert_eq!(w.guides.guide("id-1").unwrap().status, GuideStatus::Ready);
}

#[tokio::test]
async fn a_not_supported_task_is_refused_with_no_steps_and_no_frames() {
    let w = GuideWorld::new().unwrap();
    let mut draft = washing_draft();
    draft.safety = Safety::NotSupported;
    draft.safety_reason = "Medication needs a professional.".into();
    w.writer.answers(draft);
    start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();

    w.run_once().await.unwrap();

    let g = w.guides.guide("id-1").unwrap();
    assert_eq!(
        (g.status, g.safety, g.safety_reason.as_deref()),
        (
            GuideStatus::Refused,
            Some(Safety::NotSupported),
            Some("Medication needs a professional.")
        )
    );
    assert!(w.guides.steps_of("id-1").is_empty());
    assert_eq!(w.media.calls().len(), 1, "only the 360p copy for Spark");
    assert!(w.tracker.seen().is_empty() && w.narrator.spoken().is_empty());
}

#[tokio::test]
async fn a_failed_narrator_leaves_the_steps_silent_but_the_guide_ready() {
    let w = GuideWorld::new().unwrap();
    w.writer.answers(washing_draft());
    w.narrator.fail();
    start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();

    w.run_once().await.unwrap();

    assert_eq!(w.guides.guide("id-1").unwrap().status, GuideStatus::Ready);
    assert!(
        w.guides
            .steps_of("id-1")
            .iter()
            .all(|s| s.audio_key.is_none())
    );
}

#[tokio::test]
async fn a_guide_whose_job_gives_up_is_failed_and_starting_again_requeues_it() {
    let w = GuideWorld::new().unwrap();
    start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();
    for _ in 0..3 {
        w.run_once().await.unwrap();
        w.clock.advance(60_000);
    }
    let g = w.guides.guide("id-1").unwrap();
    assert_eq!(g.status, GuideStatus::Failed);
    assert_eq!(g.error.as_deref(), Some("no draft scripted"));

    let again = start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();

    assert_eq!(again.status, GuideStatus::Queued);
    assert_eq!(w.jobs.all()[0].status, "queued");
    w.writer.answers(washing_draft());
    w.run_once().await.unwrap();
    assert_eq!(w.guides.guide("id-1").unwrap().status, GuideStatus::Ready);
}

#[tokio::test]
async fn the_guide_view_signs_every_file_and_the_list_shows_the_first_image() {
    let w = made().await;

    let view = get_guide(&w.ports, &user("u1"), &g1()).await.unwrap();
    let list = list_guides(&w.ports, &user("u1")).await.unwrap();

    assert_eq!(view.steps.len(), 3);
    assert_eq!(
        view.steps[0].clip_url.as_deref(),
        Some("https://signed/users/u1/guides/id-1/step_1.mp4?ttl=3600")
    );
    assert_eq!(view.steps[0].highlight.as_deref(), Some("dial"));
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].step_count, 3);
    assert_eq!(
        list[0].cover_url.as_deref(),
        Some("https://signed/users/u1/guides/id-1/step_1.jpg?ttl=3600")
    );
    let foreign = get_guide(&w.ports, &user("u2"), &g1()).await.unwrap_err();
    assert_eq!(foreign.code, ErrorCode::Forbidden);
    assert!(list_guides(&w.ports, &user("u2")).await.unwrap().is_empty());
}

#[tokio::test]
async fn editing_an_instruction_speaks_only_that_step_again_and_drops_its_old_voice() {
    let w = made().await;
    let old = w.guides.steps_of("id-1")[1].audio_key.clone().unwrap();
    let edit = StepEdit {
        title: None,
        instruction: Some("Press the start button"),
    };

    let step = edit_step(&w.ports, &user("u1"), (&g1(), 2), edit)
        .await
        .unwrap();

    assert_eq!(step.instruction, "Press the start button");
    assert_eq!(
        w.narrator.spoken().last().map(String::as_str),
        Some("Step 2. Press the start button.")
    );
    assert_eq!(w.narrator.spoken().len(), 4, "one new sentence");
    assert_eq!(w.blobs.deleted(), [old.to_string()]);
    let stored = &w.guides.steps_of("id-1")[1];
    assert_ne!(stored.audio_key.as_ref(), Some(&old));
    assert_eq!(stored.title, "Step at 10");
}

#[tokio::test]
async fn a_title_edit_keeps_the_voice_and_bad_edits_are_refused() {
    let w = made().await;
    let title_only = StepEdit {
        title: Some("Turn the dial"),
        instruction: None,
    };

    edit_step(&w.ports, &user("u1"), (&g1(), 1), title_only)
        .await
        .unwrap();

    assert_eq!(w.narrator.spoken().len(), 3, "the sentence did not change");
    assert!(w.blobs.deleted().is_empty());
    let err = |user_id: &str, n: u32, edit: StepEdit<'static>| {
        let p = w.ports.clone();
        let u = user(user_id);
        async move { edit_step(&p, &u, (&g1(), n), edit).await.unwrap_err().code }
    };
    let empty = StepEdit {
        title: Some(" "),
        instruction: None,
    };
    assert_eq!(err("u2", 1, title_only).await, ErrorCode::Forbidden);
    assert_eq!(err("u1", 9, title_only).await, ErrorCode::NotFound);
    assert_eq!(err("u1", 1, empty).await, ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn deleting_a_guide_removes_its_files_rows_and_job() {
    let w = made().await;

    delete_guide(&w.ports, &user("u1"), &g1()).await.unwrap();

    let deleted = w.blobs.deleted();
    assert!(deleted.contains(&"users/u1/guides/id-1/step_3_frame.jpg".to_owned()));
    assert!(deleted.contains(&"users/u1/guides/id-1/step_1.mp4".to_owned()));
    assert!(deleted.iter().any(|k| k.contains("/voice_")));
    assert!(
        deleted
            .iter()
            .all(|k| k.starts_with("users/u1/guides/id-1/"))
    );
    assert!(w.guides.guide("id-1").is_none());
    assert!(w.jobs.all().is_empty());
    let again = delete_guide(&w.ports, &user("u1"), &g1())
        .await
        .unwrap_err();
    assert_eq!(again.code, ErrorCode::NotFound);
}

#[tokio::test]
async fn the_guide_view_carries_its_clip_and_shows_the_reason_only_for_caution() {
    let w = GuideWorld::new().unwrap();
    let mut draft = washing_draft();
    draft.safety = Safety::Caution;
    draft.safety_reason = "Hot water.".into();
    w.writer.answers(draft);
    start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();
    w.run_once().await.unwrap();

    let view = get_guide(&w.ports, &user("u1"), &g1()).await.unwrap();
    let list = list_guides(&w.ports, &user("u1")).await.unwrap();

    assert_eq!(view.safety_reason.as_deref(), Some("Hot water."));
    assert_eq!(view.clip.duration_s, Some(60.0));
    assert_eq!(view.clip.title, None, "the test clip has no title yet");
    assert_eq!(list[0].clip, view.clip);
    let everyday = made().await;
    let plain = get_guide(&everyday.ports, &user("u1"), &g1())
        .await
        .unwrap();
    assert_eq!(plain.safety_reason, None, "nothing to warn about");
}

#[tokio::test]
async fn starting_a_ready_guide_again_answers_it_ready_and_never_reruns_its_job() {
    let w = made().await;

    let again = start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();

    assert_eq!((again.guide_id, again.status), (g1(), GuideStatus::Ready));
    assert_eq!(
        w.jobs.all()[0].status,
        "done",
        "the finished job is not restarted"
    );
    assert_eq!(w.writer.seen().len(), 1);
}

#[tokio::test]
async fn a_guide_still_being_made_cannot_be_edited() {
    let w = GuideWorld::new().unwrap();
    start_guide(&w.ports, &user("u1"), &c1()).await.unwrap();
    let edit = StepEdit {
        title: Some("Mine"),
        instruction: None,
    };

    let err = edit_step(&w.ports, &user("u1"), (&g1(), 1), edit)
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::ValidationFailed);
}
