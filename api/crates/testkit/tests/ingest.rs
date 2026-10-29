//! Ingest pipeline against fakes: step order, outputs, resume after a crash, failure handling.

#![cfg(test)]

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::{ClipId, JobId};
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::keys;
use nimbytes_core::ports::JobQueue;
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::world::{CLIP, IngestWorld as World, clip, probe, said};

#[tokio::test]
async fn a_fresh_clip_runs_every_media_step_in_order() {
    let w = World::new(probe(21.5, true), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();
    w.transcriber
        .returns(vec![said(5_820, 13_980, "with food.")]);

    w.run_once().await.unwrap();

    assert_eq!(
        w.media.calls(),
        [
            "probe original.mov",
            "proxy original.mov -> proxy_720p.mp4",
            "fps1 proxy_720p.mp4 -> fps1.mp4",
            "wav 0-21.5 original.mov -> audio.wav",
            "cuts proxy_720p.mp4",
            "thumb@4 proxy_720p.mp4 -> thumb_0.jpg",
            "snippet 0-8 proxy_720p.mp4 -> snippet_0.mp4",
            "thumb@11.375 proxy_720p.mp4 -> thumb_1.jpg",
            "snippet 8-14.75 proxy_720p.mp4 -> snippet_1.mp4",
            "thumb@18.125 proxy_720p.mp4 -> thumb_2.jpg",
            "snippet 14.75-21.5 proxy_720p.mp4 -> snippet_2.mp4",
        ]
    );
}

#[tokio::test]
async fn a_fresh_clip_uploads_every_derived_file_and_ends_ready_with_scratch_freed() {
    let w = World::new(probe(21.5, true), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();

    w.run_once().await.unwrap();

    assert_eq!(
        w.blobs.gets(),
        ["users/u1/originals/c1.mov"],
        "original fetched once"
    );
    let keys: Vec<String> = w.blobs.puts().into_iter().map(|(k, _)| k).collect();
    assert_eq!(
        &keys[..3],
        [
            "users/u1/proxies/c1_720p.mp4",
            "users/u1/proxies/c1_fps1.mp4",
            "users/u1/audio/c1.wav"
        ]
    );
    assert_eq!(keys[3], "users/u1/thumbs/c1/c1-s0.jpg");
    assert_eq!(keys[4], "users/u1/snippets/c1/c1-s0.mp4");
    assert_eq!(keys.len(), 9);
    let immutable = Some(nimbytes_core::keys::DERIVED_CACHE_CONTROL.to_owned());
    assert!(w.blobs.cache_controls().iter().all(|c| *c == immutable));
    let stored = w.stored().unwrap();
    assert_eq!(stored.status, ClipStatus::Ready);
    assert_eq!(stored.probe.unwrap().duration_s, 21.5);
    assert_eq!(w.scratch.removed(), [CLIP]);
}

#[tokio::test]
async fn transcript_turns_get_speakers_and_join_every_overlapping_segment() {
    let w = World::new(probe(21.5, true), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();
    w.transcriber.returns(vec![
        said(5_820, 13_980, " with food. "),
        said(15_000, 16_000, " "),
    ]);

    w.run_once().await.unwrap();

    let t = w
        .catalogue
        .transcript(&ClipId::parse(CLIP).unwrap())
        .unwrap();
    assert_eq!(t.speakers.len(), 1);
    assert_eq!(
        (t.speakers[0].id.as_str(), t.speakers[0].label.as_str()),
        ("c1-p0", "A")
    );
    assert_eq!(t.turns.len(), 1, "blank turns dropped");
    assert_eq!(t.turns[0].id.as_str(), "c1-t0");
    assert_eq!(t.turns[0].turn.text, "with food.");
    assert_eq!(t.turns[0].speaker_id.as_ref().unwrap().as_str(), "c1-p0");
    let links: Vec<(&str, &str)> = t
        .links
        .iter()
        .map(|(s, t)| (s.as_str(), t.as_str()))
        .collect();
    assert_eq!(links, [("c1-s0", "c1-t0"), ("c1-s1", "c1-t0")]);
}

#[tokio::test]
async fn every_step_publishes_running_then_done() {
    let w = World::new(probe(6.0, false), vec![], clip(None).unwrap())
        .await
        .unwrap();

    w.run_once().await.unwrap();

    let events = w.progress.events();
    assert_eq!(
        events.len(),
        24,
        "running and done for each of the 12 steps"
    );
    assert_eq!(&events[..2], ["c1 probe Running", "c1 probe Done"]);
    assert_eq!(events.last().unwrap(), "c1 ready Done");
}

#[tokio::test]
async fn resume_after_segments_runs_only_later_steps_and_refetches_lost_files() {
    let w = World::new(
        probe(6.0, true),
        vec![],
        clip(Some(probe(6.0, true))).unwrap(),
    )
    .await
    .unwrap();
    let id = JobId::parse("j1").unwrap();
    w.queue.advance(&id, "segments", 0).await.unwrap();
    w.transcriber.returns(vec![said(0, 1_000, "hi")]);

    w.run_once().await.unwrap();

    assert!(
        w.media.calls().is_empty(),
        "no media step reran: {:?}",
        w.media.calls()
    );
    assert_eq!(
        w.blobs.gets(),
        ["users/u1/audio/c1.wav", "users/u1/proxies/c1_fps1.mp4"],
        "scratch was empty, so the WAV and the 1 fps copy came back from S3"
    );
    assert_eq!(w.transcriber.calls(), ["audio.wav"]);
    assert_eq!(w.stored().unwrap().status, ClipStatus::Ready);
}

#[tokio::test]
async fn a_scratch_file_left_by_an_earlier_run_is_not_downloaded_again() {
    let w = World::new(
        probe(6.0, true),
        vec![],
        clip(Some(probe(6.0, true))).unwrap(),
    )
    .await
    .unwrap();
    w.queue
        .advance(&JobId::parse("j1").unwrap(), "segments", 0)
        .await
        .unwrap();
    w.scratch.add("/scratch/c1/audio.wav");
    w.scratch.add("/scratch/c1/fps1.mp4");

    w.run_once().await.unwrap();

    assert!(w.blobs.gets().is_empty());
}

#[tokio::test]
async fn a_clip_without_audio_skips_the_wav_and_stores_an_empty_transcript() {
    let w = World::new(probe(6.0, false), vec![], clip(None).unwrap())
        .await
        .unwrap();

    w.run_once().await.unwrap();

    assert!(!w.media.calls().iter().any(|c| c.starts_with("wav")));
    assert!(w.transcriber.calls().is_empty());
    assert_eq!(
        w.catalogue
            .transcript(&ClipId::parse(CLIP).unwrap())
            .unwrap()
            .turns
            .len(),
        0
    );
}

#[tokio::test]
async fn audio_longer_than_9_5_minutes_is_transcribed_in_chunks() {
    let w = World::new(probe(1200.0, true), vec![], clip(None).unwrap())
        .await
        .unwrap();

    w.run_once().await.unwrap();

    assert_eq!(
        w.transcriber.calls(),
        ["audio_0.wav", "audio_1.wav", "audio_2.wav"]
    );
    assert!(
        w.media
            .calls()
            .contains(&"wav 570-1140 audio.wav -> audio_1.wav".to_owned())
    );
}

#[tokio::test]
async fn the_third_failure_marks_the_clip_failed_with_the_error_code() {
    let w = World::new(probe(6.0, true), vec![], clip(None).unwrap())
        .await
        .unwrap();
    w.transcriber
        .fails_with(AppError::new(ErrorCode::ModelUnavailable, "503"));

    for _ in 0..3 {
        w.run_once().await.unwrap();
        w.clock.advance(60_000);
    }

    assert_eq!(w.stored().unwrap().status, ClipStatus::Failed);
    assert_eq!(
        w.catalogue.last_error(&ClipId::parse(CLIP).unwrap()),
        Some(ErrorCode::ModelUnavailable)
    );
    assert_eq!(w.progress.events().last().unwrap(), "c1 transcribe Failed");
    assert_eq!(
        w.transcriber.calls().len(),
        3,
        "earlier steps ran once, transcribe retried"
    );
    assert_eq!(
        w.media
            .calls()
            .iter()
            .filter(|c| c.starts_with("proxy"))
            .count(),
        1
    );
}

#[tokio::test]
async fn a_proxy_the_mac_app_uploaded_is_used_instead_of_encoding_one() -> Result<(), AppError> {
    let original = probe(21.5, true);
    let w = World::new(original.clone(), vec![8.0], clip(None)?).await?;
    let stored = w.stored()?;
    w.blobs
        .store(keys::proxy_720p(&stored.user_id, &stored.id).as_str(), 900);
    w.media.set_proxy_probe(ProbeInfo {
        width: 720,
        height: 1280,
        codec: "h264".into(),
        ..original
    });

    for _ in 0..12 {
        if w.run_once().await.is_err() {
            break;
        }
    }

    let calls = w.media.calls();
    assert!(!calls.iter().any(|c| c.starts_with("proxy")), "{calls:?}");
    assert!(
        calls.contains(&"probe proxy_720p.mp4".to_owned()),
        "{calls:?}"
    );
    assert!(
        calls.contains(&"fps1 proxy_720p.mp4 -> fps1.mp4".to_owned()),
        "{calls:?}"
    );
    Ok(())
}

#[tokio::test]
async fn an_uploaded_proxy_that_does_not_match_is_replaced_by_an_encode() -> Result<(), AppError> {
    let original = probe(21.5, true);
    let w = World::new(original.clone(), vec![8.0], clip(None)?).await?;
    let stored = w.stored()?;
    w.blobs
        .store(keys::proxy_720p(&stored.user_id, &stored.id).as_str(), 900);
    w.media.set_proxy_probe(ProbeInfo {
        duration_s: 5.0,
        codec: "h264".into(),
        ..original
    });

    for _ in 0..12 {
        if w.run_once().await.is_err() {
            break;
        }
    }

    assert!(
        w.media
            .calls()
            .iter()
            .any(|c| c == "proxy original.mov -> proxy_720p.mp4")
    );
    Ok(())
}
