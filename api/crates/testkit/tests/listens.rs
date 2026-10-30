//! iListen use cases over fakes: a file uploaded through the API and the whole `listen` job (the
//! check loop catching the spike's planted errors and fixing only the flagged line), the loop
//! giving up after three versions with the best kept, the number check under the checker, a long
//! transcript in parts, a clip's transcript reused, a language change that keeps the transcript,
//! no speech, the upload checks, ownership and delete.
#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::{ClipId, ListenId, SegmentId, SpeakerId, TurnId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::listen::{
    DraftTurn, HeardBy, HeardShare, ListenStatus, NUMBER_CAP, Overview,
};
use nimbytes_core::domain::segment::{SpeakerRow, TranscriptRows, TurnRow};
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::transcript::{RawTurn, Turn};
use nimbytes_core::ports::Catalogue;
use nimbytes_core::usecases::listens::{
    ListenRequest, SourceBody, change_language, complete_listen, create_listen, delete_listen,
    get_listen, list_listens, rename_listen, upload_listen_source,
};
use nimbytes_testkit::SeenListenCall;
use nimbytes_testkit::listens_world::{
    BAD_LINE_1, Body, GOOD_LINE_1, ListenWorld, MIX_WINDOWS, checked, file_request, fixed_line_1,
    mix_draft,
};

fn user(id: &str) -> UserId {
    UserId::parse(id).unwrap()
}

/// Runs the queued job to its end.
async fn run(w: &ListenWorld) {
    w.run_once().await.unwrap();
}

/// The spike scenario: v1 has the planted errors, the checker flags line 1 and the summary,
/// the fixer fixes it, v2 passes.
fn script_spike(w: &ListenWorld) {
    w.interpreter.understands(mix_draft(BAD_LINE_1));
    w.interpreter.checks(checked(&[100, 30, 100, 100, 100], 75));
    w.interpreter
        .checks(checked(&[100, 100, 100, 100, 100], 97));
    w.interpreter.fixes(fixed_line_1());
}

/// The spike scenario uploaded as a file and run to the end.
async fn spike_run() -> (ListenWorld, ListenId) {
    let w = ListenWorld::new();
    script_spike(&w);
    let id = w.uploaded("en").await.unwrap();
    run(&w).await;
    (w, id)
}

fn translations(line_1: &str) -> Vec<String> {
    let mut v: Vec<String> = mix_draft(BAD_LINE_1)
        .turns
        .iter()
        .map(|t| t.translation.clone())
        .collect();
    v[1] = line_1.into();
    v
}

#[tokio::test]
async fn a_file_ends_ready_with_the_passing_version_and_its_languages() {
    let (w, id) = spike_run().await;

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!(l.status, ListenStatus::Ready, "{:?}", l.error);
    assert_eq!((l.version, l.confidence, l.passed), (2, Some(97), true));
    assert_eq!((l.duration_ms, l.speakers, l.step), (Some(26_160), 2, None));
    let share = |code: &str, share| HeardShare {
        code: code.into(),
        share,
    };
    assert_eq!(l.languages, [share("zh", 57), share("ja", 43)]);
    assert_eq!(
        l.summary, "Fixed summary.",
        "the summary was flagged, so it was rewritten"
    );
}

#[tokio::test]
async fn only_the_flagged_line_is_fixed_and_every_version_is_kept() {
    let (w, id) = spike_run().await;

    let turns = w.listens.turns_of(id.as_str());
    assert_eq!(turns[1].translation, GOOD_LINE_1);
    assert_eq!((turns[1].fixed_in, turns[1].score), (2, Some(100)));
    assert_eq!(turns[0].fixed_in, 1);
    assert!(
        turns[0].translation.starts_with("What time"),
        "an unflagged line keeps its words even when the fixer changed it"
    );
    let versions = w.listens.versions_of(id.as_str());
    assert_eq!(versions.len(), 2);
    let v1 = versions[0].check.as_ref().unwrap();
    assert_eq!((v1.passed, v1.confidence), (false, 30));
}

