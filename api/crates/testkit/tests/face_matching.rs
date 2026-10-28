//! Opt-in face matching over fakes: the switch, the embed and match steps, and the ready step's
//! follow-up job.

#![cfg(test)]

use std::path::PathBuf;
use std::sync::Arc;

use nimbytes_core::domain::face_match::MAX_PAIRS_PER_RUN;
use nimbytes_core::domain::ids::{ClipId, JobId, TrackId, UserId};
use nimbytes_core::domain::job::{Job, JobKind};
use nimbytes_core::ports::{FaceMatchStore, FacePair, FaceToEmbed, JobQueue, StepRunner};
use nimbytes_core::usecases::face_matching::{FaceSteps, SettingsDeps, set_face_matching};
use nimbytes_testkit::world::{IngestWorld, clip, probe};
use nimbytes_testkit::{
    FakeBlobStore, FakeEmbedder, FakeScratch, FixedClock, InMemoryFaceStore, InMemoryJobQueue,
    ScriptedFaceMatcher, SequentialIds,
};

fn u1() -> UserId {
    UserId::parse("u1").unwrap()
}

fn t(id: &str) -> TrackId {
    TrackId::parse(id).unwrap()
}

fn crop(track: &str) -> String {
    format!("users/u1/faces/c1/{track}.jpg")
}

#[tokio::test]
async fn turning_matching_on_queues_the_job_and_off_deletes_vectors_and_verdicts() {
    let (faces, jobs) = (InMemoryFaceStore::default(), InMemoryJobQueue::default());
    let (ids, clock) = (SequentialIds::new("job"), FixedClock::at(0));
    let deps = SettingsDeps {
        faces: &faces,
        jobs: &jobs,
        ids: &ids,
        clock: &clock,
    };

    assert!(set_face_matching(&deps, &u1(), true).await.unwrap());
    faces.put_vector(&t("c1-f0"), &u1(), &[1.0]).await.unwrap();
    let queued: Vec<(JobKind, String)> = jobs
        .all()
        .into_iter()
        .map(|j| (j.job.kind, j.job.subject_id))
        .collect();
    assert!(!set_face_matching(&deps, &u1(), false).await.unwrap());

    assert_eq!(queued, [(JobKind::FaceVectors, "u1".to_owned())]);
    assert!(faces.vectors().is_empty(), "off deletes the vectors");
    assert!(!faces.matching(&u1()).await.unwrap());
    assert_eq!(jobs.all().len(), 1, "turning off queues nothing");
}

#[tokio::test]
async fn saving_matching_unchanged_queues_nothing_again() {
    let (faces, jobs) = (InMemoryFaceStore::default(), InMemoryJobQueue::default());
    let (ids, clock) = (SequentialIds::new("job"), FixedClock::at(0));
    let deps = SettingsDeps {
        faces: &faces,
        jobs: &jobs,
        ids: &ids,
        clock: &clock,
    };

    assert!(set_face_matching(&deps, &u1(), true).await.unwrap());
    let job = jobs.all()[0].job.id.clone();
    jobs.done(&job, 0).await.unwrap();
    // Saving the other setting re-sends matching unchanged: the finished job stays finished.
    assert!(set_face_matching(&deps, &u1(), true).await.unwrap());

    assert_eq!(jobs.all().len(), 1);
    assert_eq!(jobs.all()[0].status, "done", "an unchanged switch does not restart the job");
}

struct Steps {
    faces: Arc<InMemoryFaceStore>,
    blobs: Arc<FakeBlobStore>,
    scratch: Arc<FakeScratch>,
    matcher: Arc<ScriptedFaceMatcher>,
}

impl Steps {
    fn new() -> Self {
        let scratch = Arc::new(FakeScratch::default());
        Self {
            faces: Arc::new(InMemoryFaceStore::default()),
            blobs: Arc::new(FakeBlobStore::writing_to(scratch.clone())),
            scratch,
            matcher: Arc::new(ScriptedFaceMatcher::default()),
        }
    }

