//! Facts, face tracks, search documents, library rows and the clip screen on SQLite.

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::facts::{FactsStatus, SegmentFacts};
use nimbytes_core::domain::ids::{ClipId, SegmentId, SpeakerId, TrackId, TurnId, UploadId, UserId};
use nimbytes_core::domain::index::DocScope;
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::segment::{Segment, SpeakerRow, TrackRow, TranscriptRows, TurnRow};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::transcript::Turn;
use nimbytes_core::domain::upload::{Upload, UploadStatus, plan_parts};
use nimbytes_core::keys;
use nimbytes_core::ports::Catalogue;
use sqlx::SqlitePool;

use super::SqliteCatalogue;
use crate::sqlite::test_pool;

/// One user, clip "c1" with two segments, a transcript turn in segment 0, facts on segment 0.
async fn fixture() -> (SqliteCatalogue, SqlitePool, UserId, ClipId) {
    let pool = test_pool().await;
    let cat = SqliteCatalogue::new(pool.clone());
    let user = cat
        .demo_user(&UserId::parse("u1").unwrap(), "2026-10-27T00:00:00.000Z")
        .await
        .unwrap();
    let clip_id = ClipId::parse("c1").unwrap();
    let clip = Clip {
        id: clip_id.clone(),
        user_id: user.clone(),
        filename: "a.mov".into(),
        ext: MediaExt::Mov,
        size_bytes: 1,
        status: ClipStatus::Uploading,
        probe: None,
        created_at: "2026-10-27T01:00:00.000Z".into(),
    };
    let upload = Upload {
        id: UploadId::parse("up1").unwrap(),
        user_id: user.clone(),
        clip_id: clip_id.clone(),
        s3_upload_id: "s3".into(),
        key: keys::original(&user, &clip_id, MediaExt::Mov),
        size_bytes: 1,
        plan: plan_parts(1).unwrap(),
        status: UploadStatus::Open,
        created_at: clip.created_at.clone(),
    };
    cat.insert_upload(&clip, &upload).await.unwrap();
    let segs = [seg(&clip_id, 0, 0.0, 7.0), seg(&clip_id, 1, 7.0, 14.0)];
    cat.replace_segments(&clip_id, &segs).await.unwrap();
    cat.replace_transcript(&clip_id, &transcript(&segs[0]))
        .await
        .unwrap();
    cat.set_segment_facts(&segs[0].id, &facts()).await.unwrap();
    (cat, pool, user, clip_id)
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

fn transcript(s0: &Segment) -> TranscriptRows {
    let (sp, turn) = (
        SpeakerId::parse("c1-p0").unwrap(),
        TurnId::parse("c1-t0").unwrap(),
    );
    TranscriptRows {
        speakers: vec![SpeakerRow {
            id: sp.clone(),
            label: "A".into(),
        }],
        turns: vec![TurnRow {
            id: turn.clone(),
            turn: Turn {
                turn_no: 0,
                span: Span {
                    start_s: 1.0,
                    end_s: 3.0,
                },
                text: "with food.".into(),
                speaker_label: Some("A".into()),
            },
            speaker_id: Some(sp),
        }],
        links: vec![(s0.id.clone(), turn)],
    }
}

fn facts() -> SegmentFacts {
    SegmentFacts {
        description: "A latte, poured.".into(),
        actions: vec!["pouring milk".into()],
        objects: vec!["latte".into(), "cup".into()],
        place: Some("cafe counter".into()),
        mood: Some("calm".into()),
        quality: Some(7),
        hook_score: Some(8),
        status: FactsStatus::Ok,
    }
}

fn track(n: u32, first_s: f64) -> TrackRow {
    TrackRow {
        id: TrackId::parse(format!("c1-f{n}")).unwrap(),
        ordinal: n,
        first_s,
        last_s: first_s + 2.0,
        crop_key: format!("users/u1/faces/c1/c1-f{n}.jpg"),
        max_area: 0.01,
    }
}

async fn name_track(pool: &SqlitePool, user: &UserId, track: &str, name: &str) {
    sqlx::query("INSERT OR IGNORE INTO people (id, user_id, name) VALUES (?, ?, ?)")
        .bind(format!("p-{name}"))
        .bind(user.as_str())
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE face_tracks SET person_id = ? WHERE id = ?")
        .bind(format!("p-{name}"))
        .bind(track)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn facts_round_trip_and_transcripts_group_by_segment() {
    let (cat, _, _, clip) = fixture().await;

    let detail = cat.clip_detail(&clip).await.unwrap().unwrap();
    let texts = cat.segment_transcripts(&clip).await.unwrap();

    assert_eq!(detail.segments[0].facts, Some(facts()));
    assert_eq!(detail.segments[1].facts, None);
    assert_eq!(
        texts,
        [
            (
                SegmentId::parse("c1-s0").unwrap(),
                vec!["with food.".to_owned()]
            ),
            (SegmentId::parse("c1-s1").unwrap(), vec![])
        ]
    );
}

#[tokio::test]
async fn rerunning_faces_keeps_names_and_hidden_flags_and_drops_lost_tracks() {
    let (cat, pool, user, clip) = fixture().await;
    let s0 = SegmentId::parse("c1-s0").unwrap();
    cat.replace_face_tracks(
        &clip,
        &[track(0, 1.0), track(1, 8.0)],
        &[(track(0, 1.0).id, s0.clone())],
    )
    .await
    .unwrap();
    name_track(&pool, &user, "c1-f0", "Ana").await;
    sqlx::query("UPDATE face_tracks SET hidden = 1 WHERE id = 'c1-f0'")
        .execute(&pool)
        .await
        .unwrap();

    cat.replace_face_tracks(&clip, &[track(0, 2.0)], &[(track(0, 2.0).id, s0)])
        .await
        .unwrap();

    let tracks = cat.clip_detail(&clip).await.unwrap().unwrap().tracks;
    assert_eq!(tracks.len(), 1);
    assert_eq!(
        (
            tracks[0].first_s,
            tracks[0].person_name.as_deref(),
            tracks[0].hidden
        ),
        (2.0, Some("Ana"), true)
    );
}

/// Ana (visible) and Ben (hidden) in segment 0; speaker A named Mia.
async fn people_and_speaker(
    cat: &SqliteCatalogue,
    pool: &SqlitePool,
    user: &UserId,
    clip: &ClipId,
) {
    let s0 = SegmentId::parse("c1-s0").unwrap();
    let links = [
        (track(0, 1.0).id, s0.clone()),
        (track(1, 1.0).id, s0.clone()),
    ];
    cat.replace_face_tracks(clip, &[track(0, 1.0), track(1, 1.0)], &links)
        .await
        .unwrap();
    name_track(pool, user, "c1-f0", "Ana").await;
    name_track(pool, user, "c1-f1", "Ben").await;
    sqlx::query("UPDATE face_tracks SET hidden = 1 WHERE id = 'c1-f1'")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE speakers SET display_name = 'Mia' WHERE id = 'c1-p0'")
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn documents_carry_facts_speech_and_only_visible_named_people() {
    let (cat, pool, user, clip) = fixture().await;
    let s0 = SegmentId::parse("c1-s0").unwrap();
    people_and_speaker(&cat, &pool, &user, &clip).await;

    let docs = cat.index_docs(DocScope::Clip(&clip)).await.unwrap();
    let one = cat.index_docs(DocScope::Segment(&s0)).await.unwrap();

    assert_eq!(docs.len(), 2);
    let d = &docs[0];
    assert_eq!(
        (
            d.description.as_str(),
            d.actions.as_str(),
            d.objects.as_str()
        ),
        ("A latte, poured.", "pouring milk", "latte, cup")
    );
    assert_eq!(
        (
            d.transcript.as_str(),
            d.people.as_str(),
            d.speakers.as_str()
        ),
        ("with food.", "Ana", "Mia")
    );
    assert_eq!(
        (d.quality, d.hook_score, d.user_id.as_str()),
        (Some(7), Some(8), "u1")
    );
    assert_eq!(docs[1].description, "", "not described yet");
    assert_eq!(one, docs[..1]);
}

#[tokio::test]
async fn library_rows_count_segments_pick_the_first_and_list_visible_people() {
    let (cat, pool, user, clip) = fixture().await;
    cat.replace_face_tracks(&clip, &[track(0, 1.0), track(1, 8.0)], &[])
        .await
        .unwrap();
    name_track(&pool, &user, "c1-f0", "Ana").await;
    name_track(&pool, &user, "c1-f1", "Ben").await;

    let rows = cat.library(&user).await.unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(
        (
            rows[0].segment_count,
            rows[0].first_segment.as_ref().unwrap().as_str()
        ),
        (2, "c1-s0")
    );
    assert_eq!(rows[0].people, ["Ana", "Ben"]);
    assert!(
        cat.library(&UserId::parse("other").unwrap())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn clip_detail_lists_turns_speakers_and_is_none_for_an_unknown_clip() {
    let (cat, _, _, clip) = fixture().await;

    let d = cat.clip_detail(&clip).await.unwrap().unwrap();

    assert_eq!(d.turns.len(), 1);
    assert_eq!(
        (
            d.turns[0].text.as_str(),
            d.turns[0].speaker_id.as_ref().unwrap().as_str()
        ),
        ("with food.", "c1-p0")
    );
    assert_eq!(
        (
            d.speakers[0].label.as_str(),
            d.speakers[0].display_name.as_deref()
        ),
        ("A", None)
    );
    assert!(
        cat.clip_detail(&ClipId::parse("nope").unwrap())
            .await
            .unwrap()
            .is_none()
    );
}