#[tokio::test]
async fn spark_understands_checks_fixes_with_the_notes_and_checks_again() {
    let (w, _) = spike_run().await;
    let all = vec![0, 1, 2, 3, 4];
    let whole = "the whole recording".to_owned();
    let notes = vec![
        "turn 1: Time mistranslated as 11 AM.".to_owned(),
        "Key points say 11:00 AM.".to_owned(),
    ];
    assert_eq!(
        w.interpreter.seen(),
        [
            SeenListenCall::Understand("en".into(), all.clone()),
            SeenListenCall::Check(whole.clone(), all.clone(), translations(BAD_LINE_1)),
            SeenListenCall::Fix(all.clone(), notes),
            SeenListenCall::Check(whole, all, translations(GOOD_LINE_1)),
        ]
    );
}

#[tokio::test]
async fn the_row_shows_each_step_and_the_version_being_checked() {
    let (w, _) = spike_run().await;
    assert_eq!(
        w.listens.steps(),
        [
            "audio@0",
            "transcribe@0",
            "understand@0",
            "check@1",
            "check@1",
            "check@2",
            "check@2",
            "cover@2",
            "voice@2",
            "-@2"
        ]
    );
}

#[tokio::test]
async fn the_audio_is_probed_once_heard_once_and_the_english_summary_spoken() {
    let (w, id) = spike_run().await;
    assert_eq!(
        w.media.calls(),
        [
            "probe_audio source.m4a",
            "wav 0-26.16 source.m4a -> audio.wav",
            "silences audio.wav",
            "wav 0-20 audio.wav -> win_0_20000.wav",
            "wav 20-26.16 audio.wav -> win_20000_26160.wav",
            "fit_jpeg 720 cover_drawn.jpg -> cover.jpg",
        ]
    );
    assert_eq!(
        w.transcriber.calls(),
        ["audio.wav", MIX_WINDOWS[0], MIX_WINDOWS[1]],
        "the full pass, then the window pass"
    );
    let l = w.listens.listen(id.as_str()).unwrap();
    let voice = l.summary_audio_key.unwrap();
    assert!(voice.as_str().starts_with("users/u1/listens/l-1/voice_"));
    assert_eq!(w.listens.voices_of(id.as_str()), [voice.as_str()]);
    assert!(!w.narrator.spoken().is_empty());
    assert!(w.scratch.removed().contains(&"listens/l-1".to_owned()));
}

#[tokio::test]
async fn after_three_failing_versions_the_best_is_kept_and_not_passed() {
    let w = ListenWorld::new();
    w.interpreter.understands(mix_draft(BAD_LINE_1));
    w.interpreter.checks(checked(&[100, 30, 100, 100, 100], 95));
    w.interpreter.checks(checked(&[100, 80, 100, 100, 100], 95));
    w.interpreter.checks(checked(&[100, 50, 100, 100, 100], 95));
    w.interpreter.fixes(fixed_line_1());
    let id = w.uploaded("en").await.unwrap();

    run(&w).await;

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!(l.status, ListenStatus::Ready);
    assert_eq!((l.version, l.confidence, l.passed), (2, Some(80), false));
    assert_eq!(w.listens.versions_of(id.as_str()).len(), 3);
    let fixes = w
        .interpreter
        .seen()
        .iter()
        .filter(|c| matches!(c, SeenListenCall::Fix(..)))
        .count();
    assert_eq!(fixes, 2, "v3 is the last; no fourth version");
    let turns = w.listens.turns_of(id.as_str());
    assert_eq!(
        (turns[1].score, turns[1].issue.as_str()),
        (Some(80), "Time mistranslated as 11 AM.")
    );
}

#[tokio::test]
async fn a_lost_number_fails_the_line_even_when_the_checker_gave_it_100() {
    let w = ListenWorld::new();
    w.interpreter.understands(mix_draft(BAD_LINE_1));
    w.interpreter.checks(checked(&[100; 5], 100));
    w.interpreter.fixes(fixed_line_1());
    let id = w.uploaded("en").await.unwrap();

    run(&w).await;

    let versions = w.listens.versions_of(id.as_str());
    let v1 = versions[0].check.as_ref().unwrap();
    assert_eq!((v1.lines[1].score, v1.passed), (NUMBER_CAP, false));
    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!(
        (l.version, l.passed),
        (2, true),
        "the fix restored 10 and third"
    );
}

