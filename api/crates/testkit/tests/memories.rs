//! The Memory Lane use cases over fakes: a person session found across the caller's clips only,
//! the frames taken inside the subject's track, what Spark is shown to write and check, the check
//! applied, the cover tolerated, done; and a failed write marking the session failed.

#![cfg(test)]

use std::sync::Arc;

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::facts::{FactsStatus, SegmentFacts};
use nimbytes_core::domain::ids::{ClipId, JobId, PersonId, SegmentId, TrackId, UserId};
use nimbytes_core::domain::index::{ClipDetailRows, LibraryRow, SegmentView, TrackView};
use nimbytes_core::domain::job::{Job, JobKind, MEMORY_STEPS};
use nimbytes_core::domain::memory::{LineCheck, MemoryStatus, WriteAnswer, WrittenLine};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::{PeopleStore, StepRunner};
use nimbytes_core::usecases::memories::{MemoryPorts, MemoryStart, create_memory};
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::world::{clip, probe};
use nimbytes_testkit::{
    FakeBlobStore, FakeCoverArtist, FakeMediaTool, FakeScratch, FixedClock, InMemoryCatalogue,
    InMemoryJobQueue, InMemoryMemories, InMemoryPeople, ScriptedMemoryWriter, SequentialIds,
};

struct Fakes {
    store: Arc<InMemoryMemories>,
    catalogue: Arc<InMemoryCatalogue>,
    people: Arc<InMemoryPeople>,
    blobs: Arc<FakeBlobStore>,
    scratch: Arc<FakeScratch>,
    media: Arc<FakeMediaTool>,
    writer: Arc<ScriptedMemoryWriter>,
    cover: Arc<FakeCoverArtist>,
    jobs: Arc<InMemoryJobQueue>,
}

impl Fakes {
    fn new() -> Self {
        Self {
            store: Arc::default(),
            catalogue: Arc::default(),
            people: Arc::default(),
            blobs: Arc::default(),
            scratch: Arc::default(),
            media: Arc::new(FakeMediaTool::new(probe(60.0, true), Vec::new())),
            writer: Arc::default(),
            cover: Arc::default(),
            jobs: Arc::default(),
        }
    }

    fn ports(&self) -> MemoryPorts {
        MemoryPorts {
            store: self.store.clone(),
            catalogue: self.catalogue.clone(),
            people: self.people.clone(),
            blobs: self.blobs.clone(),
            scratch: self.scratch.clone(),
            media: self.media.clone(),
            writer: self.writer.clone(),
            cover_artist: self.cover.clone(),
            jobs: self.jobs.clone(),
            clock: Arc::new(FixedClock::at(1_793_062_923_456)),
            ids: Arc::new(SequentialIds::new("m")),
            url_ttl: std::time::Duration::from_secs(3600),
        }
    }

    async fn person(&self, user: &str, id: &str, name: &str) {
        let user = UserId::parse(user).unwrap();
        let id = PersonId::parse(id).unwrap();
        self.people.upsert_person(&user, &id, name).await.unwrap();
    }

    /// Clip `id` of `user`: Ann at 0–8 s and 30–33 s, Eric at 5–11 s; described segments of 10 s.
    fn day(&self, id: &str, user: &str) {
        let mut c = clip(Some(probe(40.0, true))).unwrap();
        c.id = ClipId::parse(id).unwrap();
        c.user_id = UserId::parse(user).unwrap();
        c.status = ClipStatus::Ready;
        c.title = Some(format!("Day {id}"));
        let seg = |n: u32, start_s: f64| described(&c.id, n, start_s);
        let track = |n: u32, span: (f64, f64), name: &str| named(&c, n, span, name);
        self.catalogue.put_detail(ClipDetailRows {
            row: LibraryRow {
                clip: c.clone(),
                segment_count: 4,
                first_segment: None,
                people: vec!["Ann".into(), "Eric".into()],
                project_ids: Vec::new(),
                speech_count: 0,
                face_count: 3,
            },
            segments: vec![seg(0, 0.0), seg(1, 10.0), seg(2, 20.0), seg(3, 30.0)],
            turns: Vec::new(),
            speakers: Vec::new(),
            tracks: vec![
                track(0, (0.0, 8.0), "Ann"),
                track(1, (5.0, 11.0), "Eric"),
                track(2, (30.0, 33.0), "Ann"),
            ],
        });
    }
}

