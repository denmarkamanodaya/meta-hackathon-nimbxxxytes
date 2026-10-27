use super::*;

fn user() -> UserId {
    UserId::parse("u1").unwrap()
}

fn kit(colors: &[&str], font: TitleFont) -> BrandKit {
    BrandKit {
        colors: colors.iter().map(|c| (*c).to_owned()).collect(),
        title_font: font,
        logo_key: Some(ObjectKey::from_stored("users/u1/brand/logo.png".into())),
        ref_keys: vec![
            ObjectKey::from_stored("users/u1/brand/ref_0.jpg".into()),
            ObjectKey::from_stored("users/u1/brand/ref_1.png".into()),
            ObjectKey::from_stored("users/u1/brand/ref_2.png".into()),
        ],
        updated_at: "t".into(),
    }
}

#[test]
fn colours_are_one_to_three_hex_values_in_lower_case() {
    let ok = checked_colors(&[" #0B6E85".into(), "#ffe58a".into()]).unwrap();
    assert_eq!(ok, ["#0b6e85", "#ffe58a"]);
    for bad in [
        vec![],
        vec!["#fff".to_owned()],
        vec!["0b6e85".to_owned()],
        vec!["#gggggg".to_owned()],
        vec!["#000000".to_owned(); 4],
    ] {
        assert_eq!(
            checked_colors(&bad).unwrap_err().code,
            ErrorCode::ValidationFailed,
            "{bad:?}"
        );
    }
}

#[test]
fn a_kit_themes_the_video_with_its_first_colour_and_font_and_none_keeps_the_defaults() {
    let t = theme_for(Some(&kit(&["#0b6e85", "#ffffff"], TitleFont::Bricolage)));
    assert_eq!(
        (t.accent.as_str(), t.font.as_str()),
        ("#0b6e85", BRICOLAGE_FONT)
    );
    assert_eq!(
        theme_for(Some(&kit(&["#123456"], TitleFont::Geist))).font,
        GEIST_FONT
    );
    let d = theme_for(None);
    assert_eq!(
        (d.accent.as_str(), d.font.as_str()),
        (VIDEO_ACCENT, VIDEO_FONT)
    );
}

#[test]
fn only_the_owners_brand_keys_fit_their_slots() {
    let u = user();
    assert_eq!(
        brand_slot(&u, "users/u1/brand/logo.jpg"),
        Some(BrandSlot::Logo)
    );
    assert_eq!(
        brand_slot(&u, "users/u1/brand/ref_3.png"),
        Some(BrandSlot::Ref(3))
    );
    assert_eq!(brand_slot(&u, "users/u1/brand/ref_4.png"), None);
    assert_eq!(brand_slot(&u, "users/u2/brand/logo.png"), None);
    assert_eq!(brand_slot(&u, "users/u1/thumbs/c1/s1.jpg"), None);

    let refs = vec![
        "users/u1/brand/ref_0.png".to_owned(),
        "users/u1/brand/ref_2.jpg".to_owned(),
    ];
    let (logo, got) = checked_keys(&u, Some("users/u1/brand/logo.png"), &refs).unwrap();
    assert_eq!(logo.unwrap().as_str(), "users/u1/brand/logo.png");
    assert_eq!(got.len(), 2);
    assert!(
        checked_keys(&u, Some("users/u1/brand/ref_0.png"), &[]).is_err(),
        "wrong slot"
    );
    assert!(
        checked_keys(&u, None, &["users/u2/brand/ref_0.png".into()]).is_err(),
        "not yours"
    );
    let twice = vec![
        "users/u1/brand/ref_1.png".to_owned(),
        "users/u1/brand/ref_1.jpg".to_owned(),
    ];
    assert!(checked_keys(&u, None, &twice).is_err(), "one slot twice");
}

#[test]
fn uploads_are_png_or_jpeg_up_to_5_mb_in_slots_0_to_3() {
    let u = user();
    assert_eq!(
        upload_key(&u, BrandSlot::Logo, "image/png", 10)
            .unwrap()
            .as_str(),
        "users/u1/brand/logo.png"
    );
    assert_eq!(
        upload_key(&u, BrandSlot::Ref(1), "image/jpeg", MAX_UPLOAD_BYTES)
            .unwrap()
            .as_str(),
        "users/u1/brand/ref_1.jpg"
    );
    assert!(upload_key(&u, BrandSlot::Logo, "image/gif", 10).is_err());
    assert!(upload_key(&u, BrandSlot::Logo, "image/png", MAX_UPLOAD_BYTES + 1).is_err());
    assert!(upload_key(&u, BrandSlot::Logo, "image/png", 0).is_err());
    assert!(upload_key(&u, BrandSlot::Ref(4), "image/png", 10).is_err());
}

#[test]
fn anchors_are_the_logo_then_two_references() {
    let k = kit(&["#000000"], TitleFont::Geist);
    let got: Vec<String> = anchor_keys(Some(&k))
        .iter()
        .map(|k| k.as_str().to_owned())
        .collect();
    assert_eq!(
        got,
        [
            "users/u1/brand/logo.png",
            "users/u1/brand/ref_0.jpg",
            "users/u1/brand/ref_1.png"
        ]
    );
    assert!(anchor_keys(None).is_empty());
}
