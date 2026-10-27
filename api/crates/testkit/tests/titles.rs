//! Clip titles over fakes: the ingest step, its fallback, and the backfill at worker start.

#![cfg(test)]

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::ClipId;
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::usecases::jobs::{backfill_faces, backfill_titles};
use nimbytes_testkit::SequentialIds;
use nimbytes_testkit::world::{CLIP, IngestWorld, clip, probe};

fn clip_id() -> ClipId {
    ClipId::parse(CLIP).unwrap()
}

/// An ingested 21.5 s clip with 3 segments, each described "a described moment".
async fn ingested(title: Option<&str>) -> IngestWorld {
    let w = IngestWorld::new(probe(21.5, false), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();
    if let Some(t) = title {
        w.titler.answers(t);
    }
    w.run_once().await.unwrap();
    w
}

#[tokio::test]
async fn ingest_titles_the_clip_from_its_segment_descriptions_only() {
    let w = ingested(Some("  \"Dog nap time.\" ")).await;

    let stored = w.catalogue.clip(&clip_id()).unwrap();
    assert_eq!(stored.title.as_deref(), Some("Dog nap time"));
    assert_eq!(stored.display_title(), "Dog nap time");
    assert_eq!(w.titler.calls(), [vec!["a described moment".to_owned(); 3]]);
}

#[tokio::test]
async fn a_failed_title_call_leaves_the_file_name_and_the_clip_still_ready() {
    let w = ingested(None).await;

    let stored = w.catalogue.clip(&clip_id()).unwrap();
    assert_eq!(
        (stored.title.as_deref(), stored.status),
        (None, ClipStatus::Ready)
    );
    assert_eq!(stored.display_title(), "IMG_0001");
}

#[tokio::test]
async fn the_backfill_titles_untitled_ready_clips_once() {
    let w = ingested(None).await;
    let ids = SequentialIds::new("job");
    w.titler.answers("Dog nap");

    let queued = backfill_titles(w.catalogue.as_ref(), &w.queue, (&ids, &w.clock)).await;
    w.run_once().await.unwrap();

    assert_eq!(queued.unwrap(), 1);
    let title_job = w
        .queue
        .all()
        .into_iter()
        .find(|j| j.job.kind == JobKind::Title)
        .unwrap();
    assert_eq!(
        (title_job.job.subject_id.as_str(), title_job.status),
        (CLIP, "done")
    );
    let stored = w.catalogue.clip(&clip_id()).unwrap();
    assert_eq!(stored.title.as_deref(), Some("Dog nap"));
    let again = backfill_titles(w.catalogue.as_ref(), &w.queue, (&ids, &w.clock)).await;
    assert_eq!(again.unwrap(), 0, "a titled clip is not queued again");
}

#[tokio::test]
async fn the_faces_backfill_runs_the_face_step_once_per_ready_clip() {
    let w = ingested(None).await;
    let ids = SequentialIds::new("job");
    let ready_before = w.catalogue.clip(&clip_id()).unwrap().status;

    let queued = backfill_faces(w.catalogue.as_ref(), &w.queue, (&ids, &w.clock)).await;
    w.run_once().await.unwrap();
    backfill_faces(w.catalogue.as_ref(), &w.queue, (&ids, &w.clock))
        .await
        .unwrap();

    assert_eq!(queued.unwrap(), 1);
    let faces: Vec<_> = w
        .queue
        .all()
        .into_iter()
        .filter(|j| j.job.kind == JobKind::Faces)
        .collect();
    assert_eq!(faces.len(), 1, "a second backfill queues nothing new");
    assert_eq!(faces[0].status, "done");
    assert_eq!(w.catalogue.clip(&clip_id()).unwrap().status, ready_before);
}