/// A 130-line English recording, understood as one draft and merged, every line passing.
async fn long_run() -> (ListenWorld, ListenId) {
    let w = ListenWorld::new();
    let many: Vec<RawTurn> = (0..130u64)
        .map(|i| RawTurn {
            start_ms: i * 1000,
            end_ms: i * 1000 + 900,
            text: format!("line {i}"),
            speaker: Some("A".into()),
        })
        .collect();
    w.transcriber.returns_for("audio.wav", many);
    let mut d = mix_draft(GOOD_LINE_1);
    d.turns = (0..130)
        .map(|i| DraftTurn {
            index: i,
            lang: "en".into(),
            translation: format!("line {i}"),
        })
        .collect();
    w.interpreter.understands(d);
    w.interpreter.merges(Overview {
        title: "Long talk".into(),
        summary: "Merged.".into(),
        key_points: vec![],
    });
    w.interpreter.checks(checked(&[100; 130], 95));
    let id = w.uploaded("en").await.unwrap();
    run(&w).await;
    (w, id)
}

#[tokio::test]
async fn a_long_transcript_is_understood_in_parts_then_merged() {
    let (w, id) = long_run().await;
    let seen = w.interpreter.seen();
    let understood: Vec<usize> = seen
        .iter()
        .filter_map(|c| match c {
            SeenListenCall::Understand(_, i) => Some(i.len()),
            _ => None,
        })
        .collect();
    assert_eq!(understood, [120, 10]);
    assert!(seen.contains(&SeenListenCall::Merge("en".into(), 2)));
    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!((l.title.as_str(), l.passed), ("Long talk", true));
    assert_eq!(w.listens.turns_of(id.as_str())[129].translation, "line 129");
}

#[tokio::test]
async fn a_long_transcript_is_checked_part_by_part() {
    let (w, _) = long_run().await;
    let parts: Vec<String> = w
        .interpreter
        .seen()
        .iter()
        .filter_map(|c| match c {
            SeenListenCall::Check(p, ..) => Some(p.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        parts,
        [
            "part 1 of 2 of the recording",
            "part 2 of 2 of the recording"
        ]
    );
}

/// u1's ready clip c1 (26.16 s, with sound), with or without a stored transcript.
async fn put_clip(w: &ListenWorld, with_transcript: bool) -> ClipId {
    let mut clip =
        nimbytes_testkit::world::clip(Some(nimbytes_testkit::world::probe(26.16, true))).unwrap();
    clip.title = Some("Team call".into());
    w.catalogue.put_clip(clip.clone());
    if with_transcript {
        let speaker = SpeakerRow {
            id: SpeakerId::parse("c1-sp0").unwrap(),
            label: "A".into(),
        };
        let turn = |n: u32, start_s: f64, end_s: f64, text: &str| TurnRow {
            id: TurnId::parse(format!("c1-t{n}")).unwrap(),
            turn: Turn {
                turn_no: n,
                span: Span { start_s, end_s },
                text: text.into(),
                speaker_label: Some("A".into()),
            },
            speaker_id: Some(speaker.id.clone()),
        };
        let rows = TranscriptRows {
            speakers: vec![speaker.clone()],
            turns: vec![
                turn(0, 0.0, 4.46, "我们明天的会议几点开始？"),
                turn(1, 5.34, 10.62, "明日は十時です。"),
            ],
            links: Vec::<(SegmentId, TurnId)>::new(),
        };
        w.catalogue
            .replace_transcript(&clip.id, &rows)
            .await
            .unwrap();
    }
    clip.id
}

fn clip_request(clip: &str, target: &str) -> ListenRequest {
    ListenRequest {
        filename: None,
        content_type: None,
        size_bytes: None,
        clip_id: Some(clip.into()),
        target: target.into(),
    }
}

#[tokio::test]
async fn a_clip_reuses_its_transcript_as_the_full_pass_and_needs_no_upload() {
    let w = ListenWorld::new();
    let clip = put_clip(&w, true).await;
    let mut d = mix_draft("Tomorrow is at 10.");
    d.turns.truncate(2);
    w.interpreter.understands(d);
    w.interpreter.checks(checked(&[100, 100], 100));

    let made = create_listen(&w.ports, &user("u1"), clip_request(clip.as_str(), "en"))
        .await
        .unwrap();
    assert_eq!(
        (made.status, made.source_name.as_str()),
        (ListenStatus::Listening, "Team call")
    );
    run(&w).await;

    let l = w.listens.listen(made.id.as_str()).unwrap();
    assert_eq!(l.status, ListenStatus::Ready, "{:?}", l.error);
    assert_eq!((l.duration_ms, l.speakers), (Some(26_160), 1));
    assert_eq!(
        w.transcriber.calls(),
        MIX_WINDOWS,
        "the clip's transcript stands in for the full pass; only the windows are heard"
    );
    assert_eq!(w.blobs.gets(), ["users/u1/audio/c1.wav"]);
    assert_eq!(l.heard_by, Some(HeardBy::Clip), "windows heard no more");
    let turns = w.listens.turns_of(made.id.as_str());
    assert_eq!((turns[1].start_ms, turns[1].end_ms), (5_340, 10_620));
    assert_eq!(turns[1].speaker.as_deref(), Some("A"));

    let mut body = Body(vec![b"x".to_vec()]);
    let source = SourceBody {
        content_type: Some("audio/mpeg"),
        chunks: &mut body,
    };
    let status = upload_listen_source(&w.ports, &user("u1"), &made.id, source).await;
    assert_eq!(
        status.unwrap(),
        ListenStatus::Ready,
        "a late upload changes nothing"
    );
}

#[tokio::test]
async fn a_clip_without_a_transcript_is_heard_from_its_own_wav() {
    let w = ListenWorld::new();
    let clip = put_clip(&w, false).await;
    script_spike(&w);

    let made = create_listen(&w.ports, &user("u1"), clip_request(clip.as_str(), "en"))
        .await
        .unwrap();
    run(&w).await;

    assert_eq!(w.blobs.gets(), ["users/u1/audio/c1.wav"]);
    assert_eq!(
        w.transcriber.calls(),
        ["audio.wav", MIX_WINDOWS[0], MIX_WINDOWS[1]]
    );
    let l = w.listens.listen(made.id.as_str()).unwrap();
    assert_eq!(l.status, ListenStatus::Ready);
}

#[tokio::test]
async fn a_clip_must_be_the_users_and_have_sound() {
    let w = ListenWorld::new();
    let clip = put_clip(&w, false).await;
    let err = create_listen(&w.ports, &user("u2"), clip_request(clip.as_str(), "en"))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Forbidden);
    let err = create_listen(&w.ports, &user("u1"), clip_request("nope", "en"))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);

    let mut silent =
        nimbytes_testkit::world::clip(Some(nimbytes_testkit::world::probe(5.0, false))).unwrap();
    silent.id = ClipId::parse("c2").unwrap();
    w.catalogue.put_clip(silent);
    let err = create_listen(&w.ports, &user("u1"), clip_request("c2", "en"))
        .await
        .unwrap_err();
    assert_eq!(
        (err.code, err.message.as_str()),
        (ErrorCode::ValidationFailed, "the clip has no sound")
    );
    assert!(w.jobs.all().is_empty());
}

