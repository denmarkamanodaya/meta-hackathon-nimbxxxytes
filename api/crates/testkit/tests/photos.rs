//! Photos use cases over fakes: a photo sent through the API and its whole `photo` job (fitted
//! copies, Spark's facts from a 1280 px copy, the PE vector and the search document), the date
//! taken from the camera or the device time, HEIC refused, a wrong type refused, the owner's title
//! kept, ownership, and delete removing objects, vector and search document.
#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::{PhotoId, UserId};
use nimbytes_core::domain::photo::{NewPhoto, PhotoStatus};
use nimbytes_core::domain::probe::ImageProbe;
use nimbytes_core::usecases::photos::{
    create_photo, delete_photo, get_photo, list_photos, rename_photo, upload_photo_source,
};
use nimbytes_core::usecases::streamed::SourceBody;
use nimbytes_testkit::listens_world::Body;
use nimbytes_testkit::photos_world::{PhotoWorld, jpeg, stage_facts};

fn user(id: &str) -> UserId {
    UserId::parse(id).unwrap()
}

/// A photo sent and analysed to the end; the camera wrote a date.
async fn analysed() -> (PhotoWorld, PhotoId) {
    let w = PhotoWorld::new();
    w.describer.describes(stage_facts());
    w.media.set_image(ImageProbe {
        width: 320,
        height: 480,
        taken_at: Some("2026-08-08T06:09:37.000Z".into()),
        camera: Some("Canon EOS 200D".into()),
    });
    let id = w.uploaded("_MG_4210.jpg").await.unwrap();
    w.run_once().await.unwrap();
    (w, id)
}

#[tokio::test]
async fn a_photo_is_fitted_described_embedded_and_indexed() {
    let (w, id) = analysed().await;

    let p = w.photos.photo(id.as_str()).unwrap();
    assert_eq!(p.status, PhotoStatus::Ready, "{:?}", p.error);
    assert_eq!((p.width, p.height), (Some(320), Some(480)));
    assert_eq!(
        p.taken_at.as_deref(),
        Some("2026-08-08T06:09:37.000Z"),
        "the camera's date"
    );
    assert_eq!(p.camera.as_deref(), Some("Canon EOS 200D"));
    assert_eq!(p.title, "60th Birthday Decorated Stage");
    assert_eq!(
        w.media.calls(),
        [
            "probe_image original.jpg",
            "fit_jpeg 2048 original.jpg -> view.jpg",
            "fit_jpeg 480 view.jpg -> thumb.jpg",
            "fit_jpeg 1280 view.jpg -> spark.jpg",
        ]
    );
    assert_eq!(
        w.describer.seen(),
        ["spark.jpg"],
        "Spark sees the 1280 px copy"
    );
    let puts: Vec<String> = w.blobs.puts().into_iter().map(|(k, _)| k).collect();
    assert_eq!(
        puts,
        [
            "users/u1/photos/p-1/original.jpg",
            "users/u1/photos/p-1/view.jpg",
            "users/u1/photos/p-1/thumb.jpg"
        ]
    );
    assert!(w.scratch.removed().contains(&"photos/p-1".to_owned()));
}

#[tokio::test]
async fn the_search_document_carries_the_title_description_things_and_date() {
    let (w, _) = analysed().await;
    let docs = w.text.photo_docs();
    assert_eq!(docs[0].key.as_str(), "photo_p-1");
    assert!(
        docs[0]
            .description
            .starts_with("60th Birthday Decorated Stage. No people")
    );
    assert_eq!(docs[0].things, "stage, balloons, flowers, couch");
    assert_eq!(
        docs[0].taken_at.as_deref(),
        Some("2026-08-08T06:09:37.000Z")
    );
}

#[tokio::test]
async fn the_vector_is_stored_under_the_photos_search_key_for_its_owner() {
    let (w, _) = analysed().await;
    let near =
        nimbytes_core::ports::VectorIndex::nearest(w.vectors.as_ref(), &user("u1"), &[1.0], 5)
            .await
            .unwrap();
    assert_eq!(near[0].0.as_str(), "photo_p-1");
}

