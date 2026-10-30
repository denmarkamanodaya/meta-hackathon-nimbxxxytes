//! The ask box use cases over fakes: the voice path (validate, WAV of the first minute,
//! transcribe, clean up) and the intent path (ownership, the context Spark is sent, the rules).

#![cfg(test)]

use std::sync::Arc;

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::document::{DocKind, DocStatus, Document, NewDocument};
use nimbytes_core::domain::ids::DocumentId;
use nimbytes_core::domain::ids::{ClipId, ProjectId, UserId};
use nimbytes_core::domain::intent::{IntentDraft, IntentKind};
use nimbytes_core::domain::project::{Project, ProjectColor};
use nimbytes_core::ports::DocumentStore;
use nimbytes_core::ports::ProjectStore;
use nimbytes_core::usecases::ask::{Ask, AskPorts, VoiceNote, read_intent, transcribe_voice};
use nimbytes_core::{AppError, ErrorCode};
use nimbytes_testkit::world::{clip, probe, said};
use nimbytes_testkit::{
    FakeMediaTool, FakeScratch, FakeTranscriber, InMemoryCatalogue, InMemoryDocuments,
    InMemoryPeople, InMemoryProjects, ScriptedIntentReader, SequentialIds,
};

/// A request with these clips and no documents.
fn ask<'a>(text: &'a str, clips: &'a [ClipId]) -> Ask<'a> {
    Ask {
        text,
        clips,
        documents: &[],
    }
}

struct Fakes {
    catalogue: Arc<InMemoryCatalogue>,
    projects: Arc<InMemoryProjects>,
    documents: Arc<InMemoryDocuments>,
    scratch: Arc<FakeScratch>,
    media: Arc<FakeMediaTool>,
    transcriber: Arc<FakeTranscriber>,
    intents: Arc<ScriptedIntentReader>,
    people: Arc<InMemoryPeople>,
}

impl Fakes {
    fn new() -> Self {
        Self {
            catalogue: Arc::default(),
            projects: Arc::default(),
            documents: Arc::default(),
            scratch: Arc::default(),
            media: Arc::new(FakeMediaTool::new(probe(5.0, true), Vec::new())),
            transcriber: Arc::default(),
            intents: Arc::default(),
            people: Arc::default(),
        }
    }

    fn ports(&self) -> AskPorts {
        AskPorts {
            catalogue: self.catalogue.clone(),
            projects: self.projects.clone(),
            documents: self.documents.clone(),
            people: self.people.clone(),
            scratch: self.scratch.clone(),
            media: self.media.clone(),
            transcriber: self.transcriber.clone(),
            intents: self.intents.clone(),
            ids: Arc::new(SequentialIds::new("v")),
        }
    }

    /// Clip `id` of `user`, 12.5 s long.
    fn put_clip(&self, (id, user): (&str, &str), status: ClipStatus, title: Option<&str>) {
        let mut c = clip(Some(probe(12.5, true))).unwrap();
        c.id = ClipId::parse(id).unwrap();
        c.user_id = UserId::parse(user).unwrap();
        c.status = status;
        c.title = title.map(str::to_owned);
        self.catalogue.put_clip(c);
    }

    /// Project `id` of `user` named `name`, holding `clips`.
    async fn put_project(&self, (id, user): (&str, &str), name: &str, clips: &[&str]) {
        let p = Project {
            id: ProjectId::parse(id).unwrap(),
            user_id: UserId::parse(user).unwrap(),
            name: name.into(),
            color: ProjectColor::Blue,
            created_at: format!("2026-10-29T00:00:0{}.000Z", id.len()),
            updated_at: "t".into(),
        };
        let clips: Vec<ClipId> = clips.iter().map(|c| ClipId::parse(*c).unwrap()).collect();
        self.projects.create(&p, &clips).await.unwrap();
    }
}

fn u1() -> UserId {
    UserId::parse("u1").unwrap()
}

fn ids(raw: &[&str]) -> Vec<ClipId> {
    raw.iter().map(|c| ClipId::parse(*c).unwrap()).collect()
}

fn webm(bytes: &[u8]) -> VoiceNote<'_> {
    VoiceNote {
        content_type: Some("audio/webm;codecs=opus"),
        bytes,
    }
}

#[tokio::test]
async fn a_recording_is_written_cut_to_its_first_minute_transcribed_and_cleaned_up() {
    let f = Fakes::new();
    f.transcriber.returns(vec![
        said(0, 900, " make a short "),
        said(900, 2000, "of the beach"),
    ]);

    let text = transcribe_voice(&f.ports(), webm(b"OggS-ish"))
        .await
        .unwrap();

    assert_eq!(text, "make a short of the beach");
    let written = f.scratch.written();
    assert_eq!(written.len(), 1);
    assert_eq!(written[0].0.to_str(), Some("/scratch/voice/v-1.webm"));
    assert_eq!(written[0].1, b"OggS-ish");
    assert_eq!(f.media.calls(), ["wav 0-60 v-1.webm -> v-1.wav"]);
    assert_eq!(f.transcriber.calls(), ["v-1.wav"]);
    assert_eq!(
        f.scratch.removed(),
        ["/scratch/voice/v-1.webm", "/scratch/voice/v-1.wav"]
    );
}

