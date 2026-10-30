use super::*;

fn new(name: &str, ct: &str, size: u64) -> NewPhoto {
    NewPhoto {
        filename: name.into(),
        content_type: ct.into(),
        size_bytes: size,
        last_modified: None,
    }
}

#[test]
fn jpeg_png_and_webp_are_taken_and_heic_is_refused_with_a_clear_reason() {
    assert_eq!(
        checked_upload(&new("a.JPG", "image/jpeg", 10)).unwrap(),
        PhotoFormat::Jpeg
    );
    assert_eq!(
        checked_upload(&new("a.png", "image/png", 10))
            .unwrap()
            .ext(),
        "png"
    );
    assert_eq!(
        checked_upload(&new("a.webp", "image/webp; q=1", 10))
            .unwrap()
            .ext(),
        "webp"
    );
    let heic = checked_upload(&new("IMG_1.HEIC", "image/heic", 10)).unwrap_err();
    assert_eq!(heic.message, "HEIC isn't supported yet; export as JPEG");
    assert!(checked_upload(&new("a.heif", "image/heif", 10)).is_err());
    for bad in [
        new("a.gif", "image/gif", 10),
        new("a.jpg", "image/jpeg", 0),
        new("a.jpg", "image/jpeg", MAX_BYTES + 1),
        new(" ", "image/jpeg", 10),
    ] {
        assert_eq!(
            checked_upload(&bad).unwrap_err().code,
            ErrorCode::ValidationFailed
        );
    }
    assert!(checked_upload(&new("a.jpg", "image/jpeg", MAX_BYTES)).is_ok());
}

#[test]
fn an_exif_date_with_its_offset_becomes_utc() {
    assert_eq!(
        exif_utc("2026:08:08 14:09:37", Some("+08:00")).as_deref(),
        Some("2026-08-08T06:09:37.000Z")
    );
    assert_eq!(
        exif_utc("2026:08:08 14:09:37", Some("-05:30")).as_deref(),
        Some("2026-08-08T19:39:37.000Z")
    );
    assert_eq!(
        exif_utc("2026:08:08 14:09:37", None).as_deref(),
        Some("2026-08-08T14:09:37.000Z"),
        "no offset: the camera clock as UTC"
    );
    for bad in [
        "0000:00:00 00:00:00",
        "2026-08-08 14:09:37",
        "",
        "2026:08:08",
    ] {
        assert_eq!(exif_utc(bad, None), None, "{bad}");
    }
}

#[test]
fn the_date_taken_falls_back_to_the_device_time_then_the_upload() {
    let own = Some("2026-08-08T06:09:37.000Z");
    let device = Some("2026-08-19T10:00:00.000Z");
    let added = "2026-10-30T01:00:00.000Z";
    assert_eq!(taken_at(own, device, added), "2026-08-08T06:09:37.000Z");
    assert_eq!(taken_at(None, device, added), "2026-08-19T10:00:00.000Z");
    assert_eq!(taken_at(None, None, added), added);
}

#[test]
fn the_device_time_is_kept_only_when_it_is_a_utc_time() {
    let mut req = new("a.jpg", "image/jpeg", 1);
    req.last_modified = Some("2026-08-19T10:00:00Z".into());
    let id = (PhotoId::parse("p1").unwrap(), UserId::parse("u1").unwrap());
    let p = Photo::uploading(id.clone(), req.clone(), PhotoFormat::Jpeg, "t");
    assert_eq!(p.last_modified.as_deref(), Some("2026-08-19T10:00:00.000Z"));
    req.last_modified = Some("yesterday".into());
    assert_eq!(
        Photo::uploading(id, req, PhotoFormat::Jpeg, "t").last_modified,
        None
    );
}

#[test]
fn the_camera_name_does_not_repeat_the_make() {
    assert_eq!(
        camera_name(Some("Canon"), Some("Canon EOS 200D")).as_deref(),
        Some("Canon EOS 200D")
    );
    assert_eq!(
        camera_name(Some("Apple"), Some("iPhone 15 Pro")).as_deref(),
        Some("Apple iPhone 15 Pro")
    );
    assert_eq!(camera_name(None, Some(" X100V ")).as_deref(), Some("X100V"));
    assert_eq!(camera_name(Some(""), None), None);
}

#[test]
fn spark_facts_are_tidied() {
    let raw = PhotoFacts {
        title: "  60th   Birthday Decorated Stage with lots of extra words ".into(),
        description: " No people.\n A white loveseat. ".into(),
        things: [
            "stage", "Stage", " ", "balloons", "a", "b", "c", "d", "e", "f", "g",
        ]
        .map(String::from)
        .to_vec(),
        place: " event hall ".into(),
        mood: "festive".into(),
    };
    let t = tidied_facts(&raw);
    assert_eq!(t.title, "60th Birthday Decorated Stage with lots");
    assert_eq!(t.description, "No people. A white loveseat.");
    assert_eq!(
        t.things,
        ["stage", "balloons", "a", "b", "c", "d", "e", "f"]
    );
    assert_eq!(
        (t.place.as_str(), t.mood.as_str()),
        ("event hall", "festive")
    );
}

#[test]
fn a_photo_has_its_own_search_key_that_no_moment_has() {
    let id = PhotoId::parse("01a18c1e-42a6-775f-8c27-b8385409db86").unwrap();
    let key = search_key(&id).unwrap();
    assert_eq!(key.as_str(), "photo_01a18c1e-42a6-775f-8c27-b8385409db86");
    assert_eq!(photo_of(&key), Some(id.clone()));
    assert_eq!(photo_of(&SegmentId::parse("c1-s0").unwrap()), None);
    assert_eq!(wire_key(&id), "photo:01a18c1e-42a6-775f-8c27-b8385409db86");
    assert!(photo_title(" ").is_err());
}