/// The spike run to the end, then scripted for a Japanese summary.
async fn ready_for_japanese() -> (ListenWorld, ListenId) {
    let (w, id) = spike_run().await;
    let mut ja = mix_draft("明日の会議は午前10時から。場所は3階です。");
    ja.summary = "会議は10時から。".into();
    w.interpreter.understands(ja);
    w.interpreter.checks(checked(&[100; 5], 100));
    (w, id)
}

#[tokio::test]
async fn changing_the_language_keeps_the_transcript_and_reruns_from_understand() {
    let (w, id) = ready_for_japanese().await;
    let before = w.interpreter.seen().len();
    let heard = (w.transcriber.calls().len(), w.media.calls().len());

    let view = change_language(&w.ports, &user("u1"), &id, "ja")
        .await
        .unwrap();
    assert_eq!(view.view.listen.status, ListenStatus::Listening);
    assert_eq!(
        (
            view.view.listen.target.as_str(),
            view.view.listen.title.as_str()
        ),
        ("ja", "")
    );
    assert!(view.versions.is_empty());
    run(&w).await;

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!((l.status, l.target.as_str()), (ListenStatus::Ready, "ja"));
    assert_eq!((l.version, l.passed), (1, true));
    assert_eq!(
        (w.transcriber.calls().len(), w.media.calls().len()),
        heard,
        "no new transcribe call, probe or WAV"
    );
    assert_eq!(
        l.summary_audio_key, None,
        "only English is spoken on the server"
    );
    assert_eq!(
        w.interpreter.seen()[before],
        SeenListenCall::Understand("ja".into(), vec![0, 1, 2, 3, 4])
    );
}

