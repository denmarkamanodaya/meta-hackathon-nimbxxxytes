//! Listen rows on SQLite: read back whole (JSON columns too), newest first per user, turns
//! replaced with the speaker count, a result written onto the turns, versions upserted and read
//! in order, understanding forgotten with the transcript kept, and delete taking every child row.

use nimbytes_core::domain::listen::{
    Draft, DraftTurn, HeardBy, HeardShare, LineScore, ListenStart, Overview, Scored,
};

use super::*;
use crate::sqlite::catalogue::views_tests::fixture;

fn listen(id: &str, user: &UserId, clip: Option<&ClipId>, at: &str) -> Listen {
    let start = ListenStart {
        source: if clip.is_some() {
            ListenSource::Clip
        } else {
            ListenSource::File
        },
        clip_id: clip.cloned(),
        source_name: "call.m4a".into(),
        content_type: if clip.is_some() { "" } else { "audio/x-m4a" }.into(),
        ext: if clip.is_some() { "" } else { "m4a" }.into(),
        size_bytes: if clip.is_some() { 0 } else { 5_000 },
        target: "en".into(),
    };
    let id = ListenId::parse(id).unwrap();
    Listen::new((id, user.clone()), start, ListenStatus::Uploading, at)
}

fn turns() -> Vec<ListenTurn> {
    vec![
        ListenTurn::heard(0, (0, 4_460), Some("A".into()), "我们明天的会议几点开始？"),
        ListenTurn::heard(
            1,
            (5_340, 10_620),
            Some("B".into()),
            "明日の会議は午前十時からです。",
        ),
        ListenTurn::heard(2, (10_780, 15_980), Some("A".into()), "好的"),
    ]
}

fn draft() -> Draft {
    Draft {
        title: "Meeting".into(),
        turns: vec![DraftTurn {
            index: 1,
            lang: "ja".into(),
            translation: "From 10 AM.".into(),
        }],
        summary: "A meeting at 10.".into(),
        key_points: vec!["10 AM".into()],
    }
}

fn check() -> Scored {
    Scored {
        lines: vec![LineScore {
            index: 1,
            score: 95,
            issue: String::new(),
        }],
        summary_score: 92,
        summary_issues: vec!["minor".into()],
        confidence: 92,
        passed: true,
    }
}

#[tokio::test]
async fn a_listen_reads_back_whole_and_lists_newest_first_per_user() {
    let (_cat, pool, user, clip) = fixture().await;
    let store = SqliteListenStore::new(pool);
    let older = listen("l1", &user, None, "2026-10-30T01:00:00.000Z");
    let mut newer = listen("l2", &user, Some(&clip), "2026-10-30T02:00:00.000Z");
    newer.key_points = vec!["one".into(), "two".into()];
    newer.languages = vec![HeardShare {
        code: "zh".into(),
        share: 100,
    }];
    newer.confidence = Some(97);
    newer.passed = true;
    newer.duration_ms = Some(26_160);
    store.create(&older).await.unwrap();
    store.create(&newer).await.unwrap();

    assert_eq!(store.get(&newer.id).await.unwrap(), Some(newer.clone()));
    let ids: Vec<String> = store
        .list(&user)
        .await
        .unwrap()
        .into_iter()
        .map(|l| l.id.to_string())
        .collect();
    assert_eq!(ids, ["l2", "l1"]);
    let other = UserId::parse("u2").unwrap();
    assert!(store.list(&other).await.unwrap().is_empty());
}

/// u1's file listen l1 with the three turns stored.
async fn stored() -> (SqliteListenStore, Listen, sqlx::SqlitePool) {
    let (_cat, pool, user, _) = fixture().await;
    let store = SqliteListenStore::new(pool.clone());
    let l = listen("l1", &user, None, "2026-10-30T01:00:00.000Z");
    store.create(&l).await.unwrap();
    store
        .set_turns(&l.id, &turns(), HeardBy::Windows)
        .await
        .unwrap();
    (store, l, pool)
}

fn v1(check: Option<Scored>) -> ListenVersion {
    ListenVersion {
        version: 1,
        draft: draft(),
        check,
    }
}

/// Line 1 understood and checked, as the check loop shows it.
fn shown() -> Vec<ListenTurn> {
    let mut shown = turns();
    shown[1].lang = "ja".into();
    shown[1].translation = "From 10 AM.".into();
    shown[1].score = Some(95);
    shown[1].fixed_in = 2;
    shown
}

fn result() -> ListenResult {
    ListenResult {
        version: 1,
        overview: Overview {
            title: "Meeting".into(),
            summary: "A meeting at 10.".into(),
            key_points: vec!["10 AM".into()],
        },
        languages: vec![HeardShare {
            code: "ja".into(),
            share: 100,
        }],
        confidence: Some(92),
        passed: true,
        turns: shown(),
    }
}

