use super::*;

#[test]
fn legacy_and_unstyled_covers_take_the_three_original_looks_by_number_modulo_3() {
    let looks: Vec<CoverStyle> = (0..7).map(CoverStyle::by_number).collect();
    assert_eq!(
        looks,
        [
            CoverStyle::Bright,
            CoverStyle::CloseDetail,
            CoverStyle::Dramatic,
            CoverStyle::Bright,
            CoverStyle::CloseDetail,
            CoverStyle::Dramatic,
            CoverStyle::Bright,
        ]
    );
}

#[test]
fn a_cover_without_a_stored_info_gets_its_legacy_style_and_stored_ones_are_kept() {
    let stored = [CoverInfo {
        style: CoverStyle::Redrawn,
        instruction: Some("golden hour".into()),
    }];
    let infos = cover_infos(&stored, 3);
    assert_eq!(infos[0], stored[0]);
    assert_eq!(infos[1], CoverInfo::styled(CoverStyle::CloseDetail));
    assert_eq!(infos[2], CoverInfo::styled(CoverStyle::Dramatic));
    assert!(cover_infos(&stored, 0).is_empty());
}

#[test]
fn only_the_five_named_looks_can_be_picked() {
    for s in CoverStyle::PICKABLE {
        assert_eq!(s.pickable().unwrap(), s);
    }
    for s in [CoverStyle::Redrawn, CoverStyle::KeyArt] {
        assert_eq!(s.pickable().unwrap_err().code, ErrorCode::ValidationFailed);
    }
}

#[test]
fn styles_travel_as_snake_case() {
    assert_eq!(
        serde_json::to_string(&CoverStyle::CloseDetail).unwrap(),
        "\"close_detail\""
    );
    assert_eq!(
        serde_json::from_str::<CoverStyle>("\"brand_scene\"").unwrap(),
        CoverStyle::BrandScene
    );
    for s in CoverStyle::PICKABLE {
        assert_eq!(serde_json::to_value(s).unwrap(), s.as_str());
    }
    assert_eq!(
        serde_json::to_value(CoverStyle::KeyArt).unwrap(),
        CoverStyle::KeyArt.as_str()
    );
}

#[test]
fn every_way_of_adding_covers_stops_at_nine() {
    assert_eq!(next_covers(0).unwrap(), 0..3);
    assert_eq!(next_covers(7).unwrap(), 7..9);
    assert_eq!(cover_slots(4, 1).unwrap(), 4..5);
    assert_eq!(cover_slots(8, 1).unwrap(), 8..9);
    assert_eq!(
        cover_slots(9, 1).unwrap_err().code,
        ErrorCode::ValidationFailed
    );
    assert_eq!(
        next_covers(9).unwrap_err().code,
        ErrorCode::ValidationFailed
    );
}

#[test]
fn an_instruction_is_trimmed_and_3_to_120_characters() {
    assert_eq!(
        checked_instruction("  golden hour ").unwrap(),
        "golden hour"
    );
    assert!(checked_instruction("abc").is_ok());
    assert!(checked_instruction(&"é".repeat(120)).is_ok());
    for bad in ["", "  ab  ", &"x".repeat(121)] {
        assert_eq!(
            checked_instruction(bad).unwrap_err().code,
            ErrorCode::ValidationFailed,
            "{bad:?}"
        );
    }
}

#[test]
fn the_default_title_is_the_caption_without_hashtags_cut_at_a_word_under_32() {
    let t = default_title(
        "Nap champion of the whole street again today #dog #nap",
        "x",
    );
    assert_eq!(t.text, "Nap champion of the whole street");
    assert_eq!(t.text.chars().count(), 32);
    assert!(t.show);
    assert_eq!(t.position, TitlePosition::Bottom);

    assert_eq!(default_title("Nap champion #dog", "x").text, "Nap champion");
    assert_eq!(
        default_title("  #only #tags ", "Walk the dog at dawn").text,
        "Walk the dog at dawn",
        "no caption words: the short's own request"
    );
    assert_eq!(default_title("", "").text, "My short");
    assert_eq!(
        default_title(&"a".repeat(40), "x").text,
        "a".repeat(32),
        "one long word is cut mid-word"
    );
    assert_eq!(
        title_text("Unicode café über straße und mehr Wörter"),
        "Unicode café über straße und"
    );
}

#[test]
fn an_edited_title_is_trimmed_and_1_to_32_characters() {
    let t = |text: &str| CoverTitle {
        text: text.into(),
        show: false,
        position: TitlePosition::Top,
    };
    let ok = checked_title(t("  Nap champion ")).unwrap();
    assert_eq!(ok.text, "Nap champion");
    assert!(!ok.show);
    assert_eq!(ok.position, TitlePosition::Top);
    for bad in ["", "   ", &"x".repeat(33)] {
        assert_eq!(
            checked_title(t(bad)).unwrap_err().code,
            ErrorCode::ValidationFailed
        );
    }
}

#[test]
fn a_title_travels_as_text_show_and_position_and_refuses_unknown_fields() {
    let t: CoverTitle =
        serde_json::from_str(r#"{"text":"Hi","show":true,"position":"top"}"#).unwrap();
    assert_eq!(t.position, TitlePosition::Top);
    assert!(
        serde_json::from_str::<CoverTitle>(r#"{"text":"Hi","show":true,"position":"middle"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<CoverTitle>(r#"{"text":"Hi","show":true,"position":"top","x":1}"#)
            .is_err()
    );
}

#[test]
fn the_published_cover_is_the_titled_still_the_plain_pick_or_baking() {
    let covers = ["c0", "c1"];
    let titled = "t";
    assert_eq!(
        published_cover(&covers, 1, true, Some(&titled)),
        PublishedCover::Titled(&"t")
    );
    assert_eq!(
        published_cover(&covers, 1, false, Some(&titled)),
        PublishedCover::Plain(&"c1")
    );
    assert_eq!(
        published_cover(&covers, 0, true, None),
        PublishedCover::Baking
    );
    assert_eq!(
        published_cover::<&str>(&[], 0, true, None),
        PublishedCover::None
    );
    assert_eq!(
        published_cover(&covers, 5, false, None),
        PublishedCover::None
    );
}

#[test]
fn key_art_takes_the_four_strongest_hooks_first_on_a_tie_unscored_last() {
    let moments = vec![
        ("a", Some(3)),
        ("b", None),
        ("c", Some(9)),
        ("d", Some(9)),
        ("e", Some(5)),
        ("f", Some(1)),
    ];
    let picked: Vec<&str> = art_moments(moments, |m| m.1)
        .into_iter()
        .map(|m| m.0)
        .collect();
    assert_eq!(picked, ["c", "d", "e", "a"]);
    let few: Vec<&str> = art_moments(vec![("x", None), ("y", Some(2))], |m| m.1)
        .into_iter()
        .map(|m| m.0)
        .collect();
    assert_eq!(few, ["y", "x"]);
}

#[test]
fn a_footage_board_is_due_for_a_covered_shot_without_one_or_with_a_new_moment() {
    assert!(footage_board_due(Some(&"s1"), None, false));
    assert!(footage_board_due(Some(&"s2"), Some(&"s1"), true));
    assert!(!footage_board_due(Some(&"s1"), Some(&"s1"), true));
    assert!(
        footage_board_due(Some(&"s1"), Some(&"s1"), false),
        "the board was lost"
    );
    assert!(!footage_board_due::<&str>(None, Some(&"s1"), true));
    assert_eq!(footage_step(2, 5), "footage_boards 2/5");
}
