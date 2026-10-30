//! Memory rows on SQLite: read back whole (moments JSON too), newest first per user, saved with
//! the new step, lines and cover, the step CHECK, the 'memory' job kind, and delete.

use nimbytes_core::domain::memory::{MemoryMoment, MomentPerson};

use super::*;
use crate::sqlite::catalogue::views_tests::fixture;

fn memory(id: &str, user: &UserId, clip: &ClipId, at: &str) -> Memory {
    Memory {
        id: MemoryId::parse(id).unwrap(),
        user_id: user.clone(),
        subject_kind: SubjectKind::Clip,
        person_id: None,
        clip_id: Some(clip.clone()),
        subject_name: "60th Birthday".into(),
        viewer_id: None,
        viewer_name: Some("Eric".into()),
        title: String::new(),
        status: MemoryStatus::Making,
        step: None,
        moments: Vec::new(),
        fixed_count: 0,
        cover_key: None,
        error: None,
        created_at: at.into(),
        updated_at: at.into(),
    }
}

fn moment(clip: &ClipId) -> MemoryMoment {
    MemoryMoment {
        index: 0,
        clip_id: clip.clone(),
        clip_title: "60th Birthday".into(),
        recorded_at: None,
        start_s: 10.0,
        end_s: 20.0,
        on_screen_s: 8.0,
        frame_s: 14.5,
        people: vec![MomentPerson {
            person_id: Some(PersonId::parse("p1").unwrap()),
            name: "Ann".into(),
            crop_key: Some("users/u/faces/c/t.jpg".into()),
        }],
        description: "Ann opens a present.".into(),
        said: String::new(),
        frame_key: Some("users/u/memories/m1/frame_0.jpg".into()),
        line: "Ann opens a present.".into(),
        prompt: "What was inside?".into(),
        checked: true,
        fixed_note: Some("Removed: her birthday".into()),
    }
}

#[tokio::test]
async fn a_session_reads_back_whole_lists_newest_first_and_saves_its_progress() {
    let (_cat, pool, user, clip) = fixture().await;
    let store = SqliteMemoryStore::new(pool);
    let older = memory("m1", &user, &clip, "2026-10-31T01:00:00.000Z");
    let newer = memory("m2", &user, &clip, "2026-10-31T02:00:00.000Z");
    store.create(&older).await.unwrap();
    store.create(&newer).await.unwrap();
    assert_eq!(store.get(&older.id).await.unwrap(), Some(older.clone()));
    let ids: Vec<String> = store
        .list(&user)
        .await
        .unwrap()
        .into_iter()
        .map(|m| m.id.into())
        .collect();
    assert_eq!(ids, ["m2", "m1"]);
    assert!(
        store
            .list(&UserId::parse("nobody").unwrap())
            .await
            .unwrap()
            .is_empty()
    );

    let mut saved = older.clone();
    saved.step = Some("check".into());
    saved.title = "Ann's birthday".into();
    saved.moments = vec![moment(&clip)];
    saved.fixed_count = 1;
    saved.cover_key = Some("users/u/memories/m1/cover.jpg".into());
    saved.updated_at = "2026-10-31T03:00:00.000Z".into();
    store.save(&saved).await.unwrap();
    assert_eq!(store.get(&older.id).await.unwrap(), Some(saved.clone()));

    let mut bad = saved;
    bad.step = Some("dance".into());
    assert!(store.save(&bad).await.is_err(), "the step CHECK holds");

    store.delete(&older.id).await.unwrap();
    store.delete(&older.id).await.unwrap();
    assert_eq!(store.get(&older.id).await.unwrap(), None);
}

#[tokio::test]
async fn the_jobs_table_takes_the_memory_kind() {
    let (_cat, pool, _user, _clip) = fixture().await;
    sqlx::query(
        "INSERT INTO jobs (id, kind, subject_id, status, run_after, updated_at) \
         VALUES ('j1', 'memory', 'm1', 'queued', '0', '0')",
    )
    .execute(&pool)
    .await
    .unwrap();
}