#[tokio::test]
async fn the_same_language_changes_nothing_and_an_unknown_one_is_refused() {
    let (w, id) = spike_run().await;
    let same = change_language(&w.ports, &user("u1"), &id, "en")
        .await
        .unwrap();
    assert_eq!(same.view.listen.status, ListenStatus::Ready);
    assert_eq!(same.versions.len(), 2);
    let err = change_language(&w.ports, &user("u1"), &id, "xx")
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
}

#[tokio::test]
async fn a_language_change_before_the_transcript_only_records_the_language() {
    let w = ListenWorld::new();
    script_spike(&w);
    let id = w.uploaded("en").await.unwrap();

    let view = change_language(&w.ports, &user("u1"), &id, "ja")
        .await
        .unwrap();

    assert_eq!(
        (view.view.listen.status, view.view.listen.target.as_str()),
        (ListenStatus::Listening, "ja")
    );
    assert_eq!(w.jobs.all().len(), 1, "the queued job is kept");
    run(&w).await;
    let seen = w.interpreter.seen();
    assert_eq!(
        seen[0],
        SeenListenCall::Understand("ja".into(), vec![0, 1, 2, 3, 4])
    );
}

#[tokio::test]
async fn a_recording_without_speech_fails_with_a_clear_reason() {
    let w = ListenWorld::new();
    w.transcriber.returns_for("audio.wav", Vec::new());
    let id = w.uploaded("en").await.unwrap();

    for _ in 0..3 {
        run(&w).await;
        w.clock.advance(60_000);
    }

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!(
        (l.status, l.error.as_deref()),
        (
            ListenStatus::Failed,
            Some("no speech was heard in the recording")
        )
    );
    assert_eq!(l.step, None);
}

#[tokio::test]
async fn a_file_request_is_checked_before_anything_is_stored() {
    let w = ListenWorld::new();
    for bad in [
        file_request("notes.png", "image/png", "en"),
        file_request("talk.mp3", "audio/mpeg", "xx"),
        ListenRequest {
            size_bytes: None,
            ..file_request("talk.mp3", "audio/mpeg", "en")
        },
    ] {
        let err = create_listen(&w.ports, &user("u1"), bad).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed);
    }
    assert!(
        list_listens(&w.ports, &user("u1"))
            .await
            .unwrap()
            .is_empty()
    );
}

/// u1's new mp3 listen, nothing uploaded yet.
async fn uploading(w: &ListenWorld) -> ListenId {
    let request = file_request("talk.mp3", "audio/mpeg", "en");
    let made = create_listen(&w.ports, &user("u1"), request).await.unwrap();
    assert_eq!(
        (made.status, made.ext.as_str()),
        (ListenStatus::Uploading, "mp3")
    );
    made.id
}

async fn send(
    w: &ListenWorld,
    id: &ListenId,
    content_type: &str,
    body: Vec<Vec<u8>>,
) -> Result<ListenStatus, nimbytes_core::AppError> {
    let mut chunks = Body(body);
    let source = SourceBody {
        content_type: Some(content_type),
        chunks: &mut chunks,
    };
    upload_listen_source(&w.ports, &user("u1"), id, source).await
}

#[tokio::test]
async fn completing_needs_the_file_and_an_empty_or_odd_body_is_refused() {
    let w = ListenWorld::new();
    let id = uploading(&w).await;

    let err = complete_listen(&w.ports, &user("u1"), &id)
        .await
        .unwrap_err();
    assert_eq!(err.message, "upload the file before completing");
    let err = send(&w, &id, "audio/mpeg", Vec::new()).await.unwrap_err();
    assert_eq!(err.message, "the file is empty");
    let err = send(&w, &id, "text/plain", vec![b"ID3".to_vec()])
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
    assert!(w.blobs.puts().is_empty() && w.jobs.all().is_empty());
}

#[tokio::test]
async fn an_uploaded_body_is_stored_at_the_source_key_and_queued() {
    let w = ListenWorld::new();
    let id = uploading(&w).await;

    let body = vec![b"ID3".to_vec(), b"...".to_vec()];
    let status = send(&w, &id, "audio/mpeg", body).await.unwrap();

    assert_eq!(status, ListenStatus::Listening);
    assert_eq!(
        w.blobs.puts(),
        [(
            "users/u1/listens/l-1/source.mp3".into(),
            "audio/mpeg".into()
        )]
    );
    assert_eq!(w.scratch.written().last().unwrap().1, b"ID3...");
    assert_eq!(w.jobs.all().len(), 1);
}

