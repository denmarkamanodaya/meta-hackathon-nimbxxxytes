//! Every rule `settle` holds a model's draft to.

use super::*;

fn clip(id: &str) -> AskClip {
    AskClip {
        id: ClipId::parse(id).unwrap(),
        title: format!("clip {id}"),
        duration_s: Some(12.0),
    }
}

fn project(id: &str, name: &str) -> AskProject {
    AskProject {
        id: ProjectId::parse(id).unwrap(),
        name: name.into(),
        clip_count: 4,
    }
}

fn request(clips: &[&str]) -> IntentRequest {
    IntentRequest {
        text: "make something".into(),
        projects: vec![project("p1", "TJ Concert"), project("p2", "60th Birthday")],
        clips: clips.iter().map(|c| clip(c)).collect(),
        library_clips: 40,
    }
}

fn draft(kind: &str) -> IntentDraft {
    IntentDraft {
        kind: kind.into(),
        title: "A title".into(),
        ..IntentDraft::default()
    }
}

fn ids(intent: &Intent) -> Vec<&str> {
    intent.clip_ids.iter().map(ClipId::as_str).collect()
}

#[test]
fn kinds_and_sources_round_trip_and_unknown_text_reads_as_unclear() {
    for k in IntentKind::ALL {
        assert_eq!(IntentKind::parse(k.as_str()), Some(k));
    }
    for s in ShortSource::ALL {
        assert_eq!(ShortSource::parse(s.as_str()), Some(s));
    }
    let out = settle(&draft("delete_everything"), &request(&[]));
    assert_eq!(out.kind, IntentKind::Unclear);
    assert!(!out.choices.is_empty());
}

#[test]
fn a_project_that_is_not_the_callers_becomes_null() {
    let d = IntentDraft {
        source: Some("project".into()),
        project_id: Some("someone_elses".into()),
        ..draft("make_short")
    };
    let out = settle(&d, &request(&[]));
    assert_eq!(out.kind, IntentKind::Unclear, "a short with no project");
    assert_eq!(out.project_id, None);

    let d = IntentDraft {
        clip_ids: vec!["c1".into()],
        project_id: Some("someone_elses".into()),
        ..draft("add_to_project")
    };
    let out = settle(&d, &request(&["c1"]));
    assert_eq!(out.project_id, None);
    assert_eq!(out.kind, IntentKind::Unclear);
}

#[test]
fn the_callers_project_is_kept() {
    let d = IntentDraft {
        source: Some("project".into()),
        project_id: Some("p2".into()),
        ..draft("make_short")
    };
    let out = settle(&d, &request(&[]));
    assert_eq!(out.kind, IntentKind::MakeShort);
    assert_eq!(out.source, Some(ShortSource::Project));
    assert_eq!(out.project_id.as_ref().map(ProjectId::as_str), Some("p2"));
    assert_eq!(out.query, None, "the whole project");
}

#[test]
fn a_short_from_a_project_keeps_its_topic_but_needs_none() {
    let d = IntentDraft {
        source: Some("project".into()),
        project_id: Some("p1".into()),
        query: Some("  sunsets ".into()),
        ..draft("make_short")
    };
    let out = settle(&d, &request(&[]));
    assert_eq!(out.kind, IntentKind::MakeShort);
    assert_eq!(out.query.as_deref(), Some("sunsets"));

    let blank = IntentDraft {
        query: Some("   ".into()),
        ..d
    };
    let out = settle(&blank, &request(&[]));
    assert_eq!(out.kind, IntentKind::MakeShort, "a blank topic is no topic");
    assert_eq!(out.query, None);
}

#[test]
fn clip_ids_keep_only_sent_clips_in_sent_order() {
    let d = IntentDraft {
        source: Some("attached".into()),
        clip_ids: vec!["c3".into(), "invented".into(), "c1".into(), "c1".into()],
        ..draft("make_short")
    };
    let out = settle(&d, &request(&["c1", "c2", "c3"]));
    assert_eq!(ids(&out), ["c1", "c3"]);
}

#[test]
fn a_draft_naming_no_sent_clip_uses_every_sent_clip_and_never_an_invented_one() {
    let d = IntentDraft {
        source: Some("attached".into()),
        clip_ids: vec!["invented".into()],
        ..draft("make_short")
    };
    let out = settle(&d, &request(&["c1", "c2"]));
    assert_eq!(ids(&out), ["c1", "c2"]);

    let none_sent = settle(&d, &request(&[]));
    assert_eq!(none_sent.kind, IntentKind::Unclear);
    assert!(none_sent.clip_ids.is_empty());
}

