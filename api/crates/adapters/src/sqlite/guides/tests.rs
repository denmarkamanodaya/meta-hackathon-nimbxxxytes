//! Guide rows on SQLite: one per clip, steps replaced and upserted, and the cascade from a
//! deleted clip.

use nimbytes_core::domain::guide::{GuideStage, GuideStatus, GuideStep, LANGUAGE, Safety};
use nimbytes_core::ports::Catalogue;

use super::*;
use crate::sqlite::catalogue::views_tests::fixture;

fn guide(id: &str, clip: &ClipId, user: &UserId, at: &str) -> Guide {
    Guide {
        id: GuideId::parse(id).unwrap(),
        user_id: user.clone(),
        clip_id: clip.clone(),
        title: String::new(),
        status: GuideStatus::Queued,
        stage: None,
        safety: None,
        safety_reason: None,
        language: LANGUAGE.into(),
        error: None,
        created_at: at.into(),
        updated_at: at.into(),
    }
}

fn step(n: u32) -> GuideStep {
    GuideStep {
        n,
        title: format!("Step {n}"),
        instruction: "Turn the dial.".into(),
        start_s: f64::from(n),
        end_s: f64::from(n) + 1.0,
        key_s: f64::from(n) + 0.5,
        control: Some("dial".into()),
        highlight: None,
        image_key: None,
        audio_key: None,
        audio_text: None,
        clip_key: None,
    }
}

#[tokio::test]
async fn a_clip_has_one_guide_and_it_reads_back_whole() {
    let (_cat, pool, user, c1) = fixture().await;
    let store = SqliteGuideStore::new(pool);
    let g = guide("g1", &c1, &user, "2026-10-29T01:00:00.000Z");

    assert!(store.create(&g).await.unwrap());
    assert!(
        !store.create(&guide("g2", &c1, &user, "t")).await.unwrap(),
        "a second guide of the clip is ignored"
    );

    assert_eq!(store.get(&g.id).await.unwrap(), Some(g.clone()));
    assert_eq!(store.for_clip(&c1).await.unwrap(), Some(g.clone()));
    assert_eq!(store.list(&user).await.unwrap(), [g]);
    let nobody = UserId::parse("nobody").unwrap();
    assert!(store.list(&nobody).await.unwrap().is_empty());
}

#[tokio::test]
async fn progress_the_plan_and_an_upserted_step_are_stored() {
    let (_cat, pool, user, c1) = fixture().await;
    let store = SqliteGuideStore::new(pool);
    let g = guide("g1", &c1, &user, "t0");
    store.create(&g).await.unwrap();
    let progress = GuideProgress {
        status: GuideStatus::Running,
        stage: Some(GuideStage::Frames),
        error: None,
        at: "t1",
    };
    store.set_progress(&g.id, progress).await.unwrap();
    let verdict = GuideVerdict {
        title: "Start a wash",
        safety: Safety::Caution,
        reason: "Hot water.",
    };
    let three = [step(1), step(2), step(3)];
    store.set_plan(&g.id, verdict, &three).await.unwrap();
    store.set_plan(&g.id, verdict, &three[..2]).await.unwrap();
    let mut done = step(2);
    done.image_key = Some(ObjectKey::from_stored(
        "users/u1/guides/g1/step_2.jpg".into(),
    ));
    done.highlight = Some("dial".into());
    done.audio_text = Some("Step 2. Turn the dial.".into());
    store.put_step(&g.id, &done).await.unwrap();

    let read = store.get(&g.id).await.unwrap().unwrap();
    assert_eq!(
        (read.status, read.stage, read.safety, read.title.as_str()),
        (
            GuideStatus::Running,
            Some(GuideStage::Frames),
            Some(Safety::Caution),
            "Start a wash"
        )
    );
    assert_eq!(read.safety_reason.as_deref(), Some("Hot water."));
    assert_eq!(read.updated_at, "t1");
    assert_eq!(store.steps(&g.id).await.unwrap(), [step(1), done]);
}

#[tokio::test]
async fn deleting_the_guide_or_its_clip_removes_it_and_its_steps() {
    let (cat, pool, user, c1) = fixture().await;
    let store = SqliteGuideStore::new(pool.clone());
    let g = guide("g1", &c1, &user, "t0");
    store.create(&g).await.unwrap();
    store
        .set_plan(
            &g.id,
            GuideVerdict {
                title: "x",
                safety: Safety::Everyday,
                reason: "",
            },
            &[step(1)],
        )
        .await
        .unwrap();

    cat.delete_clip(&c1).await.unwrap();

    assert_eq!(store.get(&g.id).await.unwrap(), None);
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM guide_steps")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
    store.delete(&g.id).await.unwrap();
}