#[tokio::test]
async fn only_the_owner_reads_renames_changes_or_deletes_a_listen() {
    let (w, id) = spike_run().await;
    let u2 = user("u2");
    let forbidden = ErrorCode::Forbidden;

    assert_eq!(
        get_listen(&w.ports, &u2, &id).await.unwrap_err().code,
        forbidden
    );
    let renamed = rename_listen(&w.ports, &u2, &id, "x").await;
    assert_eq!(renamed.unwrap_err().code, forbidden);
    let changed = change_language(&w.ports, &u2, &id, "ja").await;
    assert_eq!(changed.unwrap_err().code, forbidden);
    assert_eq!(
        delete_listen(&w.ports, &u2, &id).await.unwrap_err().code,
        forbidden
    );
    let missing = ListenId::parse("nope").unwrap();
    let gone = get_listen(&w.ports, &user("u1"), &missing).await;
    assert_eq!(gone.unwrap_err().code, ErrorCode::NotFound);
    assert!(list_listens(&w.ports, &u2).await.unwrap().is_empty());
}

#[tokio::test]
async fn the_owner_sees_every_line_version_note_and_voice_and_renames() {
    let (w, id) = spike_run().await;
    let u1 = user("u1");

    let view = get_listen(&w.ports, &u1, &id).await.unwrap();
    assert_eq!((view.turns.len(), view.versions.len()), (5, 2));
    assert_eq!(
        view.versions[0].notes,
        [
            "line 2: Time mistranslated as 11 AM.",
            "Key points say 11:00 AM."
        ]
    );
    assert!(view.summary_audio_url.is_some());
    let renamed = rename_listen(&w.ports, &u1, &id, "  Meeting  call ")
        .await
        .unwrap();
    assert_eq!(renamed.view.listen.title, "Meeting call");
}

#[tokio::test]
async fn delete_cancels_the_job_and_removes_every_object_row_and_working_file() {
    let w = ListenWorld::new();
    script_spike(&w);
    let id = w.uploaded("en").await.unwrap();
    run(&w).await;
    let voice = w.listens.voices_of(id.as_str());

    delete_listen(&w.ports, &user("u1"), &id).await.unwrap();

    assert_eq!(w.listens.listen(id.as_str()), None);
    let mut expected = vec![
        "users/u1/listens/l-1/cover.jpg".to_owned(),
        "users/u1/listens/l-1/source.m4a".to_owned(),
        "users/u1/listens/l-1/audio.wav".to_owned(),
    ];
    expected.extend(voice);
    assert_eq!(w.blobs.deleted(), expected);
    assert!(w.jobs.all().iter().all(|j| j.job.kind != JobKind::Listen));
    assert!(w.scratch.removed().contains(&"listens/l-1".to_owned()));
}

#[tokio::test]
async fn deleting_a_clip_listen_leaves_the_clips_audio_alone() {
    let w = ListenWorld::new();
    let clip = put_clip(&w, true).await;
    let made = create_listen(&w.ports, &user("u1"), clip_request(clip.as_str(), "ja"))
        .await
        .unwrap();
    delete_listen(&w.ports, &user("u1"), &made.id)
        .await
        .unwrap();
    assert_eq!(
        w.blobs.deleted(),
        ["users/u1/listens/l-1/cover.jpg"],
        "the clip's WAV stays"
    );
}

#[tokio::test]
async fn a_failed_listen_run_again_keeps_its_audio_and_transcript() {
    let w = ListenWorld::new();
    let id = w.uploaded("en").await.unwrap();
    for _ in 0..3 {
        run(&w).await;
        w.clock.advance(60_000);
    }
    let failed = w.listens.listen(id.as_str()).unwrap();
    assert_eq!(
        failed.status,
        ListenStatus::Failed,
        "Spark had nothing scripted"
    );
    script_spike(&w);

    let status = complete_listen(&w.ports, &user("u1"), &id).await.unwrap();
    assert_eq!(status, ListenStatus::Listening);
    run(&w).await;

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!((l.status, l.passed), (ListenStatus::Ready, true));
    assert_eq!(w.transcriber.calls().len(), 3, "the transcript is kept");
    assert_eq!(w.media.calls().len(), 6, "the audio is kept");
}
