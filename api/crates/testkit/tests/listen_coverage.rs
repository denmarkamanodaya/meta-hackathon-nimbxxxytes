//! iListen's transcribe coverage loop over fakes (the real-audio numbers are pinned in the domain
//! and parser tests): the window pass replacing a full pass that dropped a language, a sparse
//! window split at a pause, a split that heard less being dropped, the full pass kept with its
//! speakers, and a language change replacing a job that is already running.
#![cfg(test)]

use nimbytes_core::domain::ids::UserId;
use nimbytes_core::domain::listen::{DraftTurn, HeardBy, ListenStatus};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::transcript::RawTurn;
use nimbytes_core::ports::{Clock, JobQueue, StepRunner};
use nimbytes_core::usecases::listens::change_language;
use nimbytes_testkit::SeenListenCall;
use nimbytes_testkit::listens_world::{ListenWorld, checked, mix_draft};

const ZH: &str = "我们明天的会议几点开始？我想确认一下时间。好的,那我会准备产品的演示资料。";
const JA: &str = "はい、パソコンを持ってきてください。資料は英語でお願いします。";

fn said(start_ms: u64, end_ms: u64, text: &str, speaker: Option<&str>) -> RawTurn {
    RawTurn {
        start_ms,
        end_ms,
        text: text.into(),
        speaker: speaker.map(str::to_owned),
    }
}

fn pause(start_s: f64, end_s: f64) -> Span {
    Span { start_s, end_s }
}

/// A world whose full pass heard only the Mandarin, with one pause at 12.0-12.6 s (windows
/// 0-12.3 s and 12.3-26.16 s), and Spark scripted for `lines` passing lines.
fn mandarin_only(lines: u32) -> ListenWorld {
    let w = ListenWorld::new();
    w.transcriber
        .returns_for("audio.wav", vec![said(0, 11_000, ZH, Some("A"))]);
    w.media.set_silences(vec![pause(12.0, 12.6)]);
    let mut d = mix_draft("Line 1.");
    d.turns = (0..lines)
        .map(|i| DraftTurn {
            index: i,
            lang: "zh".into(),
            translation: format!("Line {i}."),
        })
        .collect();
    w.interpreter.understands(d);
    w.interpreter
        .checks(checked(&vec![100; lines as usize], 100));
    w
}

#[tokio::test]
async fn the_window_lines_replace_a_full_pass_that_dropped_a_language() {
    let w = mandarin_only(2);
    w.transcriber
        .returns_for("win_0_12300.wav", vec![said(0, 11_000, ZH, Some("A"))]);
    w.transcriber
        .returns_for("win_12300_26160.wav", vec![said(500, 6_000, JA, Some("A"))]);
    let id = w.uploaded("en").await.unwrap();

    w.run_once().await.unwrap();

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!(l.status, ListenStatus::Ready, "{:?}", l.error);
    assert_eq!((l.heard_by, l.speakers), (Some(HeardBy::Windows), 0));
    let turns = w.listens.turns_of(id.as_str());
    assert_eq!(turns.len(), 2);
    assert_eq!((turns[1].text.as_str(), turns[1].start_ms), (JA, 12_800));
    assert!(
        turns.iter().all(|t| t.speaker.is_none()),
        "windows have no speakers"
    );
}

#[tokio::test]
async fn a_sparse_window_is_split_at_its_pause_and_the_halves_kept() {
    let w = mandarin_only(3);
    w.media
        .set_silences(vec![pause(12.0, 12.6), pause(18.8, 19.2)]);
    w.transcriber
        .returns_for("win_0_12300.wav", vec![said(0, 11_000, ZH, Some("A"))]);
    w.transcriber
        .returns_for("win_12300_26160.wav", vec![said(0, 6_000, "RQ", None)]);
    w.transcriber.returns_for(
        "win_12300_19000.wav",
        vec![said(100, 4_000, "而终于归结到传", None)],
    );
    w.transcriber
        .returns_for("win_19000_26160.wav", vec![said(200, 6_000, JA, None)]);
    let id = w.uploaded("en").await.unwrap();

    w.run_once().await.unwrap();

    let windows: Vec<String> = w
        .transcriber
        .calls()
        .into_iter()
        .filter(|c| c.starts_with("win_"))
        .collect();
    assert_eq!(
        windows,
        [
            "win_0_12300.wav",
            "win_12300_26160.wav",
            "win_12300_19000.wav",
            "win_19000_26160.wav"
        ],
        "the sparse window was split once at 19 s; no pause is left for a second split"
    );
    let texts: Vec<String> = w
        .listens
        .turns_of(id.as_str())
        .into_iter()
        .map(|t| t.text)
        .collect();
    assert_eq!(texts, [ZH, "而终于归结到传", JA]);
}