#[test]
fn a_short_without_a_usable_source_becomes_unclear_with_a_choice() {
    let cases = [
        (None, None, &[][..]),
        (Some("attached"), None, &[][..]),
        (Some("project"), None, &[][..]),
        (Some("search"), None, &[][..]),
        (Some("search"), Some("   "), &[][..]),
        (Some("somewhere"), Some("sunsets"), &["c1"][..]),
    ];
    for (source, query, clips) in cases {
        let d = IntentDraft {
            source: source.map(str::to_owned),
            query: query.map(str::to_owned),
            target_s: Some(20.0),
            ..draft("make_short")
        };
        let out = settle(&d, &request(clips));
        assert_eq!(out.kind, IntentKind::Unclear, "{source:?} {query:?}");
        assert!((1..=3).contains(&out.choices.len()), "{source:?}");
        assert_eq!((out.source, out.target_s, out.aspect), (None, None, None));
    }
}

#[test]
fn an_unclear_short_offers_the_added_clips_or_adding_some_and_the_first_project() {
    let d = draft("make_short");
    let none = settle(&d, &request(&[]));
    assert_eq!(none.choices[0], choice(ADD_CLIPS, "make something"));
    assert_eq!(
        none.choices[1],
        choice(
            "Make a short from TJ Concert",
            "make a 30 second short from the TJ Concert project"
        )
    );
    let some = settle(&d, &request(&["c1"]));
    assert_eq!(
        some.choices[0].text,
        "make a 30 second short from the added clips"
    );
}

#[test]
fn a_short_from_a_search_keeps_its_query() {
    let d = IntentDraft {
        source: Some("search".into()),
        query: Some("  sunsets \n thai trip ".into()),
        ..draft("make_short")
    };
    let out = settle(&d, &request(&["c1"]));
    assert_eq!(out.kind, IntentKind::MakeShort);
    assert_eq!(out.query.as_deref(), Some("sunsets thai trip"));
    assert!(out.clip_ids.is_empty(), "a search short uses no added clip");
}

#[test]
fn target_seconds_are_clamped_to_3_to_90_and_default_to_30() {
    let cases = [
        (None, 30.0),
        (Some(1.0), 3.0),
        (Some(3.0), 3.0),
        (Some(45.0), 45.0),
        (Some(90.0), 90.0),
        (Some(600.0), 90.0),
        (Some(f64::NAN), 30.0),
    ];
    for (raw, want) in cases {
        let d = IntentDraft {
            source: Some("attached".into()),
            target_s: raw,
            ..draft("make_short")
        };
        assert_eq!(
            settle(&d, &request(&["c1"])).target_s,
            Some(want),
            "{raw:?}"
        );
    }
}

#[test]
fn aspect_defaults_to_4_5_and_keeps_1_1() {
    let short = |aspect: Option<&str>| {
        let d = IntentDraft {
            source: Some("attached".into()),
            aspect: aspect.map(str::to_owned),
            ..draft("make_short")
        };
        settle(&d, &request(&["c1"])).aspect
    };
    assert_eq!(short(None), Some(Aspect::Portrait));
    assert_eq!(short(Some("16:9")), Some(Aspect::Portrait));
    assert_eq!(short(Some("1:1")), Some(Aspect::Square));
}

#[test]
fn a_guide_needs_one_clip_keeps_the_first_of_several_and_asks_for_one_when_none() {
    let one = settle(&draft("make_guide"), &request(&["c1"]));
    assert_eq!((one.kind, ids(&one)), (IntentKind::MakeGuide, vec!["c1"]));

    let several = settle(&draft("make_guide"), &request(&["c2", "c1", "c3"]));
    assert_eq!(ids(&several), ["c2"]);

    let none = settle(&draft("make_guide"), &request(&[]));
    assert_eq!(none.kind, IntentKind::Unclear);
    assert_eq!(none.choices, [choice(ADD_TASK_VIDEO, "make something")]);
}

#[test]
fn add_to_project_needs_clips_plus_a_project_or_a_new_name() {
    let with = |project: Option<&str>, name: Option<&str>, clips: &[&str]| {
        let d = IntentDraft {
            project_id: project.map(str::to_owned),
            new_project_name: name.map(str::to_owned),
            ..draft("add_to_project")
        };
        settle(&d, &request(clips))
    };
    let to_existing = with(Some("p1"), Some("ignored"), &["c1"]);
    assert_eq!(to_existing.kind, IntentKind::AddToProject);
    assert_eq!(
        to_existing.project_id.as_ref().map(ProjectId::as_str),
        Some("p1")
    );
    assert_eq!(to_existing.new_project_name, None);
    assert_eq!(ids(&to_existing), ["c1"]);

    let to_new = with(None, Some("  Birthday \n party "), &["c1"]);
    assert_eq!(to_new.new_project_name.as_deref(), Some("Birthday party"));
    assert_eq!(to_new.project_id, None);

    let named_like_mine = with(None, Some("tj concert"), &["c1"]);
    assert_eq!(
        named_like_mine.project_id.as_ref().map(ProjectId::as_str),
        Some("p1")
    );
    assert_eq!(named_like_mine.new_project_name, None);

    let no_clips = with(Some("p1"), None, &[]);
    assert_eq!(no_clips.kind, IntentKind::Unclear);
    assert_eq!(no_clips.choices, [choice(ADD_CLIPS, "make something")]);

    let no_project = with(None, Some("   "), &["c1"]);
    assert_eq!(no_project.kind, IntentKind::Unclear);
    let labels: Vec<&str> = no_project
        .choices
        .iter()
        .map(|c| c.label.as_str())
        .collect();
    assert_eq!(labels, ["Add to TJ Concert", "Add to 60th Birthday"]);
    assert!(no_project.clip_ids.is_empty());
}

