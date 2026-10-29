//! Document rows on SQLite: read back whole, newest first per user, pages replaced, the reading
//! and voices stored, and delete taking the pages and voices with it.

use super::*;
use crate::sqlite::catalogue::views_tests::fixture;

fn doc(id: &str, user: &UserId, at: &str) -> Document {
    Document {
        id: DocumentId::parse(id).unwrap(),
        user_id: user.clone(),
        filename: "letter.jpg".into(),
        format: DocFormat::Jpeg,
        size_bytes: 1234,
        status: DocStatus::Uploading,
        title: String::new(),
        kind: DocKind::Other,
        sender: String::new(),
        date: String::new(),
        text: String::new(),
        summary: String::new(),
        page_count: 0,
        summary_audio_key: None,
        error: None,
        created_at: at.into(),
        updated_at: at.into(),
    }
}

fn page(n: u32) -> DocumentPage {
    DocumentPage {
        n,
        image_key: ObjectKey::from_stored(format!("users/u1/documents/d1/page_{n}.jpg")),
    }
}

#[tokio::test]
async fn a_document_reads_back_whole_and_lists_newest_first_per_user() {
    let (_cat, pool, user, _) = fixture().await;
    let store = SqliteDocumentStore::new(pool);
    let older = doc("d1", &user, "2026-10-29T01:00:00.000Z");
    let newer = doc("d2", &user, "2026-10-29T02:00:00.000Z");
    store.create(&older).await.unwrap();
    store.create(&newer).await.unwrap();

    assert_eq!(store.get(&older.id).await.unwrap(), Some(older.clone()));
    assert_eq!(store.list(&user).await.unwrap(), [newer, older]);
    let nobody = UserId::parse("nobody").unwrap();
    assert!(store.list(&nobody).await.unwrap().is_empty());
    let missing = DocumentId::parse("nope").unwrap();
    assert_eq!(store.get(&missing).await.unwrap(), None);
}

fn reading() -> Reading {
    Reading {
        title: "Water bill".into(),
        kind: DocKind::Bill,
        sender: "City Water".into(),
        date: "1 October 2026".into(),
        text: "Amount due: $142.60".into(),
        summary: "Pay $142.60.".into(),
    }
}

#[tokio::test]
async fn progress_and_error_are_set_and_cleared() {
    let (_cat, pool, user, _) = fixture().await;
    let store = SqliteDocumentStore::new(pool);
    let d = doc("d1", &user, "t0");
    store.create(&d).await.unwrap();
    let failed = DocProgress {
        status: DocStatus::Failed,
        error: Some("pdftoppm failed"),
        at: "t1",
    };

    store.set_progress(&d.id, failed).await.unwrap();
    let got = store.get(&d.id).await.unwrap().unwrap();
    assert_eq!(
        (got.status, got.error.as_deref(), got.updated_at.as_str()),
        (DocStatus::Failed, Some("pdftoppm failed"), "t1")
    );

    let ready = DocProgress {
        status: DocStatus::Ready,
        error: None,
        at: "t3",
    };
    store.set_progress(&d.id, ready).await.unwrap();
    assert_eq!(store.get(&d.id).await.unwrap().unwrap().error, None);
}

#[tokio::test]
async fn pages_reading_title_and_summary_audio_are_stored() {
    let (_cat, pool, user, _) = fixture().await;
    let store = SqliteDocumentStore::new(pool);
    let d = doc("d1", &user, "t0");
    store.create(&d).await.unwrap();

    store
        .set_pages(&d.id, &[page(1), page(2), page(3)])
        .await
        .unwrap();
    store.set_pages(&d.id, &[page(1), page(2)]).await.unwrap();
    store.set_reading(&d.id, &reading()).await.unwrap();
    let voice = ObjectKey::from_stored("users/u1/documents/d1/voice_ab.wav".into());
    store.set_summary_audio(&d.id, &voice).await.unwrap();
    store.set_title(&d.id, "My bill", "t2").await.unwrap();

    let got = store.get(&d.id).await.unwrap().unwrap();
    assert_eq!(got.page_count, 2, "pages replaced, not added");
    assert_eq!(store.pages(&d.id).await.unwrap(), [page(1), page(2)]);
    let want = Reading {
        title: "My bill".into(),
        ..reading()
    };
    let stored = Reading {
        title: got.title,
        kind: got.kind,
        sender: got.sender,
        date: got.date,
        text: got.text,
        summary: got.summary,
    };
    assert_eq!(stored, want);
    assert_eq!(got.summary_audio_key, Some(voice));
    assert_eq!(got.updated_at, "t2");
}

#[tokio::test]
async fn voices_are_recorded_once_and_delete_takes_pages_and_voices() {
    let (_cat, pool, user, _) = fixture().await;
    let store = SqliteDocumentStore::new(pool.clone());
    let d = doc("d1", &user, "t0");
    store.create(&d).await.unwrap();
    store.set_pages(&d.id, &[page(1)]).await.unwrap();
    let a = ObjectKey::from_stored("users/u1/documents/d1/voice_a.wav".into());
    let b = ObjectKey::from_stored("users/u1/documents/d1/voice_b.wav".into());
    store.add_voice(&d.id, &b).await.unwrap();
    store.add_voice(&d.id, &a).await.unwrap();
    store.add_voice(&d.id, &a).await.unwrap();

    assert_eq!(store.voices(&d.id).await.unwrap(), [a, b]);

    store.delete(&d.id).await.unwrap();
    store.delete(&d.id).await.unwrap();
    assert_eq!(store.get(&d.id).await.unwrap(), None);
    let left: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM document_pages) + (SELECT COUNT(*) FROM document_voices)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
}
