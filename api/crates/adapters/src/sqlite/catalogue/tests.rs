use nimbytes_core::domain::upload::plan_parts;
use nimbytes_core::keys;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, UploadId, UserId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::upload::{Upload, UploadStatus};
use nimbytes_core::ports::Catalogue;

use super::SqliteCatalogue;
use crate::sqlite::test_pool;

fn rows(user: &UserId, n: u32, created_at: &str) -> (Clip, Upload) {
    let clip_id = ClipId::parse(format!("c{n}")).unwrap();
    let upload = Upload {
        id: UploadId::parse(format!("up{n}")).unwrap(),
        user_id: user.clone(),
        clip_id: clip_id.clone(),
        s3_upload_id: format!("s3-{n}"),
        key: keys::original(user, &clip_id, MediaExt::Mp4),
        size_bytes: 20_000_000,
        plan: plan_parts(20_000_000).unwrap(),
        status: UploadStatus::Open,
        created_at: created_at.into(),
    };
    let clip = Clip {
        id: clip_id,
        user_id: user.clone(),
        filename: format!("clip{n}.mp4"),
        ext: MediaExt::Mp4,
        size_bytes: 20_000_000,
        status: ClipStatus::Uploading,
        probe: None,
        created_at: created_at.into(),
        title: None,
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    };
    (clip, upload)
}

async fn demo(cat: &SqliteCatalogue) -> UserId {
    cat.demo_user(&UserId::parse("u1").unwrap(), "2026-10-27T00:00:00.000Z")
        .await
        .unwrap()
}

#[tokio::test]
async fn demo_user_is_created_once() {
    let cat = SqliteCatalogue::new(test_pool().await);
    let first = demo(&cat).await;
    let again = cat
        .demo_user(&UserId::parse("u2").unwrap(), "2026-10-28T00:00:00.000Z")
        .await
        .unwrap();
    assert_eq!(first.as_str(), "u1");
    assert_eq!(again, first);
}

#[tokio::test]
async fn upload_round_trips_and_finishing_marks_the_clip_uploaded() {
    let cat = SqliteCatalogue::new(test_pool().await);
    let user = demo(&cat).await;
    let (clip, upload) = rows(&user, 1, "2026-10-27T01:00:00.000Z");
    cat.insert_upload(&clip, &upload).await.unwrap();

    assert_eq!(
        cat.get_upload(&upload.id).await.unwrap(),
        Some(upload.clone())
    );
    cat.finish_upload(&upload.id, &clip.id).await.unwrap();

    let stored = cat.get_upload(&upload.id).await.unwrap().unwrap();
    assert_eq!(stored.status, UploadStatus::Completed);
    assert_eq!(
        cat.list_clips(&user).await.unwrap()[0].status,
        ClipStatus::Uploaded
    );
}

