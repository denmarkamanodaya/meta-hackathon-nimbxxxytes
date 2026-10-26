use super::*;

fn ids(names: &[&str]) -> Vec<SegmentId> {
    names
        .iter()
        .map(|n| SegmentId::parse(*n).unwrap())
        .collect()
}

fn order(fused: &[(SegmentId, f64)]) -> Vec<&str> {
    fused.iter().map(|(s, _)| s.as_str()).collect()
}

#[test]
fn rrf_rewards_items_both_legs_agree_on() {
    let fused = rrf(&[ids(&["a", "b", "c"]), ids(&["c", "a", "d"])]);
    assert_eq!(order(&fused), ["a", "c", "b", "d"]);
    let a = fused[0].1;
    assert!((a - (1.0 / 61.0 + 1.0 / 62.0)).abs() < 1e-12);
}

#[test]
fn an_item_in_one_list_only_still_counts_and_ties_keep_first_appearance() {
    let fused = rrf(&[ids(&["x", "y"]), ids(&["z", "w"])]);
    assert_eq!(
        order(&fused),
        ["x", "z", "y", "w"],
        "x and z tie at rank 1: x appeared first"
    );
    assert!(rrf(&[]).is_empty());
}

fn cand(id: &str) -> Candidate {
    Candidate {
        segment_id: SegmentId::parse(id).unwrap(),
        clip_id: ClipId::parse("c1").unwrap(),
        clip_filename: "a.mov".into(),
        start_s: 0.0,
        end_s: 7.0,
        recorded_at: Some("2026-10-24T09:00:00.000Z".into()),
        description: "A dog naps on the sofa at the beach house.".into(),
        place: "living room".into(),
        people: vec!["Sam".into()],
        speakers: vec!["Mia".into()],
        speech: String::new(),
        quality: Some(6),
    }
}

#[test]
fn filters_on_people_and_speakers_ignore_case() {
    let c = cand("s1");
    let names = SearchFilters {
        people: vec!["sam".into()],
        speakers: vec!["MIA".into()],
        ..Default::default()
    };
    assert!(matches(&SearchFilters::default(), &c));
    assert!(matches(&names, &c));
    assert!(!matches(
        &SearchFilters {
            people: vec!["Ana".into()],
            ..Default::default()
        },
        &c
    ));
}

#[test]
fn filters_on_place_dates_and_quality() {
    let c = cand("s1");
    let f = |filters: SearchFilters| matches(&filters, &c);
    assert!(
        f(SearchFilters {
            place: Some("Beach".into()),
            ..Default::default()
        }),
        "place in description"
    );
    let same_day = SearchFilters {
        from: Some("2026-10-24".into()),
        to: Some("2026-10-24".into()),
        ..Default::default()
    };
    assert!(f(same_day));
    assert!(!f(SearchFilters {
        from: Some("2026-10-25".into()),
        ..Default::default()
    }));
    assert!(!f(SearchFilters {
        min_quality: Some(7),
        ..Default::default()
    }));
    let undated = Candidate {
        recorded_at: None,
        ..cand("s2")
    };
    assert!(!matches(
        &SearchFilters {
            to: Some("2026-12-31".into()),
            ..Default::default()
        },
        &undated
    ));
}

#[test]
fn rewrite_fallback_and_known_name_guard() {
    assert_eq!(
        raw_rewrite("Dog ON the  Sofa").keywords,
        ["dog", "on", "the", "sofa"]
    );
    let r = Rewritten {
        keywords: vec!["dog".into()],
        filters: SearchFilters {
            people: vec!["sam".into(), "Zed".into()],
            speakers: vec!["mia".into()],
            ..Default::default()
        },
    };
    let r = known_only(r, &["Sam".into()], &["Mia".into()]);
    assert_eq!(
        (r.filters.people, r.filters.speakers),
        (vec!["Sam".to_owned()], vec!["Mia".to_owned()])
    );
}