#[tokio::test]
async fn silence_is_an_empty_text() {
    let f = Fakes::new();
    let text = transcribe_voice(&f.ports(), webm(b"x")).await.unwrap();
    assert_eq!(text, "");
}

#[tokio::test]
async fn a_bad_recording_is_refused_before_anything_is_written() {
    let f = Fakes::new();
    let unknown = VoiceNote {
        content_type: Some("video/mp4"),
        bytes: b"x",
    };
    for note in [webm(b""), unknown] {
        let err = transcribe_voice(&f.ports(), note).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed);
    }
    assert!(f.scratch.written().is_empty() && f.media.calls().is_empty());
}

#[tokio::test]
async fn audio_ffmpeg_cannot_read_is_validation_failed_and_still_cleaned_up() {
    let f = Fakes::new();
    f.media
        .fail_wav(AppError::new(ErrorCode::MediaFailed, "ffmpeg exit 1"));

    let err = transcribe_voice(&f.ports(), webm(b"junk"))
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::ValidationFailed);
    assert!(f.transcriber.calls().is_empty());
    assert_eq!(f.scratch.removed().len(), 2, "both temp files go");
}

#[tokio::test]
async fn a_transcribe_failure_is_model_unavailable_and_still_cleaned_up() {
    let f = Fakes::new();
    f.transcriber
        .fails_with(AppError::new(ErrorCode::ModelUnavailable, "502"));

    let err = transcribe_voice(&f.ports(), webm(b"x")).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert_eq!(f.scratch.removed().len(), 2);
}

/// u1: clips c1 "Beach sunset" (ready), c2 (processing), c3 (duplicate), c4 (failed) and project
/// p1 "TJ Concert" holding c1 and c2; u2: clip x1 and project q1.
async fn library() -> Fakes {
    let f = Fakes::new();
    f.put_clip(("c1", "u1"), ClipStatus::Ready, Some("Beach sunset"));
    f.put_clip(("c2", "u1"), ClipStatus::Processing, None);
    f.put_clip(("c3", "u1"), ClipStatus::Duplicate, None);
    f.put_clip(("c4", "u1"), ClipStatus::Failed, None);
    f.put_clip(("x1", "u2"), ClipStatus::Ready, None);
    f.put_project(("p1", "u1"), "TJ Concert", &["c1", "c2"])
        .await;
    f.put_project(("q1", "u2"), "Not mine", &[]).await;
    f
}

#[tokio::test]
async fn spark_is_sent_the_text_the_callers_projects_the_added_clips_and_the_library_size() {
    let f = library().await;
    f.intents.answers(IntentDraft {
        kind: "make_short".into(),
        title: "Beach".into(),
        source: Some("attached".into()),
        ..IntentDraft::default()
    });

    let clips = ids(&["c1", "c2", "c1"]);
    let intent = read_intent(&f.ports(), &u1(), ask("  make a short of these  ", &clips))
        .await
        .unwrap();

    let seen = &f.intents.calls()[0];
    assert_eq!(seen.text, "make a short of these");
    let projects: Vec<(&str, &str, u32)> = seen
        .projects
        .iter()
        .map(|p| (p.id.as_str(), p.name.as_str(), p.clip_count))
        .collect();
    assert_eq!(projects, [("p1", "TJ Concert", 2)]);
    let clips: Vec<(&str, &str, Option<f64>)> = seen
        .clips
        .iter()
        .map(|c| (c.id.as_str(), c.title.as_str(), c.duration_s))
        .collect();
    assert_eq!(
        clips,
        [
            ("c1", "Beach sunset", Some(12.5)),
            ("c2", "IMG_0001.MOV", Some(12.5))
        ]
    );
    assert_eq!(
        seen.library_clips, 2,
        "failed clips and duplicates are left out"
    );
    assert_eq!(intent.kind, IntentKind::MakeShort);
    let used: Vec<&str> = intent.clip_ids.iter().map(ClipId::as_str).collect();
    assert_eq!(used, ["c1", "c2"]);
}

#[tokio::test]
async fn another_users_clip_is_forbidden_before_spark_is_called() {
    let f = Fakes::new();
    f.put_clip(("x1", "u2"), ClipStatus::Ready, None);
    f.intents.answers(IntentDraft::default());

    let err = read_intent(&f.ports(), &u1(), ask("make a guide", &ids(&["x1"])))
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::Forbidden);
    assert!(f.intents.calls().is_empty());
}

#[tokio::test]
async fn an_empty_request_or_too_many_clips_is_validation_failed() {
    let f = Fakes::new();
    let err = read_intent(&f.ports(), &u1(), ask("  ", &[]))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);

    let many: Vec<ClipId> = (0..21)
        .map(|n| ClipId::parse(format!("c{n}")).unwrap())
        .collect();
    let err = read_intent(&f.ports(), &u1(), ask("go", &many))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
    assert!(f.intents.calls().is_empty());
}

#[tokio::test]
async fn a_spark_failure_is_model_unavailable() {
    let f = Fakes::new();
    let err = read_intent(&f.ports(), &u1(), ask("sunsets", &[]))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelUnavailable);
}

