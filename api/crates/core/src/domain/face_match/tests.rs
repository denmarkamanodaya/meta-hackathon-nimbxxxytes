use super::*;

fn t(id: &str) -> TrackId {
    TrackId::parse(id).unwrap()
}

fn link(a: &str, b: &str, confidence: f64) -> FaceLink {
    FaceLink {
        a: t(a),
        b: t(b),
        confidence,
    }
}

fn ana(track: &str) -> NamedTrack {
    NamedTrack {
        track: t(track),
        person_id: PersonId::parse("p-ana").unwrap(),
        name: "Ana".into(),
    }
}

#[test]
fn a_verdict_confirms_only_when_same_and_confident_enough() {
    let v = |same, confidence| FaceVerdict {
        same,
        confidence,
        kind: FaceKind::Person,
    };
    assert!(
        v(true, CONFIRM_MIN).confirmed(),
        "the threshold itself counts"
    );
    assert!(!v(true, CONFIRM_MIN - 0.001).confirmed());
    assert!(!v(false, 1.0).confirmed());
}

#[test]
fn unnamed_faces_linked_directly_or_through_each_other_share_one_group() {
    let unnamed = [t("c1-f0"), t("c2-f0"), t("c3-f0"), t("c4-f0")];
    let links = [link("c2-f0", "c3-f0", 0.9), link("c3-f0", "c1-f0", 0.8)];

    let m = match_faces(&unnamed, &[], &links);

    for id in ["c1-f0", "c2-f0", "c3-f0"] {
        assert_eq!(m[&t(id)].group_id.as_deref(), Some("c1-f0"), "{id}");
    }
    assert_eq!(
        m[&t("c4-f0")],
        Matching::default(),
        "a face on its own has no group"
    );
}

#[test]
fn a_group_gets_its_best_suggestion_on_every_member() {
    let ben = NamedTrack {
        track: t("c9-f0"),
        person_id: PersonId::parse("p-ben").unwrap(),
        name: "Ben".into(),
    };
    let unnamed = [t("c1-f0"), t("c2-f0")];
    let links = [
        link("c1-f0", "c2-f0", 0.9),
        link("c1-f0", "c8-f0", 0.75),
        link("c9-f0", "c2-f0", 0.95),
    ];

    let m = match_faces(&unnamed, &[ana("c8-f0"), ben], &links);

    for id in ["c1-f0", "c2-f0"] {
        let s = m[&t(id)].suggested.clone().unwrap();
        assert_eq!((s.name.as_str(), s.similarity), ("Ben", 0.95), "{id}");
    }
}

#[test]
fn equal_confidence_suggests_the_name_first_in_order_and_unknown_tracks_are_ignored() {
    let zed = NamedTrack {
        track: t("c7-f0"),
        person_id: PersonId::parse("p-zed").unwrap(),
        name: "Zed".into(),
    };
    let links = [
        link("c1-f0", "c7-f0", 0.8),
        link("c8-f0", "c1-f0", 0.8),
        link("c1-f0", "gone", 0.99),
    ];

    let m = match_faces(&[t("c1-f0")], &[zed, ana("c8-f0")], &links);

    let s = m[&t("c1-f0")].suggested.clone().unwrap();
    assert_eq!((s.person_id.as_str(), s.similarity), ("p-ana", 0.8));
    assert_eq!(m[&t("c1-f0")].group_id, None);
}

#[test]
fn kinds_round_trip_and_reject_other_text() {
    for k in [FaceKind::Person, FaceKind::Pet] {
        assert_eq!(FaceKind::parse(k.as_str()).unwrap(), k);
    }
    assert_eq!(
        FaceKind::parse("cat").unwrap_err().code,
        ErrorCode::ModelUnavailable
    );
}
