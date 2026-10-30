//! iListen's cover and playback over fakes: the cover drawn once from the final summary, shrunk
//! and stored; a language change keeping it; a failed cover never failing the listen; and the
//! recording the detail plays back for a sound file, a video and a clip.
#![cfg(test)]

use nimbytes_core::domain::ids::UserId;
use nimbytes_core::domain::listen::ListenStatus;
use nimbytes_core::usecases::listens::{change_language, create_listen, get_listen};
use nimbytes_testkit::listens_world::{
    BAD_LINE_1, GOOD_LINE_1, ListenWorld, checked, file_request, fixed_line_1, mix_draft,
};

fn u1() -> UserId {
    UserId::parse("u1").unwrap()
}

/// The spike scenario run to the end on a file of `content_type`.
async fn ready(content_type: &str) -> (ListenWorld, nimbytes_core::domain::ids::ListenId) {
    let w = ListenWorld::new();
    w.interpreter.understands(mix_draft(BAD_LINE_1));
    w.interpreter.checks(checked(&[100, 30, 100, 100, 100], 75));
    w.interpreter.checks(checked(&[100; 5], 97));
    w.interpreter.fixes(fixed_line_1());
    let made = create_listen(
        &w.ports,
        &u1(),
        file_request("call.m4a", content_type, "en"),
    )
    .await
    .unwrap();
    let mut body = nimbytes_testkit::listens_world::Body(vec![b"RIFF".to_vec()]);
    let source = nimbytes_core::usecases::listens::SourceBody {
        content_type: Some(content_type),
        chunks: &mut body,
    };
    nimbytes_core::usecases::listens::upload_listen_source(&w.ports, &u1(), &made.id, source)
        .await
        .unwrap();
    w.run_once().await.unwrap();
    (w, made.id)
}

#[tokio::test]
async fn the_cover_is_drawn_once_from_the_final_summary_and_stored_small() {
    let (w, id) = ready("audio/x-m4a").await;

    assert_eq!(
        w.covers.scenes(),
        ["Fixed summary."],
        "the kept version's summary"
    );
    let l = w.listens.listen(id.as_str()).unwrap();
    let cover = l.cover_key.unwrap();
    assert_eq!(cover.as_str(), "users/u1/listens/l-1/cover.jpg");
    assert!(
        w.blobs
            .puts()
            .contains(&(cover.as_str().to_owned(), "image/jpeg".to_owned()))
    );
    assert!(
        w.media
            .calls()
            .contains(&"thumb@0 cover_drawn.jpg -> cover.jpg".to_owned())
    );
    let view = get_listen(&w.ports, &u1(), &id).await.unwrap();
    assert_eq!(
        view.view.cover_url.as_deref(),
        Some("https://signed/users/u1/listens/l-1/cover.jpg?ttl=3600")
    );
}

#[tokio::test]
async fn a_language_change_keeps_the_cover_and_draws_no_new_one() {
    let (w, id) = ready("audio/x-m4a").await;
    w.interpreter
        .understands(mix_draft("明日の会議は午前10時から。場所は3階です。"));

    change_language(&w.ports, &u1(), &id, "ja").await.unwrap();
    w.run_once().await.unwrap();

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!((l.status, l.target.as_str()), (ListenStatus::Ready, "ja"));
    assert!(l.cover_key.is_some());
    assert_eq!(w.covers.scenes().len(), 1, "drawn once per listen");
}

#[tokio::test]
async fn a_failed_cover_leaves_the_listen_ready_without_one() {
    let w = ListenWorld::new();
    w.covers.fail();
    w.interpreter.understands(mix_draft(GOOD_LINE_1));
    w.interpreter.checks(checked(&[100; 5], 97));
    let id = w.uploaded("en").await.unwrap();

    w.run_once().await.unwrap();

    let l = w.listens.listen(id.as_str()).unwrap();
    assert_eq!((l.status, l.cover_key), (ListenStatus::Ready, None));
    assert_eq!(w.covers.scenes().len(), 1);
    let view = get_listen(&w.ports, &u1(), &id).await.unwrap();
    assert_eq!(view.view.cover_url, None);
}

#[tokio::test]
async fn a_sound_file_plays_its_upload_and_a_video_its_extracted_wav() {
    let (w, id) = ready("audio/x-m4a").await;
    let view = get_listen(&w.ports, &u1(), &id).await.unwrap();
    assert_eq!(
        view.audio_url.as_deref(),
        Some("https://signed/users/u1/listens/l-1/source.m4a?ttl=3600")
    );

    let (w, id) = ready("video/mp4").await;
    let view = get_listen(&w.ports, &u1(), &id).await.unwrap();
    assert_eq!(
        view.audio_url.as_deref(),
        Some("https://signed/users/u1/listens/l-1/audio.wav?ttl=3600")
    );
    assert!(
        !w.blobs
            .deleted()
            .contains(&"users/u1/listens/l-1/audio.wav".to_owned()),
        "the WAV is kept for playback"
    );
}

#[tokio::test]
async fn nothing_plays_before_the_upload_and_a_clip_plays_its_own_wav() {
    let w = ListenWorld::new();
    let made = create_listen(&w.ports, &u1(), file_request("a.mp3", "audio/mpeg", "en"))
        .await
        .unwrap();
    let view = get_listen(&w.ports, &u1(), &made.id).await.unwrap();
    assert_eq!(view.audio_url, None);

    let mut clip =
        nimbytes_testkit::world::clip(Some(nimbytes_testkit::world::probe(9.0, true))).unwrap();
    clip.title = Some("Call".into());
    w.catalogue.put_clip(clip);
    let request = nimbytes_core::usecases::listens::ListenRequest {
        filename: None,
        content_type: None,
        size_bytes: None,
        clip_id: Some("c1".into()),
        target: "en".into(),
    };
    let made = create_listen(&w.ports, &u1(), request).await.unwrap();
    let view = get_listen(&w.ports, &u1(), &made.id).await.unwrap();
    assert_eq!(
        view.audio_url.as_deref(),
        Some("https://signed/users/u1/audio/c1.wav?ttl=3600")
    );
}
