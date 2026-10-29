//! Near-copies and same-moment clips over fakes: a near-copy stops before the paid steps, Keep
//! both resumes it, a same-moment clip is processed fully and linked, and the backfill links the
//! existing library without downgrading a ready clip.

#![cfg(test)]

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, JobId, SegmentId, UserId};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::similar::LinkKind;
use nimbytes_core::ports::{Catalogue, JobQueue, VectorIndex};
use nimbytes_core::usecases::jobs::backfill_similar;
use nimbytes_core::usecases::similar::{KeepDeps, keep_clip};
use nimbytes_testkit::world::{CLIP, IngestWorld as World, clip, probe, said};
use nimbytes_testkit::{FixedClock, SequentialIds, vector_of};

/// The vector the fake embedder gives the clip under test's only moment.
fn own_vector() -> Vec<f32> {
    vector_of(&format!("/scratch/{CLIP}/thumb_0.jpg"))
}

/// `own_vector` turned towards a fourth axis, so its cosine similarity to it is `similarity`.
fn alike(similarity: f32) -> Vec<f32> {
    let v = own_vector();
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mut out: Vec<f32> = v.iter().map(|x| x / n * similarity).collect();
    out[3] = (1.0 - similarity * similarity).sqrt();
    out
}

fn id(s: &str) -> ClipId {
    ClipId::parse(s).unwrap()
}

/// An older ready clip `c0`, 6 s with one moment carrying `vector`, recorded at `recorded_at`.
async fn older(w: &World, vector: &[f32], recorded_at: &str) {
    let mut p = probe(6.0, true);
    p.recorded_at = Some(recorded_at.into());
    let c0 = Clip {
        id: id("c0"),
        status: ClipStatus::Ready,
        created_at: "2026-10-26T01:00:00.000Z".into(),
        title: Some("Beach walk".into()),
        filename: "beach.mov".into(),
        ..clip(Some(p)).unwrap()
    };
    let seg = SegmentId::parse("c0-s0").unwrap();
    w.catalogue.put_clip(c0);
    w.catalogue.put_segments(&[Segment {
        id: seg.clone(),
        clip_id: id("c0"),
        idx: 0,
        span: Span {
            start_s: 0.0,
            end_s: 6.0,
        },
    }]);
    w.vectors
        .upsert(&seg, &UserId::parse("u1").unwrap(), vector)
        .await
        .unwrap();
}

async fn world() -> World {
    let w = World::new(probe(6.0, true), vec![], clip(None).unwrap())
        .await
        .unwrap();
    w.transcriber.returns(vec![said(0, 1_000, "hello")]);
    w
}

#[tokio::test]
async fn a_near_copy_stops_before_transcribe_and_is_linked_to_its_original() {
    let w = world().await;
    older(&w, &own_vector(), "2025-01-01T00:00:00.000Z").await;

    w.run_once().await.unwrap();

    let stored = w.stored().unwrap();
    assert_eq!(stored.status, ClipStatus::NearCopy);
    assert!(w.transcriber.calls().is_empty(), "no transcribe");
    assert!(w.describer.calls().is_empty(), "no describe");
    assert_eq!(w.tracker.calls(), 0, "no faces");
    assert!(w.text_index.docs().is_empty(), "not indexed");
    let links = w.links.all();
    assert_eq!(links.len(), 1, "{links:?}");
    assert_eq!(
        (&links[0].clip, &links[0].other, links[0].kind),
        (&id(CLIP), &id("c0"), LinkKind::NearCopyOf)
    );
    assert!((links[0].score - 1.0).abs() < 1e-6);
    assert_eq!(w.queue.all()[0].status, "done");
    assert_eq!(w.scratch.removed(), [CLIP], "scratch freed");
    let c0 = w.catalogue.clip(&id("c0")).unwrap();
    assert_eq!(c0.status, ClipStatus::Ready, "the original is untouched");
}

