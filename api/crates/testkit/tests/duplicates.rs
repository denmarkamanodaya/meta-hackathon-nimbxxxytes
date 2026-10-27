//! Exact duplicates over fakes: a copy stops before any model call, the hash backfill marks the
//! newer twin, and removing a clip deletes exactly its objects.

#![cfg(test)]

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::usecases::jobs::backfill_hashes;
use nimbytes_testkit::SequentialIds;
use nimbytes_testkit::world::{CLIP, IngestWorld, clip, probe};

const ORIGINAL: &str = "/scratch/c1/original.mov";

fn id(raw: &str) -> ClipId {
    ClipId::parse(raw).unwrap()
}

/// The owner's earlier upload of the same file, already ingested and hashed.
fn earlier(hash: &str) -> Clip {
    Clip {
        id: id("c0"),
        status: ClipStatus::Ready,
        created_at: "2026-10-26T19:46:00.000Z".into(),
        content_sha256: Some(hash.into()),
        ..clip(None).unwrap()
    }
}

async fn world() -> IngestWorld {
    IngestWorld::new(probe(21.5, true), vec![8.0], clip(None).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn a_copy_of_an_owned_clip_stops_before_any_model_call() {
    let w = world().await;
    w.catalogue.put_clip(earlier("abc"));
    w.scratch.set_hash(ORIGINAL, "abc");

    w.run_once().await.unwrap();

    let stored = w.stored().unwrap();
    assert_eq!(
        (stored.status, stored.duplicate_of, stored.content_sha256),
        (ClipStatus::Duplicate, Some(id("c0")), Some("abc".into()))
    );
    assert!(
        w.media.calls().is_empty(),
        "not even probed: {:?}",
        w.media.calls()
    );
    assert!(w.transcriber.calls().is_empty());
    assert!(w.describer.calls().is_empty());
    assert!(w.titler.calls().is_empty());
    assert_eq!(w.tracker.calls(), 0);
    assert!(w.vectors.rows().is_empty() && w.text_index.docs().is_empty());
    assert_eq!(w.scratch.removed(), [CLIP], "scratch space is freed");
    let job = w.queue.all().into_iter().next().unwrap();
    assert_eq!(job.status, "done");
}

#[tokio::test]
async fn another_users_clip_failed_clips_and_other_bytes_are_not_twins() {
    for other in [
        Clip {
            user_id: UserId::parse("u2").unwrap(),
            ..earlier("abc")
        },
        Clip {
            status: ClipStatus::Failed,
            ..earlier("abc")
        },
        earlier("different"),
    ] {
        let w = world().await;
        w.catalogue.put_clip(other);
        w.scratch.set_hash(ORIGINAL, "abc");

        w.run_once().await.unwrap();

        let stored = w.stored().unwrap();
        assert_eq!(
            (stored.status, stored.duplicate_of),
            (ClipStatus::Ready, None)
        );
        assert_eq!(stored.content_sha256.as_deref(), Some("abc"));
        assert!(!w.describer.calls().is_empty(), "ingested in full");
    }
}

#[tokio::test]
async fn the_hash_backfill_marks_the_newer_twin_and_takes_it_out_of_search() {
    // c1 was ingested before hashing existed; c0 (older) holds the same hash.
    let w = world().await;
    w.run_once().await.unwrap();
    w.catalogue.clear_hash(&id(CLIP));
    w.catalogue.put_clip(earlier("abc"));
    w.scratch.set_hash(ORIGINAL, "abc");
    assert!(!w.text_index.docs().is_empty());
    let ids = SequentialIds::new("job");

    let queued = backfill_hashes(w.catalogue.as_ref(), &w.queue, (&ids, &w.clock)).await;
    w.run_once().await.unwrap();

    assert_eq!(queued.unwrap(), 1, "only the unhashed clip");
    let stored = w.stored().unwrap();
    assert_eq!(
        (stored.status, stored.duplicate_of),
        (ClipStatus::Duplicate, Some(id("c0")))
    );
    assert!(w.text_index.docs().is_empty(), "its documents leave search");
    assert!(w.vectors.rows().is_empty(), "and its vectors");
    let hash_job = w
        .queue
        .all()
        .into_iter()
        .find(|j| j.job.kind == JobKind::Hash)
        .unwrap();
    assert_eq!(
        (hash_job.job.subject_id.as_str(), hash_job.status),
        (CLIP, "done")
    );
    let again = backfill_hashes(w.catalogue.as_ref(), &w.queue, (&ids, &w.clock)).await;
    assert_eq!(again.unwrap(), 0);
}

#[tokio::test]
async fn when_the_older_clip_is_hashed_last_the_newer_one_still_becomes_the_copy() {
    // c1 (the job's clip) is the OLDER upload here; a newer ready twin c9 already holds the hash.
    let w = world().await;
    let newer = Clip {
        id: id("c9"),
        status: ClipStatus::Ready,
        created_at: "2026-10-28T00:00:00.000Z".into(),
        content_sha256: Some("abc".into()),
        ..clip(None).unwrap()
    };
    w.catalogue.put_clip(newer);
    w.scratch.set_hash(ORIGINAL, "abc");

    w.run_once().await.unwrap();

    let c9 = w.catalogue.clip(&id("c9")).unwrap();
    assert_eq!(
        (c9.status, c9.duplicate_of),
        (ClipStatus::Duplicate, Some(id(CLIP)))
    );
    let c1 = w.stored().unwrap();
    assert_eq!((c1.status, c1.duplicate_of), (ClipStatus::Ready, None));
}

mod removal {
    use nimbytes_core::ErrorCode;
    use nimbytes_core::domain::ids::TrackId;
    use nimbytes_core::domain::segment::TrackRow;
    use nimbytes_core::ports::Catalogue;
    use nimbytes_core::usecases::clips::{RemoveDeps, delete_clip};

    use super::*;

    /// An ingested clip (3 segments) with one face track.
    async fn ingested_with_a_face() -> IngestWorld {
        let w = world().await;
        w.run_once().await.unwrap();
        let track = TrackRow {
            id: TrackId::parse("c1-f0").unwrap(),
            ordinal: 0,
            first_s: 1.0,
            last_s: 2.0,
            crop_key: "users/u1/faces/c1/c1-f0.jpg".into(),
            max_area: 0.1,
        };
        w.catalogue
            .replace_face_tracks(&id(CLIP), &[track], &[])
            .await
            .unwrap();
        w
    }

    fn deps(w: &IngestWorld) -> RemoveDeps<'_> {
        RemoveDeps {
            catalogue: w.catalogue.as_ref(),
            blobs: w.blobs.as_ref(),
            text: w.text_index.as_ref(),
            vectors: w.vectors.as_ref(),
        }
    }

    #[tokio::test]
    async fn removing_a_clip_deletes_exactly_its_objects_documents_vectors_and_rows() {
        let w = ingested_with_a_face().await;
        let owner = UserId::parse("u1").unwrap();

        delete_clip(&deps(&w), &owner, &id(CLIP)).await.unwrap();

        assert_eq!(
            w.blobs.deleted(),
            [
                "users/u1/originals/c1.mov",
                "users/u1/proxies/c1_720p.mp4",
                "users/u1/proxies/c1_fps1.mp4",
                "users/u1/audio/c1.wav",
                "users/u1/snippets/c1/c1-s0.mp4",
                "users/u1/thumbs/c1/c1-s0.jpg",
                "users/u1/snippets/c1/c1-s1.mp4",
                "users/u1/thumbs/c1/c1-s1.jpg",
                "users/u1/snippets/c1/c1-s2.mp4",
                "users/u1/thumbs/c1/c1-s2.jpg",
                "users/u1/faces/c1/c1-f0.jpg",
            ]
        );
        assert!(w.text_index.docs().is_empty() && w.vectors.rows().is_empty());
        assert!(w.catalogue.clip(&id(CLIP)).is_none());
        assert!(
            w.catalogue
                .list_segments(&id(CLIP))
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn another_users_clip_is_forbidden_and_an_unknown_one_not_found_with_nothing_deleted() {
        let w = ingested_with_a_face().await;
        let stranger = UserId::parse("u2").unwrap();

        let theirs = delete_clip(&deps(&w), &stranger, &id(CLIP)).await;
        let missing = delete_clip(&deps(&w), &stranger, &id("nope")).await;

        assert_eq!(theirs.unwrap_err().code, ErrorCode::Forbidden);
        assert_eq!(missing.unwrap_err().code, ErrorCode::NotFound);
        assert!(w.blobs.deleted().is_empty());
        assert!(w.catalogue.clip(&id(CLIP)).is_some());
        assert_eq!(w.text_index.docs().len(), 3);
    }
}

mod giving_up {
    use nimbytes_core::domain::ids::JobId;
    use nimbytes_core::domain::job::Job;
    use nimbytes_core::ports::StepRunner;
    use nimbytes_core::{AppError, ErrorCode};

    use super::*;

    fn job(kind: JobKind) -> Job {
        Job {
            id: JobId::parse("j9").unwrap(),
            kind,
            subject_id: CLIP.into(),
            step: None,
            attempts: 3,
        }
    }

    #[tokio::test]
    async fn a_hash_or_title_job_that_gives_up_leaves_the_ready_clip_ready() {
        let w = world().await;
        w.run_once().await.unwrap();
        let err = AppError::new(ErrorCode::Internal, "s3 down");

        for kind in [JobKind::Hash, JobKind::Title] {
            w.steps().failed(&job(kind), &err).await.unwrap();
            assert_eq!(w.stored().unwrap().status, ClipStatus::Ready, "{kind:?}");
        }
        w.steps().failed(&job(JobKind::Ingest), &err).await.unwrap();
        assert_eq!(w.stored().unwrap().status, ClipStatus::Failed);
    }
}