#[tokio::test]
async fn list_clips_is_newest_first_and_only_the_users_own() {
    let cat = SqliteCatalogue::new(test_pool().await);
    let user = demo(&cat).await;
    for (n, at) in [
        (1, "2026-10-27T01:00:00.000Z"),
        (2, "2026-10-27T02:00:00.000Z"),
    ] {
        let (clip, upload) = rows(&user, n, at);
        cat.insert_upload(&clip, &upload).await.unwrap();
    }
    let ids: Vec<String> = cat
        .list_clips(&user)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.id.to_string())
        .collect();
    assert_eq!(ids, ["c2", "c1"]);
    assert!(
        cat.list_clips(&UserId::parse("other").unwrap())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn unknown_upload_is_none() {
    let cat = SqliteCatalogue::new(test_pool().await);
    assert_eq!(
        cat.get_upload(&UploadId::parse("x").unwrap())
            .await
            .unwrap(),
        None
    );
}

mod media {
    use nimbytes_core::ErrorCode;
    use nimbytes_core::domain::ids::{SegmentId, SpeakerId, TurnId};
    use nimbytes_core::domain::probe::ProbeInfo;
    use nimbytes_core::domain::segment::{Segment, SpeakerRow, TranscriptRows, TurnRow};
    use nimbytes_core::domain::segmenting::Span;
    use nimbytes_core::domain::transcript::Turn;

    use super::*;

    async fn one_clip() -> (SqliteCatalogue, sqlx::SqlitePool, ClipId) {
        let pool = test_pool().await;
        let cat = SqliteCatalogue::new(pool.clone());
        let user = demo(&cat).await;
        let (clip, upload) = rows(&user, 1, "2026-10-27T01:00:00.000Z");
        cat.insert_upload(&clip, &upload).await.unwrap();
        (cat, pool, clip.id)
    }

    fn probe() -> ProbeInfo {
        ProbeInfo {
            duration_s: 21.5,
            width: 1080,
            height: 1920,
            fps: 30.0,
            rotation: -90,
            codec: "hevc".into(),
            recorded_at: None,
            has_audio: true,
        }
    }

    fn seg(clip: &ClipId, idx: u32, start_s: f64, end_s: f64) -> Segment {
        let id = SegmentId::parse(format!("{clip}-s{idx}")).unwrap();
        Segment {
            id,
            clip_id: clip.clone(),
            idx,
            span: Span { start_s, end_s },
        }
    }

    #[tokio::test]
    async fn probe_round_trips_and_recorded_at_falls_back_to_upload_time() {
        let (cat, _, id) = one_clip().await;
        assert_eq!(cat.get_clip(&id).await.unwrap().unwrap().probe, None);

        cat.record_probe(&id, &probe()).await.unwrap();

        let clip = cat.get_clip(&id).await.unwrap().unwrap();
        assert_eq!(clip.probe, Some(probe()));
        assert_eq!(clip.recorded_at(), Some("2026-10-27T01:00:00.000Z"));
    }

    #[tokio::test]
    async fn failed_status_stores_the_upper_snake_code_and_ready_clears_it() {
        let (cat, pool, id) = one_clip().await;
        let error_code = || async {
            sqlx::query_scalar::<_, Option<String>>("SELECT error_code FROM clips")
                .fetch_one(&pool)
                .await
                .unwrap()
        };

        cat.set_clip_status(&id, ClipStatus::Failed, Some(ErrorCode::ModelUnavailable))
            .await
            .unwrap();
        assert_eq!(error_code().await.as_deref(), Some("MODEL_UNAVAILABLE"));
        cat.set_clip_status(&id, ClipStatus::Ready, None)
            .await
            .unwrap();
        assert_eq!(error_code().await, None);
        assert_eq!(
            cat.get_clip(&id).await.unwrap().unwrap().status,
            ClipStatus::Ready
        );
    }

    fn transcript(segments: &[Segment]) -> TranscriptRows {
        let speaker = SpeakerId::parse("c1-p0").unwrap();
        let turn = TurnId::parse("c1-t0").unwrap();
        TranscriptRows {
            speakers: vec![SpeakerRow {
                id: speaker.clone(),
                label: "A".into(),
            }],
            turns: vec![TurnRow {
                id: turn.clone(),
                turn: Turn {
                    turn_no: 0,
                    span: Span {
                        start_s: 5.82,
                        end_s: 13.98,
                    },
                    text: "with food.".into(),
                    speaker_label: Some("A".into()),
                },
                speaker_id: Some(speaker),
            }],
            links: vec![
                (segments[0].id.clone(), turn.clone()),
                (segments[1].id.clone(), turn),
            ],
        }
    }

    #[tokio::test]
    async fn segments_and_transcript_replace_earlier_rows_and_links() {
        let (cat, pool, id) = one_clip().await;
        let segments = [seg(&id, 0, 0.0, 8.0), seg(&id, 1, 8.0, 14.75)];
        cat.replace_segments(&id, &[seg(&id, 0, 0.0, 21.5)])
            .await
            .unwrap();
        cat.replace_segments(&id, &segments).await.unwrap();
        let rows = transcript(&segments);

        cat.replace_transcript(&id, &rows).await.unwrap();
        cat.replace_transcript(&id, &rows).await.unwrap();

        assert_eq!(cat.list_segments(&id).await.unwrap(), segments);
        let count = |sql: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(sql)
                    .fetch_one(&pool)
                    .await
                    .unwrap()
            }
        };
        assert_eq!(count("SELECT COUNT(*) FROM speakers").await, 1);
        assert_eq!(count("SELECT COUNT(*) FROM transcript_turns").await, 1);
        assert_eq!(count("SELECT COUNT(*) FROM segment_turns").await, 2);
    }
}