/// Segment `n` of `clip`, 10 s from `start_s`, described.
fn described(clip: &ClipId, n: u32, start_s: f64) -> SegmentView {
    SegmentView {
        segment: Segment {
            id: SegmentId::parse(format!("{clip}-s{n}")).unwrap(),
            clip_id: clip.clone(),
            idx: n,
            span: Span {
                start_s,
                end_s: start_s + 10.0,
            },
        },
        facts: Some(SegmentFacts {
            description: format!("Moment {n} of {clip}."),
            actions: Vec::new(),
            objects: Vec::new(),
            place: None,
            mood: None,
            quality: None,
            hook_score: None,
            status: FactsStatus::Ok,
        }),
    }
}

/// Face track `n` of `clip`, named `name`, with its crop.
fn named(
    clip: &nimbytes_core::domain::clip::Clip,
    n: u32,
    (first_s, last_s): (f64, f64),
    name: &str,
) -> TrackView {
    let (user, id) = (&clip.user_id, &clip.id);
    TrackView {
        id: TrackId::parse(format!("{id}-f{n}")).unwrap(),
        first_s,
        last_s,
        crop_key: Some(format!("users/{user}/faces/{id}/{id}-f{n}.jpg")),
        person_name: Some(name.into()),
        hidden: false,
    }
}

fn u1() -> UserId {
    UserId::parse("u1").unwrap()
}

fn job(id: &str) -> Job {
    Job {
        id: JobId::parse("j1").unwrap(),
        kind: JobKind::Memory,
        subject_id: id.into(),
        step: None,
        attempts: 1,
    }
}

async fn run_all(p: &MemoryPorts, id: &str) {
    for step in MEMORY_STEPS {
        p.run(&job(id), step).await.unwrap();
    }
}

fn line(index: u32, text: &str) -> WrittenLine {
    WrittenLine {
        index,
        line: text.into(),
        prompt: format!("Question {index}?"),
    }
}

/// u1 has Ann and Eric and the day c1; u2 has the day x1. Spark writes two lines for Ann's
/// session for Eric and the check rewrites the second; then every step runs. Returns the id.
async fn person_session(f: &Fakes) -> String {
    f.person("u1", "p-ann", "Ann").await;
    f.person("u1", "p-eric", "Eric").await;
    f.day("c1", "u1");
    f.day("x1", "u2");
    f.writer.writes(WriteAnswer {
        title: "Ann's day".into(),
        moments: vec![
            line(0, "Ann and Eric at the table."),
            line(1, "You laugh, Ann."),
        ],
    });
    let verdict = |index, supported, claims: &[&str], text: &str| LineCheck {
        index,
        supported,
        unsupported_claims: claims.iter().map(|c| (*c).to_owned()).collect(),
        line: text.into(),
    };
    f.writer.checks(vec![
        verdict(0, true, &[], "Ann and Eric at the table."),
        verdict(1, false, &["you are Ann"], "Ann laughs."),
    ]);
    let p = f.ports();
    let start = MemoryStart {
        person_id: Some("p-ann".into()),
        clip_id: None,
        viewer_id: Some("p-eric".into()),
    };
    let made = create_memory(&p, &u1(), start).await.unwrap();
    run_all(&p, made.id.as_str()).await;
    made.id.into()
}

#[tokio::test]
async fn a_person_session_is_found_written_checked_and_finished() {
    let f = Fakes::new();
    let id = person_session(&f).await;

    let m = f.store.memory(&id).unwrap();
    assert_eq!((m.status, m.step.as_deref()), (MemoryStatus::Ready, None));
    assert_eq!((m.title.as_str(), m.fixed_count), ("Ann's day", 1));
    let got: Vec<(&str, f64, &str)> = m
        .moments
        .iter()
        .map(|x| (x.clip_id.as_str(), x.start_s, x.line.as_str()))
        .collect();
    assert_eq!(
        got,
        [
            ("c1", 0.0, "Ann and Eric at the table."),
            ("c1", 30.0, "Ann laughs.")
        ],
        "only the caller's clip; 0 s (Ann + Eric) ranks first, 30 s is 25 s away"
    );
    assert_eq!(
        m.moments[1].fixed_note.as_deref(),
        Some("Removed: you are Ann")
    );
    let ann = &m.moments[0].people[0];
    assert_eq!(ann.person_id.as_ref().map(PersonId::as_str), Some("p-ann"));
    assert_eq!(
        m.cover_key,
        Some(format!("users/u1/memories/{id}/cover.jpg"))
    );
    assert!(f.scratch.removed().contains(&format!("memories/{id}")));
}