impl Fakes {
    /// A read document `id` of `user`, created at `at`.
    async fn put_document(&self, (id, user): (&str, &str), title: &str, at: &str) {
        let req = NewDocument {
            filename: "letter.jpg".into(),
            content_type: "image/jpeg".into(),
            size_bytes: 10,
        };
        let ids = (DocumentId::parse(id).unwrap(), UserId::parse(user).unwrap());
        let format = nimbytes_core::domain::document::DocFormat::Jpeg;
        let mut d = Document::uploading(ids, req, format, at);
        d.status = DocStatus::Ready;
        d.title = title.into();
        d.kind = DocKind::Bill;
        d.sender = "City Power".into();
        self.documents.create(&d).await.unwrap();
    }
}

fn doc_ids(raw: &[&str]) -> Vec<DocumentId> {
    raw.iter().map(|d| DocumentId::parse(*d).unwrap()).collect()
}

#[tokio::test]
async fn spark_sees_the_callers_documents_newest_first_with_the_added_one_marked() {
    let f = Fakes::new();
    f.put_document(("d1", "u1"), "Water bill", "2026-10-01")
        .await;
    f.put_document(("d2", "u1"), "Electricity letter", "2026-10-02")
        .await;
    f.put_document(("x1", "u2"), "Not mine", "2026-10-03").await;
    f.intents.answers(IntentDraft {
        kind: "read_document".into(),
        document_ids: vec!["d2".into()],
        ..IntentDraft::default()
    });
    let added = doc_ids(&["d1"]);
    let request = Ask {
        text: "summarise this letter for me",
        clips: &[],
        documents: &added,
    };

    let intent = read_intent(&f.ports(), &u1(), request).await.unwrap();

    let seen: Vec<(String, String, bool)> = f.intents.calls()[0]
        .documents
        .iter()
        .map(|d| (d.id.to_string(), d.title.clone(), d.added))
        .collect();
    assert_eq!(
        seen,
        [
            ("d1".into(), "Water bill".into(), true),
            ("d2".into(), "Electricity letter".into(), false)
        ]
    );
    assert_eq!(intent.kind, IntentKind::ReadDocument);
    assert_eq!(intent.document_ids, doc_ids(&["d1"]), "the added one wins");
    assert_eq!(intent.question.as_deref(), Some("Tell me what this says"));
}

#[tokio::test]
async fn another_users_document_is_forbidden_before_spark_is_called() {
    let f = Fakes::new();
    f.put_document(("x1", "u2"), "Not mine", "2026-10-03").await;
    f.intents.answers(IntentDraft::default());
    let added = doc_ids(&["x1"]);
    let request = Ask {
        text: "read this",
        clips: &[],
        documents: &added,
    };

    let err = read_intent(&f.ports(), &u1(), request).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::Forbidden);
    assert!(f.intents.calls().is_empty());
}

/// u1 has Ann, a ready "Mom's 60th Birthday" and a processing "60th birthday prep"; u2 has Zoe
/// and their own 60th birthday.
async fn lane_fakes() -> Fakes {
    use nimbytes_core::domain::ids::PersonId;
    use nimbytes_core::ports::PeopleStore;
    let f = Fakes::new();
    let new_id = |raw: &str| PersonId::parse(raw).unwrap();
    f.people
        .upsert_person(&u1(), &new_id("p-ann"), "Ann")
        .await
        .unwrap();
    let u2 = UserId::parse("u2").unwrap();
    f.people
        .upsert_person(&u2, &new_id("p-zoe"), "Zoe")
        .await
        .unwrap();
    f.put_clip(("c1", "u1"), ClipStatus::Ready, Some("Mom's 60th Birthday"));
    f.put_clip(
        ("c2", "u1"),
        ClipStatus::Processing,
        Some("60th birthday prep"),
    );
    f.put_clip(("c3", "u2"), ClipStatus::Ready, Some("Their 60th birthday"));
    f
}

#[tokio::test]
async fn memory_lane_sees_only_the_callers_people_and_matches_a_ready_day_by_title() {
    let f = lane_fakes().await;
    f.intents.answers(IntentDraft {
        kind: "memory_lane".into(),
        title: "60th birthday".into(),
        query: Some("60th birthday".into()),
        viewer_name: Some("ann".into()),
        ..IntentDraft::default()
    });

    let intent = read_intent(
        &f.ports(),
        &u1(),
        ask("memory lane of the 60th birthday", &[]),
    )
    .await
    .unwrap();

    assert_eq!(intent.kind, IntentKind::MemoryLane);
    assert_eq!(intent.clip_id.as_ref().map(ClipId::as_str), Some("c1"));
    assert_eq!(
        intent
            .viewer_id
            .as_ref()
            .map(nimbytes_core::domain::ids::PersonId::as_str),
        Some("p-ann")
    );
    let sent = &f.intents.calls()[0];
    let names: Vec<&str> = sent.people.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["Ann"], "another user's people are never shown");
    let days: Vec<&str> = sent.library.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(days, ["c1"], "only the caller's ready clips can be a day");
}
