//! iRead use cases over fakes: create and complete (ownership, idempotent), the read job's steps
//! for a photo and a PDF (the 10-page cap), a failed read, asking (not while reading, the answer
//! spoken sentence by sentence and joined, cached), the parts, rename and delete.
#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::document::{DocKind, DocStatus, MAX_PAGES};
use nimbytes_core::domain::ids::{DocumentId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::speech::{CLAUSE_PAUSE_MS, SENTENCE_PAUSE_MS};
use nimbytes_core::domain::wav::{HEADER_BYTES, read_wav};
use nimbytes_core::usecases::documents::{
    Spoken, ask_document, complete_document, create_document, delete_document, get_document,
    list_documents, rename_document, speak_part,
};
use nimbytes_testkit::documents_world::{DocumentWorld, upload, water_bill};

fn user(id: &str) -> UserId {
    UserId::parse(id).unwrap()
}

/// A photo uploaded and read to the end.
async fn read_photo() -> (DocumentWorld, DocumentId) {
    let w = DocumentWorld::new();
    w.reader.reads(water_bill());
    let id = w.uploaded("image/jpeg").await.unwrap();
    w.run_once().await.unwrap();
    (w, id)
}

#[tokio::test]
async fn creating_presigns_one_put_of_the_source_and_stores_an_uploading_document() {
    let w = DocumentWorld::new();

    let made = create_document(&w.ports, &user("u1"), upload("application/pdf"))
        .await
        .unwrap();

    assert_eq!(made.document_id.as_str(), "d-1");
    assert_eq!(
        made.upload_url,
        "https://put/users/u1/documents/d-1/source.pdf?ttl=900"
    );
    let doc = w.docs.doc("d-1").unwrap();
    assert_eq!(
        (doc.status, doc.kind, doc.title.as_str()),
        (DocStatus::Uploading, DocKind::Other, "")
    );
    let bad = create_document(&w.ports, &user("u1"), upload("image/gif")).await;
    assert_eq!(bad.unwrap_err().code, ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn completing_needs_the_file_queues_one_read_and_is_idempotent() {
    let w = DocumentWorld::new();
    let made = create_document(&w.ports, &user("u1"), upload("image/jpeg"))
        .await
        .unwrap();
    let id = made.document_id;

    let early = complete_document(&w.ports, &user("u1"), &id).await;
    assert_eq!(early.unwrap_err().code, ErrorCode::ValidationFailed);
    w.blobs.store("users/u1/documents/d-1/source.jpg", 10);
    let first = complete_document(&w.ports, &user("u1"), &id).await.unwrap();
    let again = complete_document(&w.ports, &user("u1"), &id).await.unwrap();

    assert_eq!((first, again), (DocStatus::Reading, DocStatus::Reading));
    let jobs = w.jobs.all();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        (jobs[0].job.kind, jobs[0].job.subject_id.as_str()),
        (JobKind::Read, "d-1")
    );
    let foreign = complete_document(&w.ports, &user("u2"), &id).await;
    assert_eq!(foreign.unwrap_err().code, ErrorCode::Forbidden);
}

#[tokio::test]
async fn a_photo_becomes_one_page_spark_reads_and_the_summary_is_spoken() {
    let (w, id) = read_photo().await;

    let doc = w.docs.doc(id.as_str()).unwrap();
    assert_eq!(doc.status, DocStatus::Ready);
    assert_eq!(
        (doc.title.as_str(), doc.kind, doc.page_count),
        ("Water bill", DocKind::Bill, 1)
    );
    assert!(
        w.media
            .calls()
            .contains(&"page_jpeg source.jpg -> page_1.jpg".to_owned())
    );
    assert_eq!(
        w.reader.reads_seen(),
        [vec!["/scratch/documents/d-1/page_1.jpg".to_owned()]]
    );
    assert_eq!(
        w.narrator.spoken(),
        [
            "city water asks for one hundred and forty-two dollars and sixty cents",
            "pay by the fourteenth of november",
            "two thousand and twenty-six"
        ],
        "one pass per clause, in words"
    );
    let audio = doc.summary_audio_key.unwrap();
    assert!(audio.as_str().starts_with("users/u1/documents/d-1/voice_"));
    assert_eq!(w.docs.voices_of("d-1"), [audio.as_str()]);
    assert!(w.scratch.removed().contains(&"documents/d-1".to_owned()));
}

#[tokio::test]
async fn a_pdf_is_read_up_to_its_first_ten_pages_in_order() {
    let w = DocumentWorld::new();
    w.reader.reads(water_bill());
    w.media.set_pdf_pages(12);
    let id = w.uploaded("application/pdf").await.unwrap();

    w.run_once().await.unwrap();

    assert!(
        w.media
            .calls()
            .contains(&"pdf_pages max=10 source.pdf -> d-1".to_owned())
    );
    let seen = &w.reader.reads_seen()[0];
    assert_eq!(seen.len(), MAX_PAGES, "never more than 10 pages to Spark");
    assert_eq!(seen[0], "/scratch/documents/d-1/page_1.jpg");
    assert_eq!(seen[9], "/scratch/documents/d-1/page_10.jpg");
    assert_eq!(w.docs.doc(id.as_str()).unwrap().page_count, 10);
    let puts = w.blobs.puts();
    assert!(puts.contains(&(
        "users/u1/documents/d-1/page_10.jpg".into(),
        "image/jpeg".into()
    )));
    assert!(!puts.iter().any(|(k, _)| k.ends_with("page_11.jpg")));
}

#[tokio::test]
async fn a_read_that_keeps_failing_marks_the_document_failed_with_its_error() {
    let w = DocumentWorld::new();
    let id = w.uploaded("image/png").await.unwrap();

    for _ in 0..3 {
        w.run_once().await.unwrap();
        w.clock.advance(60_000);
    }

    let doc = w.docs.doc(id.as_str()).unwrap();
    assert_eq!(doc.status, DocStatus::Failed);
    assert_eq!(doc.error.as_deref(), Some("nothing scripted"));
    let again = complete_document(&w.ports, &user("u1"), &id).await.unwrap();
    assert_eq!(
        again,
        DocStatus::Reading,
        "a failed document can be read again"
    );
    assert_eq!(w.docs.doc(id.as_str()).unwrap().error, None);
}

#[tokio::test]
async fn asking_while_the_document_is_read_is_refused_without_a_model_call() {
    let w = DocumentWorld::new();
    w.reader.answers("You owe $142.60.");
    let id = w.uploaded("image/jpeg").await.unwrap();

    let err = ask_document(&w.ports, &user("u1"), &id, "How much?")
        .await
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::ValidationFailed);
    assert_eq!(err.message, "the document is still being read");
    assert!(w.reader.questions().is_empty());
}

/// The samples of the fake narrator's clauses joined: each clause's bytes (padded to whole
/// samples) after its pause of 16 kHz silence.
fn joined_fake_pcm(clauses: &[&str], pauses_ms: &[u32]) -> Vec<u8> {
    let mut pcm = Vec::new();
    for (clause, ms) in clauses.iter().zip(pauses_ms) {
        pcm.resize(pcm.len() + 16 * *ms as usize * 2, 0);
        pcm.extend_from_slice(clause.as_bytes());
        pcm.resize(pcm.len().div_ceil(2) * 2, 0);
    }
    pcm
}

#[tokio::test]
async fn an_answer_is_spoken_per_clause_in_words_joined_into_one_wav_and_cached() {
    let (w, id) = read_photo().await;
    w.reader
        .answers("You owe $142.60. Pay by 14 November 2026.");
    let before = w.narrator.spoken().len();

    let a = ask_document(&w.ports, &user("u1"), &id, "  How much?  ")
        .await
        .unwrap();

    assert_eq!(a.question, "How much?");
    assert_eq!(
        w.reader.questions()[0],
        (water_bill().text, "How much?".to_owned())
    );
    let Spoken::Url(url) = &a.voice else {
        panic!("no voice: {:?}", a.voice);
    };
    assert!(url.starts_with("https://signed/users/u1/documents/d-1/voice_"));
    let clauses = [
        "you owe one hundred and forty-two dollars and sixty cents",
        "pay by the fourteenth of november",
        "two thousand and twenty-six",
    ];
    assert_eq!(&w.narrator.spoken()[before..], clauses);
    let (_, wav) = w.scratch.written().last().cloned().unwrap();
    let pauses = [0, SENTENCE_PAUSE_MS, CLAUSE_PAUSE_MS];
    assert_eq!(
        read_wav(&wav).unwrap().data,
        joined_fake_pcm(&clauses, &pauses),
        "three clauses, a sentence pause then a clause pause"
    );
    assert_eq!(wav.len(), HEADER_BYTES + read_wav(&wav).unwrap().data.len());

    let again = ask_document(&w.ports, &user("u1"), &id, "How much?")
        .await
        .unwrap();
    assert_eq!(again.voice, a.voice);
    assert_eq!(
        w.narrator.spoken().len(),
        before + 3,
        "the same answer is not spoken twice"
    );
}

#[tokio::test]
async fn without_a_narrator_the_answer_comes_back_with_no_voice() {
    let (mut w, id) = read_photo().await;
    w.ports.narrator = None;
    w.reader.answers("You owe $142.60.");

    let a = ask_document(&w.ports, &user("u1"), &id, "How much?")
        .await
        .unwrap();

    assert_eq!(a.answer, "You owe $142.60.");
    assert_eq!(a.voice, Spoken::Skipped("the narrator is off".into()));
}

#[tokio::test]
async fn the_text_is_read_aloud_part_by_part_and_a_part_past_the_end_is_refused() {
    let (w, id) = read_photo().await;

    let first = speak_part(&w.ports, &user("u1"), &id, 0).await.unwrap();

    assert_eq!((first.part, first.parts), (0, 1));
    assert_eq!(first.text, "Amount due: $142.60 Due date: 14 November 2026");
    assert!(first.voice.url().is_some());
    let past = speak_part(&w.ports, &user("u1"), &id, 1).await.unwrap_err();
    assert_eq!(past.code, ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn another_users_document_is_forbidden_everywhere_and_a_missing_one_not_found() {
    let (w, id) = read_photo().await;
    let u2 = user("u2");
    w.reader.answers("x");

    let codes = [
        get_document(&w.ports, &u2, &id).await.unwrap_err().code,
        ask_document(&w.ports, &u2, &id, "q")
            .await
            .unwrap_err()
            .code,
        speak_part(&w.ports, &u2, &id, 0).await.unwrap_err().code,
        rename_document(&w.ports, &u2, &id, "t")
            .await
            .unwrap_err()
            .code,
        delete_document(&w.ports, &u2, &id).await.unwrap_err().code,
    ];

    assert!(
        codes.iter().all(|c| *c == ErrorCode::Forbidden),
        "{codes:?}"
    );
    assert!(w.reader.questions().is_empty());
    assert!(list_documents(&w.ports, &u2).await.unwrap().is_empty());
    let missing = DocumentId::parse("nope").unwrap();
    let err = get_document(&w.ports, &user("u1"), &missing)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
}

#[tokio::test]
async fn the_detail_has_signed_pages_and_summary_and_a_rename_is_tidied() {
    let (w, id) = read_photo().await;

    let renamed = rename_document(&w.ports, &user("u1"), &id, "  My   bill ")
        .await
        .unwrap();

    assert_eq!(renamed.view.doc.title, "My bill");
    assert_eq!(
        renamed.pages,
        [(
            1,
            "https://signed/users/u1/documents/d-1/page_1.jpg?ttl=3600".to_owned()
        )]
    );
    assert_eq!(renamed.view.thumb_url, Some(renamed.pages[0].1.clone()));
    assert!(renamed.summary_audio_url.is_some());
    let empty = rename_document(&w.ports, &user("u1"), &id, " ")
        .await
        .unwrap_err();
    assert_eq!(empty.code, ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn deleting_removes_every_object_the_rows_the_job_and_the_working_files() {
    let (w, id) = read_photo().await;
    let voice = w.docs.voices_of("d-1")[0].clone();

    delete_document(&w.ports, &user("u1"), &id).await.unwrap();

    let deleted = w.blobs.deleted();
    assert!(deleted.contains(&"users/u1/documents/d-1/source.jpg".to_owned()));
    assert!(deleted.contains(&"users/u1/documents/d-1/page_10.jpg".to_owned()));
    assert!(deleted.contains(&voice));
    assert_eq!(w.docs.doc("d-1"), None);
    assert!(w.jobs.all().is_empty());
    assert!(w.scratch.removed().contains(&"documents/d-1".to_owned()));
}

#[tokio::test]
async fn opening_a_letter_whose_summary_was_spoken_in_an_old_voice_points_it_at_the_current_one() {
    let (w, id) = read_photo().await;
    let current = w.docs.doc(id.as_str()).unwrap().summary_audio_key.unwrap();
    let old =
        nimbytes_core::keys::ObjectKey::from_stored("users/u1/documents/d-1/voice_old".to_owned());
    w.ports.store.set_summary_audio(&id, &old).await.unwrap();

    let detail = get_document(&w.ports, &user("u1"), &id).await.unwrap();

    let url = detail.summary_audio_url.unwrap();
    assert!(url.contains(current.as_str()), "{url}");
    assert_eq!(
        w.docs.doc(id.as_str()).unwrap().summary_audio_key,
        Some(current),
        "the store now holds the current voice"
    );
}
