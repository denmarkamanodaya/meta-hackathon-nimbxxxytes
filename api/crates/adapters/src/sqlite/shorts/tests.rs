use nimbytes_core::ErrorCode;
use nimbytes_core::domain::timeline::{
    CaptionPlan, CaptionSource, CaptionStyle, Post, TimelineClip,
};
use nimbytes_core::keys;

use super::*;
use crate::sqlite::catalogue::views_tests::fixture;

fn sid(id: &str) -> SegmentId {
    SegmentId::parse(id).unwrap()
}

fn short(user: &UserId) -> Short {
    Short {
        id: ShortId::parse("x1").unwrap(),
        user_id: user.clone(),
        prompt: "morning".into(),
        aspect: Aspect::Square,
        target_s: 12.0,
        status: ShortStatus::Planning,
        best_version: None,
        render: None,
        created_at: "2026-10-27T02:00:00.000Z".into(),
    }
}

fn timeline(in_s: f64) -> Timeline {
    Timeline {
        aspect: Aspect::Square,
        target_seconds: 12.0,
        clips: vec![TimelineClip {
            segment_id: sid("c1-s1"),
            in_s,
            out_s: 9.0,
            subject: None,
            punch_in: 1.0,
            reason: "r".into(),
        }],
        captions: CaptionPlan {
            style: CaptionStyle::Phrase,
            source: CaptionSource::Transcript,
        },
        post: Post {
            caption: "c".into(),
            hashtags: vec!["#a".into()],
        },
        rationale: "why".into(),
        revision: None,
    }
}

async fn store() -> (SqliteShortStore, Short) {
    let (_, pool, user, _) = fixture().await;
    let store = SqliteShortStore::new(pool);
    let s = short(&user);
    store
        .create(&s, &[sid("c1-s1"), sid("c1-s0")])
        .await
        .unwrap();
    (store, s)
}

#[tokio::test]
async fn a_short_reads_back_with_its_moments_in_pick_order_and_their_speech() {
    let (store, s) = store().await;

    assert_eq!(store.get(&s.id).await.unwrap(), Some(s.clone()));
    let segs = store.segments(&s.id).await.unwrap();
    let ids: Vec<&str> = segs.iter().map(|x| x.segment_id.as_str()).collect();
    assert_eq!(ids, ["c1-s1", "c1-s0"], "pick order, not clip order");
    let s0 = &segs[1];
    assert_eq!(s0.clip_ext, MediaExt::Mov);
    assert_eq!((s0.span.start_s, s0.span.end_s), (0.0, 7.0));
    assert_eq!((s0.hook_score, s0.quality), (Some(8), Some(7)));
    assert_eq!(s0.description.as_deref(), Some("A latte, poured."));
    assert_eq!(s0.turns[0].text, "with food.");
    assert!(
        segs[0].turns.is_empty(),
        "the 1–3 s turn does not overlap 7–14 s"
    );
}

#[tokio::test]
async fn owners_are_listed_for_known_segments_only() {
    let (store, s) = store().await;
    let owners = store
        .segment_owners(&[sid("c1-s0"), sid("nope")])
        .await
        .unwrap();
    assert_eq!(owners, [(sid("c1-s0"), s.user_id.clone())]);
}

#[tokio::test]
async fn versions_keep_their_timeline_json_and_a_number_is_used_once() {
    let (store, s) = store().await;
    store.add_version(&s.id, 1, &timeline(7.5)).await.unwrap();
    store.add_version(&s.id, 2, &timeline(8.0)).await.unwrap();
    let key = keys::preview(&s.user_id, &s.id, 2);
    store.set_preview(&s.id, 2, &key).await.unwrap();

    let versions = store.versions(&s.id).await.unwrap();

    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0].timeline, timeline(7.5));
    assert_eq!(versions[0].preview_key, None);
    assert_eq!(versions[1].preview_key.as_ref(), Some(&key));
    let again = store.add_version(&s.id, 2, &timeline(1.0)).await;
    assert_eq!(again.unwrap_err().code, ErrorCode::Internal);
}

#[tokio::test]
async fn status_best_version_and_render_update_in_place() {
    let (store, s) = store().await;
    let key = keys::render(&s.user_id, &s.id);
    store.set_status(&s.id, ShortStatus::Ready).await.unwrap();
    store.set_best_version(&s.id, 1).await.unwrap();
    store.set_render(&s.id, Some((&key, 3))).await.unwrap();

    let got = store.get(&s.id).await.unwrap().unwrap();
    assert_eq!(
        (got.status, got.best_version),
        (ShortStatus::Ready, Some(1))
    );
    assert_eq!(got.render, Some((key, 3)));

    store.set_render(&s.id, None).await.unwrap();
    assert_eq!(store.get(&s.id).await.unwrap().unwrap().render, None);
}

#[tokio::test]
async fn steps_are_numbered_from_zero_in_order() {
    let (store, s) = store().await;
    let step = |kind, summary: &str| NewStep {
        kind,
        tool: (kind == StepKind::ToolResult).then(|| "fit_timeline".to_owned()),
        version: Some(1),
        summary: summary.into(),
        at: "2026-10-27T02:00:01.000Z".into(),
    };
    let first = step(StepKind::Plan, "open on the pour");
    let second = step(StepKind::ToolResult, "Shot 1: in 6.00 → 7.00 s");
    assert_eq!(store.add_step(&s.id, &first).await.unwrap(), 0);
    assert_eq!(store.add_step(&s.id, &second).await.unwrap(), 1);

    let log = store.steps(&s.id).await.unwrap();

    let want = [
        Step {
            seq: 0,
            step: first,
        },
        Step {
            seq: 1,
            step: second,
        },
    ];
    assert_eq!(log, want);
}

#[tokio::test]
async fn moments_and_the_library_belong_to_their_user_only() {
    let (store, s) = store().await;
    let stranger = UserId::parse("u9").unwrap();

    let mine = store
        .moments(&s.user_id, &[sid("c1-s1"), sid("nope")])
        .await
        .unwrap();
    let theirs = store.moments(&stranger, &[sid("c1-s1")]).await.unwrap();

    let ids: Vec<&str> = mine.iter().map(|m| m.segment_id.as_str()).collect();
    assert_eq!(ids, ["c1-s1"]);
    assert!(theirs.is_empty());
    assert_eq!(
        store.library(&s.user_id).await.unwrap(),
        [sid("c1-s0"), sid("c1-s1")]
    );
    assert!(store.library(&stranger).await.unwrap().is_empty());
}

#[tokio::test]
async fn found_moments_are_appended_to_the_picks_once() {
    let (_, pool, user, _) = fixture().await;
    let store = SqliteShortStore::new(pool);
    let s = short(&user);
    store.create(&s, &[sid("c1-s1")]).await.unwrap();

    store
        .add_segments(&s.id, &[sid("c1-s0"), sid("c1-s1")])
        .await
        .unwrap();
    store.add_segments(&s.id, &[sid("c1-s0")]).await.unwrap();

    let segs = store.segments(&s.id).await.unwrap();
    let ids: Vec<&str> = segs.iter().map(|x| x.segment_id.as_str()).collect();
    assert_eq!(ids, ["c1-s1", "c1-s0"]);
}