#[tokio::test]
async fn keep_both_resumes_the_near_copy_from_transcribe_and_it_is_never_linked_again() {
    let w = world().await;
    older(&w, &own_vector(), "2025-01-01T00:00:00.000Z").await;
    w.run_once().await.unwrap();
    let media_calls = w.media.calls().len();

    let clock = FixedClock::at(0);
    let deps = KeepDeps {
        catalogue: w.catalogue.as_ref(),
        links: w.links.as_ref(),
        jobs: &w.queue,
        clock: &clock,
    };
    let user = UserId::parse("u1").unwrap();
    let status = keep_clip(&deps, &user, &id(CLIP)).await.unwrap();
    assert_eq!(status, ClipStatus::Processing);
    assert_eq!(w.queue.all()[0].job.step.as_deref(), Some("similar"));

    w.run_once().await.unwrap();

    assert_eq!(w.stored().unwrap().status, ClipStatus::Ready);
    assert_eq!(w.transcriber.calls(), ["audio.wav"], "the paid steps ran");
    assert!(!w.text_index.docs().is_empty(), "searchable now");
    assert_eq!(
        w.media.calls().len(),
        media_calls,
        "no media step ran again"
    );
    assert_eq!(
        w.links.all().iter().map(|l| l.kind).collect::<Vec<_>>(),
        [LinkKind::Kept]
    );
    let again = keep_clip(&deps, &user, &id(CLIP)).await.unwrap_err();
    assert_eq!(again.code, nimbytes_core::ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn another_angle_filmed_minutes_apart_is_processed_fully_and_linked() {
    let w = world().await;
    // 0.88: over the same-moment bar, under the near-copy mean. The clip under test was recorded
    // at 05:59; the other angle four minutes later.
    older(&w, &alike(0.88), "2026-01-28T06:03:00.000Z").await;

    w.run_once().await.unwrap();

    assert_eq!(w.stored().unwrap().status, ClipStatus::Ready);
    assert_eq!(w.transcriber.calls(), ["audio.wav"]);
    let links = w.links.all();
    assert_eq!(links.len(), 1, "{links:?}");
    assert_eq!(
        (&links[0].clip, &links[0].other, links[0].kind),
        (&id("c0"), &id(CLIP), LinkKind::SameMoment),
        "one row, lower id first"
    );
}

#[tokio::test]
async fn the_same_look_two_hours_apart_is_not_linked() {
    let w = world().await;
    older(&w, &alike(0.88), "2026-01-28T08:00:00.000Z").await;

    w.run_once().await.unwrap();

    assert_eq!(w.stored().unwrap().status, ClipStatus::Ready);
    assert!(w.links.all().is_empty());
}

/// The clip under test ready (ingested before near-copy detection, so its moment was never
/// checked for blankness) beside an older checked original; its ingest job is done.
async fn ready_copy() -> World {
    let ready = Clip {
        status: ClipStatus::Ready,
        ..clip(Some(probe(6.0, true))).unwrap()
    };
    let w = World::new(probe(6.0, true), vec![], ready).await.unwrap();
    w.catalogue.put_segments(&[Segment {
        id: SegmentId::parse("c1-s0").unwrap(),
        clip_id: id(CLIP),
        idx: 0,
        span: Span {
            start_s: 0.0,
            end_s: 6.0,
        },
    }]);
    older(&w, &own_vector(), "2025-01-01T00:00:00.000Z").await;
    w.catalogue
        .set_segment_blank(&SegmentId::parse("c0-s0").unwrap(), false)
        .await
        .unwrap();
    w.queue.done(&JobId::parse("j1").unwrap(), 0).await.unwrap();
    w
}

#[tokio::test]
async fn the_backfill_links_a_ready_copy_without_downgrading_it() {
    let w = ready_copy().await;
    let (ids, clock) = (SequentialIds::new("similar-job"), FixedClock::at(0));
    let queued = backfill_similar(w.catalogue.as_ref(), &w.queue, (&ids, &clock))
        .await
        .unwrap();
    assert_eq!(queued, 1, "only the unchecked clip");

    w.run_once().await.unwrap();

    assert_eq!(
        w.stored().unwrap().status,
        ClipStatus::Ready,
        "never downgraded"
    );
    let links = w.links.all();
    assert_eq!(links.len(), 1, "{links:?}");
    assert_eq!(
        (&links[0].clip, &links[0].other, links[0].kind),
        (&id(CLIP), &id("c0"), LinkKind::NearCopyOf)
    );
    assert!(
        w.transcriber.calls().is_empty(),
        "the backfill calls no model"
    );
}

#[tokio::test]
async fn the_backfill_checks_each_clip_once() {
    let w = ready_copy().await;
    let (ids, clock) = (SequentialIds::new("similar-job"), FixedClock::at(0));
    backfill_similar(w.catalogue.as_ref(), &w.queue, (&ids, &clock))
        .await
        .unwrap();
    w.run_once().await.unwrap();

    assert_eq!(
        w.catalogue.blank(&SegmentId::parse("c1-s0").unwrap()),
        Some(false),
        "checked now"
    );
    let again = backfill_similar(w.catalogue.as_ref(), &w.queue, (&ids, &clock))
        .await
        .unwrap();
    assert_eq!(again, 0, "never queued again");
}