#[test]
fn add_to_project_without_any_projects_offers_a_new_one() {
    let mut r = request(&["c1"]);
    r.projects.clear();
    let out = settle(&draft("add_to_project"), &r);
    assert_eq!(
        out.choices,
        [choice(
            "Add to a new project",
            "add these to a new project called A title"
        )]
    );
}

#[test]
fn a_new_project_name_is_cut_to_60_characters() {
    let d = IntentDraft {
        new_project_name: Some("n".repeat(80)),
        ..draft("add_to_project")
    };
    let out = settle(&d, &request(&["c1"]));
    assert_eq!(out.new_project_name.map(|n| n.chars().count()), Some(60));
}

#[test]
fn a_search_defaults_its_query_to_the_request() {
    let out = settle(&draft("search"), &request(&["c1"]));
    assert_eq!(out.query.as_deref(), Some("make something"));
    assert!(out.clip_ids.is_empty() && out.choices.is_empty());

    let d = IntentDraft {
        query: Some("sunset beach".into()),
        ..draft("search")
    };
    assert_eq!(
        settle(&d, &request(&[])).query.as_deref(),
        Some("sunset beach")
    );
}

#[test]
fn upload_carries_nothing_but_its_title() {
    let d = IntentDraft {
        query: Some("x".into()),
        clip_ids: vec!["c1".into()],
        project_id: Some("p1".into()),
        target_s: Some(20.0),
        choices: vec![choice("a", "b")],
        ..draft("upload")
    };
    let out = settle(&d, &request(&["c1"]));
    assert_eq!(out, Intent::bare(IntentKind::Upload, "A title".into()));
}

#[test]
fn unclear_has_one_to_three_choices_each_a_full_request() {
    let many = IntentDraft {
        choices: vec![
            choice("One", "make a short of the beach"),
            choice("  ", "dropped: no label"),
            choice("Empty", "   "),
            choice("Two", "search for sunsets"),
            choice("Three", "upload my clips"),
            choice("Four", "make a guide"),
        ],
        ..draft("unclear")
    };
    let out = settle(&many, &request(&[]));
    let labels: Vec<&str> = out.choices.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["One", "Two", "Three"]);

    let too_long = IntentDraft {
        choices: vec![choice("Long", "x".repeat(501))],
        ..draft("unclear")
    };
    let out = settle(&too_long, &request(&[]));
    assert_eq!(
        out.choices,
        [choice(
            "Search for “make something”",
            "search for make something"
        )]
    );
}

#[test]
fn the_title_is_one_line_of_at_most_60_characters_and_falls_back_to_the_request() {
    let long = IntentDraft {
        title: format!("{}\n tail", "t".repeat(70)),
        ..draft("search")
    };
    let out = settle(&long, &request(&[]));
    assert_eq!(out.title.chars().count(), 60);
    assert!(!out.title.contains('\n'));

    let empty = IntentDraft {
        title: "  ".into(),
        ..draft("search")
    };
    assert_eq!(settle(&empty, &request(&[])).title, "make something");
}

#[test]
fn the_request_is_trimmed_and_must_be_1_to_500_characters() {
    assert_eq!(
        checked_text("  sunset at the beach \n").unwrap(),
        "sunset at the beach"
    );
    for bad in ["", "   \n"] {
        assert_eq!(
            checked_text(bad).unwrap_err().code,
            ErrorCode::ValidationFailed
        );
    }
    assert!(
        checked_text(&"é".repeat(500)).is_ok(),
        "characters, not bytes"
    );
    assert!(checked_text(&"a".repeat(501)).is_err());
}

#[test]
fn up_to_20_distinct_clips_may_be_added() {
    let id = |n: usize| ClipId::parse(format!("c{n}")).unwrap();
    let twenty: Vec<ClipId> = (0..20).map(id).collect();
    assert_eq!(checked_clips(&twenty).unwrap().len(), 20);

    let mut repeated = twenty.clone();
    repeated.push(id(0));
    assert_eq!(
        checked_clips(&repeated).unwrap(),
        twenty,
        "repeats collapse"
    );

    let mut too_many = twenty;
    too_many.push(id(20));
    let err = checked_clips(&too_many).unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
}