#[tokio::test]
async fn turns_set_the_speaker_count_and_step_and_length_are_stored() {
    let (store, l, _) = stored().await;
    store.set_duration(&l.id, 26_160).await.unwrap();
    store.set_step(&l.id, Some("check"), 2).await.unwrap();

    let got = store.get(&l.id).await.unwrap().unwrap();
    assert_eq!((got.speakers, got.duration_ms), (2, Some(26_160)));
    assert_eq!(got.heard_by, Some(HeardBy::Windows));
    assert_eq!((got.step.as_deref(), got.version), (Some("check"), 2));
    assert_eq!(store.turns(&l.id).await.unwrap(), turns());
}

#[tokio::test]
async fn a_version_is_upserted_with_its_check() {
    let (store, l, _) = stored().await;
    store.put_version(&l.id, &v1(None)).await.unwrap();
    let checked = v1(Some(check()));
    store.put_version(&l.id, &checked).await.unwrap();
    assert_eq!(
        store.versions(&l.id).await.unwrap(),
        std::slice::from_ref(&checked)
    );
}

#[tokio::test]
async fn a_result_writes_the_row_and_each_turn() {
    let (store, l, _) = stored().await;
    store.set_result(&l.id, &result()).await.unwrap();
    let key = ObjectKey::from_stored("users/u1/listens/l1/voice_ab.wav".into());
    store.set_summary_audio(&l.id, Some(&key)).await.unwrap();

    let got = store.get(&l.id).await.unwrap().unwrap();
    assert_eq!(
        (got.title.as_str(), got.confidence, got.passed, got.version),
        ("Meeting", Some(92), true, 1)
    );
    assert_eq!(got.key_points, ["10 AM"]);
    assert_eq!(got.summary_audio_key, Some(key));
    assert_eq!(store.turns(&l.id).await.unwrap(), shown());
}

#[tokio::test]
async fn forgetting_the_understanding_keeps_the_transcript() {
    let (store, l, _) = stored().await;
    store.put_version(&l.id, &v1(Some(check()))).await.unwrap();
    store.set_result(&l.id, &result()).await.unwrap();
    let key = ObjectKey::from_stored("users/u1/listens/l1/voice_ab.wav".into());
    store.set_summary_audio(&l.id, Some(&key)).await.unwrap();

    store.clear_understanding(&l.id).await.unwrap();

    let got = store.get(&l.id).await.unwrap().unwrap();
    assert_eq!(
        (got.title.as_str(), got.version, got.confidence),
        ("", 0, None)
    );
    assert!(got.languages.is_empty() && got.summary_audio_key.is_none());
    assert!(store.versions(&l.id).await.unwrap().is_empty());
    assert_eq!(
        store.turns(&l.id).await.unwrap(),
        turns(),
        "the transcript stays"
    );
}

#[tokio::test]
async fn progress_target_and_title_are_stored_and_a_bad_target_refused() {
    let (store, l, _) = stored().await;
    let progress = ListenProgress {
        status: ListenStatus::Failed,
        error: Some("no speech"),
        at: "t2",
    };
    store.set_progress(&l.id, progress).await.unwrap();
    store.set_target(&l.id, "ja", "t3").await.unwrap();
    store.set_title(&l.id, "Call", "t4").await.unwrap();

    let got = store.get(&l.id).await.unwrap().unwrap();
    assert_eq!(
        (got.status, got.error.as_deref(), got.target.as_str()),
        (ListenStatus::Failed, Some("no speech"), "ja")
    );
    assert_eq!(
        (got.title.as_str(), got.updated_at.as_str()),
        ("Call", "t4")
    );
    let refused = store.set_target(&l.id, "xx", "t5").await;
    assert!(refused.is_err(), "the CHECK refuses it");
}

#[tokio::test]
async fn voices_are_recorded_once_and_delete_takes_every_row() {
    let (store, l, pool) = stored().await;
    let key = ObjectKey::from_stored("users/u1/listens/l1/voice_ab.wav".into());
    store.add_voice(&l.id, &key).await.unwrap();
    store.add_voice(&l.id, &key).await.unwrap();
    assert_eq!(store.voices(&l.id).await.unwrap(), [key]);
    store.put_version(&l.id, &v1(None)).await.unwrap();

    store.delete(&l.id).await.unwrap();
    store.delete(&l.id).await.unwrap();

    assert_eq!(store.get(&l.id).await.unwrap(), None);
    let counts = [
        "SELECT COUNT(*) FROM listen_turns",
        "SELECT COUNT(*) FROM listen_versions",
        "SELECT COUNT(*) FROM listen_voices",
    ];
    for sql in counts {
        let n: i64 = sqlx::query_scalar(sql).fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0, "{sql}");
    }
}