#[tokio::test]
async fn halves_that_heard_less_are_dropped_and_the_window_kept() {
    let w = mandarin_only(2);
    w.media
        .set_silences(vec![pause(12.0, 12.6), pause(18.8, 19.2)]);
    w.transcriber
        .returns_for("win_0_12300.wav", vec![said(0, 11_000, ZH, Some("A"))]);
    w.transcriber
        .returns_for("win_12300_26160.wav", vec![said(0, 6_000, "资料", None)]);
    w.transcriber.returns_for(
        "audio.wav",
        vec![said(0, 5_000, "我们明天的会议", Some("A"))],
    );
    let id = w.uploaded("en").await.unwrap();

    w.run_once().await.unwrap();

    let texts: Vec<String> = w
        .listens
        .turns_of(id.as_str())
        .into_iter()
        .map(|t| t.text)
        .collect();
    assert_eq!(
        texts,
        [ZH, "资料"],
        "the empty halves did not replace the window"
    );
}

#[tokio::test]
async fn the_full_pass_and_its_speakers_are_kept_when_windows_hear_no_more() {
    let w = mandarin_only(1);
    w.transcriber
        .returns_for("win_0_12300.wav", vec![said(0, 11_000, ZH, None)]);
    let id = w.uploaded("en").await.unwrap();

    w.run_once().await.unwrap();

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!((l.heard_by, l.speakers), (Some(HeardBy::Full), 1));
    let turns = w.listens.turns_of(id.as_str());
    assert_eq!(turns[0].speaker.as_deref(), Some("A"));
}

#[tokio::test]
async fn a_language_change_replaces_a_running_job_and_the_old_one_stops() {
    let w = ListenWorld::new();
    w.interpreter
        .understands(mix_draft("明日の会議は午前10時から。場所は3階です。"));
    w.interpreter.checks(checked(&[100; 5], 100));
    let id = w.uploaded("en").await.unwrap();
    let old = w.jobs.claim(w.clock.now_millis()).await.unwrap().unwrap();
    w.ports.run(&old, "audio").await.unwrap();
    w.ports.run(&old, "transcribe").await.unwrap();

    let u1 = UserId::parse("u1").unwrap();
    let view = change_language(&w.ports, &u1, &id, "ja").await.unwrap();
    assert_eq!(
        (view.listen.status, view.listen.target.as_str()),
        (ListenStatus::Listening, "ja")
    );
    w.ports.run(&old, "understand").await.unwrap();
    assert!(
        w.interpreter.seen().is_empty(),
        "the replaced job does nothing"
    );

    w.run_once().await.unwrap();

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!(
        (l.status, l.target.as_str(), l.passed),
        (ListenStatus::Ready, "ja", true)
    );
    assert_eq!(
        w.interpreter.seen()[0],
        SeenListenCall::Understand("ja".into(), vec![0, 1, 2, 3, 4])
    );
    assert_eq!(
        w.transcriber
            .calls()
            .iter()
            .filter(|c| *c == "audio.wav")
            .count(),
        1,
        "the transcript was kept"
    );
}

/// u1's clip c1 whose ingest transcript holds only the Mandarin, without speakers.
async fn put_mandarin_clip(w: &ListenWorld) {
    let mut clip =
        nimbytes_testkit::world::clip(Some(nimbytes_testkit::world::probe(26.16, true))).unwrap();
    clip.title = Some("Call".into());
    w.catalogue.put_clip(clip.clone());
    let rows = nimbytes_core::domain::segment::TranscriptRows {
        speakers: Vec::new(),
        turns: vec![nimbytes_core::domain::segment::TurnRow {
            id: nimbytes_core::domain::ids::TurnId::parse("c1-t0").unwrap(),
            turn: nimbytes_core::domain::transcript::Turn {
                turn_no: 0,
                span: Span {
                    start_s: 0.0,
                    end_s: 11.0,
                },
                text: ZH.into(),
                speaker_label: None,
            },
            speaker_id: None,
        }],
        links: Vec::new(),
    };
    nimbytes_core::ports::Catalogue::replace_transcript(w.catalogue.as_ref(), &clip.id, &rows)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_clips_ingest_transcript_is_the_full_pass_and_windows_replace_it_when_richer() {
    let w = mandarin_only(2);
    put_mandarin_clip(&w).await;
    w.transcriber
        .returns_for("win_0_12300.wav", vec![said(0, 11_000, ZH, None)]);
    w.transcriber
        .returns_for("win_12300_26160.wav", vec![said(500, 6_000, JA, None)]);
    let request = nimbytes_core::usecases::listens::ListenRequest {
        filename: None,
        content_type: None,
        size_bytes: None,
        clip_id: Some("c1".into()),
        target: "en".into(),
    };
    let u1 = UserId::parse("u1").unwrap();
    let made = nimbytes_core::usecases::listens::create_listen(&w.ports, &u1, request)
        .await
        .unwrap();

    w.run_once().await.unwrap();

    assert!(
        !w.transcriber.calls().contains(&"audio.wav".to_owned()),
        "no new full pass"
    );
    let l = w.listens.listen(made.id.as_str()).unwrap();
    assert_eq!(l.heard_by, Some(HeardBy::Windows));
    let texts: Vec<String> = w
        .listens
        .turns_of(made.id.as_str())
        .into_iter()
        .map(|t| t.text)
        .collect();
    assert_eq!(
        texts,
        [ZH, JA],
        "the Japanese the ingest pass dropped is back"
    );
}