#[tokio::test]
async fn spark_sees_the_viewer_the_faces_and_a_frame_inside_each_subject_track() {
    let f = Fakes::new();
    let id = person_session(&f).await;

    let calls = f.media.calls();
    assert!(
        calls.contains(&"frame@4.5 sam_proxy.mp4 -> raw_0.jpg".to_owned()),
        "{calls:?}"
    );
    assert!(
        calls.contains(&"frame@32 sam_proxy.mp4 -> raw_1.jpg".to_owned()),
        "{calls:?}"
    );
    let seen = f.writer.seen();
    assert_eq!(seen.len(), 2);
    assert_eq!(
        (seen[0].call, seen[0].viewer.as_deref()),
        ("write", Some("Eric"))
    );
    assert_eq!(
        (seen[0].faces.clone(), seen[0].frames),
        (vec!["Ann".to_owned(), "Eric".to_owned()], 2)
    );
    assert_eq!(seen[1].call, "check");
    assert_eq!(
        seen[1].lines,
        ["Ann and Eric at the table.", "You laugh, Ann."]
    );
    let puts: Vec<String> = f.blobs.puts().into_iter().map(|(k, _)| k).collect();
    assert!(
        puts.contains(&format!("users/u1/memories/{id}/frame_0.jpg")),
        "{puts:?}"
    );
}

#[tokio::test]
async fn a_failed_cover_still_finishes_and_a_failed_write_marks_the_session_failed() {
    let f = Fakes::new();
    f.person("u1", "p-ann", "Ann").await;
    f.day("c1", "u1");
    f.cover.fail();
    let p = f.ports();
    let start = MemoryStart {
        person_id: None,
        clip_id: Some("c1".into()),
        viewer_id: None,
    };
    let made = create_memory(&p, &u1(), start).await.unwrap();
    let id = made.id.as_str();
    p.run(&job(id), "find").await.unwrap();
    assert_eq!(
        f.store.memory(id).unwrap().moments.len(),
        2,
        "segments 0, 1 and 3 have a face; 1 is within 25 s of 0"
    );

    let err = p.run(&job(id), "write").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    p.failed(&job(id), &err).await.unwrap();
    let m = f.store.memory(id).unwrap();
    assert_eq!(m.status, MemoryStatus::Failed);
    assert_eq!(m.error.as_deref(), Some("no write scripted"));

    f.writer.writes(WriteAnswer {
        title: "A day".into(),
        moments: (0..2).map(|i| line(i, "Ann is there.")).collect(),
    });
    f.writer.checks(Vec::new());
    for step in ["write", "check", "cover", "ready"] {
        p.run(&job(id), step).await.unwrap();
    }
    let m = f.store.memory(id).unwrap();
    assert_eq!(m.status, MemoryStatus::Ready);
    assert_eq!(m.cover_key, None, "the cover failed and was skipped");
    assert!(m.moments.iter().all(|x| x.checked));
}

#[tokio::test]
async fn a_person_never_seen_fails_find_with_a_message() {
    let f = Fakes::new();
    f.person("u1", "p-bo", "Bo").await;
    f.day("c1", "u1");
    let p = f.ports();
    let start = MemoryStart {
        person_id: Some("p-bo".into()),
        clip_id: None,
        viewer_id: None,
    };
    let made = create_memory(&p, &u1(), start).await.unwrap();
    let err: AppError = p.run(&job(made.id.as_str()), "find").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::MediaFailed);
    assert!(err.message.contains("Bo"), "{}", err.message);
}