#[tokio::test]
async fn without_a_camera_date_the_device_time_is_the_date_taken() {
    let w = PhotoWorld::new();
    w.describer.describes(stage_facts());
    let id = w.uploaded("screenshot.jpg").await.unwrap();
    w.run_once().await.unwrap();
    let p = w.photos.photo(id.as_str()).unwrap();
    assert_eq!(p.taken_at.as_deref(), Some("2026-08-19T10:00:00.000Z"));
    assert_eq!(p.camera, None);
}

#[tokio::test]
async fn heic_is_refused_with_a_clear_reason_and_nothing_is_stored() {
    let w = PhotoWorld::new();
    let heic = NewPhoto {
        content_type: "image/heic".into(),
        ..jpeg("IMG_0001.HEIC")
    };
    let err = create_photo(&w.ports, &user("u1"), heic).await.unwrap_err();
    assert_eq!(
        (err.code, err.message.as_str()),
        (
            ErrorCode::ValidationFailed,
            "HEIC isn't supported yet; export as JPEG"
        )
    );
    assert!(list_photos(&w.ports, &user("u1")).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_body_of_another_type_or_empty_is_refused_and_nothing_queued() {
    let w = PhotoWorld::new();
    let made = create_photo(&w.ports, &user("u1"), jpeg("a.jpg"))
        .await
        .unwrap();
    for (ct, bytes) in [("image/png", b"png".to_vec()), ("image/jpeg", Vec::new())] {
        let mut body = Body(vec![bytes]);
        let source = SourceBody {
            content_type: Some(ct),
            chunks: &mut body,
        };
        let err = upload_photo_source(&w.ports, &user("u1"), &made.id, source)
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed, "{ct}");
    }
    assert!(w.blobs.puts().is_empty() && w.jobs.all().is_empty());
}

#[tokio::test]
async fn the_owners_title_and_every_url_show_and_another_user_is_refused() {
    let (w, id) = analysed().await;
    let renamed = rename_photo(&w.ports, &user("u1"), &id, " Mum's  60th ")
        .await
        .unwrap();
    assert_eq!(renamed.view.photo.title, "Mum's 60th");
    assert_eq!(
        renamed.image_url.as_deref(),
        Some("https://signed/users/u1/photos/p-1/view.jpg?ttl=3600")
    );
    assert!(renamed.original_url.is_some() && renamed.view.thumb_url.is_some());
    let u2 = user("u2");
    assert_eq!(
        get_photo(&w.ports, &u2, &id).await.unwrap_err().code,
        ErrorCode::Forbidden
    );
    assert_eq!(
        delete_photo(&w.ports, &u2, &id).await.unwrap_err().code,
        ErrorCode::Forbidden
    );
    let missing = PhotoId::parse("nope").unwrap();
    let gone = get_photo(&w.ports, &user("u1"), &missing).await;
    assert_eq!(gone.unwrap_err().code, ErrorCode::NotFound);
}

#[tokio::test]
async fn delete_removes_the_objects_vector_and_search_document() {
    let (w, id) = analysed().await;

    delete_photo(&w.ports, &user("u1"), &id).await.unwrap();

    assert_eq!(w.photos.photo(id.as_str()), None);
    assert_eq!(
        w.blobs.deleted(),
        [
            "users/u1/photos/p-1/original.jpg",
            "users/u1/photos/p-1/view.jpg",
            "users/u1/photos/p-1/thumb.jpg"
        ]
    );
    assert!(w.text.photo_docs().is_empty());
    let near =
        nimbytes_core::ports::VectorIndex::nearest(w.vectors.as_ref(), &user("u1"), &[1.0], 5)
            .await
            .unwrap();
    assert!(near.is_empty());
    assert!(w.jobs.all().is_empty());
}

#[tokio::test]
async fn a_photo_spark_cannot_describe_fails_after_its_attempts() {
    let w = PhotoWorld::new();
    let id = w.uploaded("a.jpg").await.unwrap();
    for _ in 0..3 {
        w.run_once().await.unwrap();
        w.clock.advance(60_000);
    }
    let p = w.photos.photo(id.as_str()).unwrap();
    assert_eq!(p.status, PhotoStatus::Failed);
    assert_eq!(p.width, Some(4032), "the fit before it is kept");
}