    async fn run(&self, step: &str) {
        let runner = FaceSteps {
            faces: self.faces.clone(),
            blobs: self.blobs.clone(),
            scratch: self.scratch.clone(),
            embedder: Arc::new(FakeEmbedder),
            matcher: self.matcher.clone(),
        };
        let job = Job {
            id: JobId::parse("j1").unwrap(),
            kind: JobKind::FaceVectors,
            subject_id: "u1".into(),
            step: None,
            attempts: 1,
        };
        runner.run(&job, step).await.unwrap();
    }
}

fn to_embed(track: &str) -> FaceToEmbed {
    FaceToEmbed {
        track: t(track),
        clip: ClipId::parse("c1").unwrap(),
        crop_key: crop(track),
    }
}

fn pair(a: &str, b: &str) -> FacePair {
    FacePair {
        a: (t(a), crop(a)),
        b: (t(b), crop(b)),
        similarity: 0.8,
    }
}

#[tokio::test]
async fn embed_downloads_each_new_crop_once_and_stores_its_vector() {
    let s = Steps::new();
    s.faces.turn_on(&u1());
    s.faces
        .set_unembedded(vec![to_embed("c1-f0"), to_embed("c1-f1")]);

    s.run("embed").await;
    s.run("embed").await;

    assert_eq!(
        s.blobs.gets(),
        [crop("c1-f0"), crop("c1-f1")],
        "the second run finds nothing new"
    );
    let stored: Vec<String> = s
        .faces
        .vectors()
        .iter()
        .map(|(t, ..)| t.to_string())
        .collect();
    assert_eq!(stored, ["c1-f0", "c1-f1"]);
    // The fake embedder encodes the path length: "/scratch/users/u1/c1-f0.jpg" is 27 characters.
    assert_eq!(
        s.faces.vectors()[0].2,
        vec![1.0, 27.0, 0.0, 0.0],
        "embedded from the local crop"
    );
}

#[tokio::test]
async fn match_shows_spark_both_crops_stores_its_verdicts_and_frees_the_directory() {
    let s = Steps::new();
    s.faces.turn_on(&u1());
    s.faces.set_proposals(vec![pair("c1-f0", "c2-f0")]);

    s.run("match").await;

    let dir = PathBuf::from("/scratch/users/u1");
    assert_eq!(
        s.matcher.calls(),
        [(dir.join("c1-f0.jpg"), dir.join("c2-f0.jpg"))]
    );
    let v = s.faces.verdicts();
    assert_eq!(
        (v[0].1.as_str(), v[0].2.as_str(), v[0].3.same),
        ("c1-f0", "c2-f0", true)
    );
    assert_eq!(s.scratch.removed(), ["users/u1"]);
}

#[tokio::test]
async fn one_run_checks_at_most_the_pair_cap() {
    let s = Steps::new();
    s.faces.turn_on(&u1());
    let many = (0..=MAX_PAIRS_PER_RUN)
        .map(|i| pair("c1-f0", &format!("c2-f{i}")))
        .collect();
    s.faces.set_proposals(many);

    s.run("match").await;

    assert_eq!(s.matcher.calls().len(), MAX_PAIRS_PER_RUN);
}

#[tokio::test]
async fn with_the_switch_off_neither_step_downloads_embeds_or_asks_spark() {
    let s = Steps::new();
    s.faces.set_unembedded(vec![to_embed("c1-f0")]);
    s.faces.set_proposals(vec![pair("c1-f0", "c2-f0")]);

    s.run("embed").await;
    s.run("match").await;

    assert!(s.blobs.gets().is_empty() && s.faces.vectors().is_empty());
    assert!(s.matcher.calls().is_empty() && s.faces.verdicts().is_empty());
}

#[tokio::test]
async fn the_ready_step_queues_face_matching_only_for_owners_who_turned_it_on() {
    let off = IngestWorld::new(probe(21.5, false), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();
    off.run_once().await.unwrap();
    let on = IngestWorld::new(probe(21.5, false), vec![8.0], clip(None).unwrap())
        .await
        .unwrap();
    on.faces.turn_on(&u1());
    on.run_once().await.unwrap();

    assert!(off.face_jobs.all().is_empty());
    let jobs: Vec<(JobKind, String)> = on
        .face_jobs
        .all()
        .into_iter()
        .map(|j| (j.job.kind, j.job.subject_id))
        .collect();
    assert_eq!(jobs, [(JobKind::FaceVectors, "u1".to_owned())]);
}
