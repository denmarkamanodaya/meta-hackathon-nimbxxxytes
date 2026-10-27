//! Upload use cases against in-memory fakes of every port.

#![cfg(test)]

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::{UploadId, UserId};
use nimbytes_core::domain::upload::{CompletedPart, MIB};
use nimbytes_core::keys::ObjectClass;
use nimbytes_core::usecases::uploads::{
    NewUpload, UploadDeps, complete_upload, create_upload, presign_parts, presign_proxy,
};
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::{
    FakeBlobStore, FixedClock, InMemoryCatalogue, InMemoryJobQueue, SequentialIds,
};

struct World {
    blobs: FakeBlobStore,
    catalogue: InMemoryCatalogue,
    jobs: InMemoryJobQueue,
    clock: FixedClock,
    ids: SequentialIds,
}

impl World {
    fn new() -> Self {
        Self {
            blobs: FakeBlobStore::default(),
            catalogue: InMemoryCatalogue::default(),
            jobs: InMemoryJobQueue::default(),
            clock: FixedClock::at(1_793_062_923_456),
            ids: SequentialIds::new("id"),
        }
    }

    fn deps(&self) -> UploadDeps<'_> {
        UploadDeps {
            blobs: &self.blobs,
            catalogue: &self.catalogue,
            jobs: &self.jobs,
            clock: &self.clock,
            ids: &self.ids,
        }
    }
}

fn alice() -> UserId {
    UserId::parse("alice").unwrap()
}

fn twenty_mib_mov() -> NewUpload {
    NewUpload {
        filename: "IMG_0001.MOV".into(),
        size_bytes: 20 * MIB,
        content_type: "video/quicktime".into(),
    }
}

fn all_parts(n: u32) -> Vec<CompletedPart> {
    (1..=n)
        .map(|n| CompletedPart {
            n,
            etag: format!("\"e{n}\""),
        })
        .collect()
}

#[tokio::test]
async fn create_tags_the_original_and_presigns_every_part() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();

    assert_eq!(created.clip_id.as_str(), "id-1");
    assert_eq!(created.upload_id.as_str(), "id-2");
    assert_eq!(created.part_size, 8 * MIB);
    let numbers: Vec<u32> = created.parts.iter().map(|p| p.n).collect();
    assert_eq!(numbers, [1, 2, 3]);
    assert_eq!(
        created.parts[2].url,
        "https://fake/users/alice/originals/id-1.mov?uploadId=s3-upload-1&partNumber=3"
    );
    let calls = w.blobs.created();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].key, "users/alice/originals/id-1.mov");
    assert_eq!(calls[0].content_type, "video/quicktime");
    assert_eq!(calls[0].class, ObjectClass::Original);
    let clip = w.catalogue.clip(&created.clip_id).unwrap();
    assert_eq!(clip.status, ClipStatus::Uploading);
    assert_eq!(clip.created_at, "2026-10-27T01:02:03.456Z");
}

#[tokio::test]
async fn complete_registers_the_clip_and_queues_one_ingest_job() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();
    w.blobs.set_completed_size(20 * MIB);

    let clip_id = complete_upload(&w.deps(), &alice(), &created.upload_id, &all_parts(3))
        .await
        .unwrap();

    assert_eq!(clip_id, created.clip_id);
    assert_eq!(
        w.catalogue.clip(&clip_id).unwrap().status,
        ClipStatus::Uploaded
    );
    assert_eq!(w.blobs.completed()[0].1, all_parts(3));
    let jobs = w.jobs.all();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].job.subject_id, clip_id.as_str());
    assert_eq!(jobs[0].status, "queued");
}

#[tokio::test]
async fn completing_twice_keeps_one_job_and_skips_the_store() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();
    w.blobs.set_completed_size(20 * MIB);
    let parts = all_parts(3);
    complete_upload(&w.deps(), &alice(), &created.upload_id, &parts)
        .await
        .unwrap();

    complete_upload(&w.deps(), &alice(), &created.upload_id, &parts)
        .await
        .unwrap();

    assert_eq!(w.blobs.completed().len(), 1);
    assert_eq!(w.jobs.all().len(), 1);
}

#[tokio::test]
async fn complete_with_a_missing_part_is_upload_incomplete() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();

    let err = complete_upload(&w.deps(), &alice(), &created.upload_id, &all_parts(2))
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::UploadIncomplete);
    assert!(w.blobs.completed().is_empty());
    assert!(w.jobs.all().is_empty());
}

#[tokio::test]
async fn a_size_mismatch_after_completion_is_upload_incomplete() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();
    w.blobs.set_completed_size(20 * MIB - 1);

    let err = complete_upload(&w.deps(), &alice(), &created.upload_id, &all_parts(3))
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::UploadIncomplete);
    assert_eq!(
        w.catalogue.clip(&created.clip_id).unwrap().status,
        ClipStatus::Uploading
    );
    assert!(w.jobs.all().is_empty());
}

#[tokio::test]
async fn another_users_upload_is_forbidden_for_presign_and_complete() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();
    let mallory = UserId::parse("mallory").unwrap();

    let presign = presign_parts(&w.deps(), &mallory, &created.upload_id, &[1]).await;
    let complete = complete_upload(&w.deps(), &mallory, &created.upload_id, &all_parts(3)).await;

    assert_eq!(presign.unwrap_err().code, ErrorCode::Forbidden);
    assert_eq!(complete.unwrap_err().code, ErrorCode::Forbidden);
    assert!(w.blobs.completed().is_empty());
}

#[tokio::test]
async fn unknown_upload_is_not_found() {
    let w = World::new();
    let missing = UploadId::parse("nope").unwrap();
    let err = presign_parts(&w.deps(), &alice(), &missing, &[1])
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
}

#[tokio::test]
async fn resume_presigns_only_the_requested_parts_in_range() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();

    let parts = presign_parts(&w.deps(), &alice(), &created.upload_id, &[3, 2])
        .await
        .unwrap();
    let out_of_range = presign_parts(&w.deps(), &alice(), &created.upload_id, &[4]).await;
    let empty = presign_parts(&w.deps(), &alice(), &created.upload_id, &[]).await;

    let numbers: Vec<u32> = parts.iter().map(|p| p.n).collect();
    assert_eq!(numbers, [3, 2]);
    assert_eq!(out_of_range.unwrap_err().code, ErrorCode::ValidationFailed);
    assert_eq!(empty.unwrap_err().code, ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn create_rejects_a_non_video_before_touching_the_store() {
    let w = World::new();
    let req = NewUpload {
        filename: "notes.txt".into(),
        ..twenty_mib_mov()
    };

    let err: AppError = create_upload(&w.deps(), &alice(), req).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ValidationFailed);
    assert!(w.blobs.created().is_empty());
}

#[tokio::test]
async fn the_proxy_url_points_at_the_clips_proxy_until_the_upload_completes() {
    let w = World::new();
    let created = create_upload(&w.deps(), &alice(), twenty_mib_mov())
        .await
        .unwrap();
    let ttl = std::time::Duration::from_secs(3600);

    let url = presign_proxy(&w.deps(), &alice(), &created.upload_id, ttl)
        .await
        .unwrap();
    assert_eq!(
        url,
        format!(
            "https://put/users/alice/proxies/{}_720p.mp4?ttl=3600",
            created.clip_id
        )
    );

    let mallory = UserId::parse("mallory").unwrap();
    let err = presign_proxy(&w.deps(), &mallory, &created.upload_id, ttl)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Forbidden);

    w.blobs.set_completed_size(20 * MIB);
    complete_upload(&w.deps(), &alice(), &created.upload_id, &all_parts(3))
        .await
        .unwrap();
    let err = presign_proxy(&w.deps(), &alice(), &created.upload_id, ttl)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
}
