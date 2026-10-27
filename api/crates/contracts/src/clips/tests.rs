use nimbytes_core::domain::job::INGEST_STEPS;

use super::*;

fn summary() -> ClipSummary {
    ClipSummary {
        clip_id: "c1".into(),
        filename: "IMG_0001.MOV".into(),
        title: "Morning coffee pour".into(),
        duration_s: Some(21.5),
        recorded_at: Some("2026-10-27T01:02:03.000Z".into()),
        status: ClipStatus::Ready,
        thumb_url: None,
        segment_count: 1,
        people: vec!["Ana".into()],
        duplicate_of: None,
    }
}

fn sample_detail() -> ClipDetail {
    ClipDetail {
        clip: summary(),
        proxy_url: None,
        segments: vec![Segment {
            segment_id: "s1".into(),
            idx: 0,
            start_s: 0.0,
            end_s: 7.5,
            description: None,
            actions: vec![],
            objects: vec!["cup".into()],
            place: None,
            mood: Some("calm".into()),
            quality: Some(7),
            hook_score: None,
            thumb_url: None,
        }],
        turns: vec![Turn {
            turn_id: "t1".into(),
            start_s: 5.82,
            end_s: 13.98,
            text: "with food.".into(),
            speaker_id: Some("sp1".into()),
        }],
        speakers: vec![Speaker {
            speaker_id: "sp1".into(),
            label: "A".into(),
            display_name: None,
        }],
        tracks: vec![Track {
            track_id: "tr1".into(),
            crop_url: None,
            first_s: 11.0,
            last_s: 12.0,
            person_name: None,
            hidden: false,
        }],
    }
}

#[test]
fn clip_detail_serialises_field_for_field_with_empty_lists_and_bools() {
    let detail = sample_detail();
    let want = concat!(
        r#"{"clip":{"clip_id":"c1","filename":"IMG_0001.MOV","title":"Morning coffee pour","#,
        r#""duration_s":21.5,"#,
        r#""recorded_at":"2026-10-27T01:02:03.000Z","status":"ready","thumb_url":null,"#,
        r#""segment_count":1,"people":["Ana"],"duplicate_of":null},"proxy_url":null,"#,
        r#""segments":[{"segment_id":"s1","idx":0,"start_s":0.0,"end_s":7.5,"description":null,"#,
        r#""actions":[],"objects":["cup"],"place":null,"mood":"calm","quality":7,"#,
        r#""hook_score":null,"thumb_url":null}],"#,
        r#""turns":[{"turn_id":"t1","start_s":5.82,"end_s":13.98,"text":"with food.","#,
        r#""speaker_id":"sp1"}],"#,
        r#""speakers":[{"speaker_id":"sp1","label":"A","display_name":null}],"#,
        r#""tracks":[{"track_id":"tr1","crop_url":null,"first_s":11.0,"last_s":12.0,"#,
        r#""person_name":null,"hidden":false}]}"#
    );
    assert_eq!(serde_json::to_string(&detail).unwrap(), want);
}

#[test]
fn empty_detail_lists_are_empty_arrays_not_null() {
    let detail = ClipDetail {
        clip: summary(),
        proxy_url: None,
        segments: vec![],
        turns: vec![],
        speakers: vec![],
        tracks: vec![],
    };
    let json = serde_json::to_string(&detail).unwrap();
    assert!(
        json.ends_with(r#""segments":[],"turns":[],"speakers":[],"tracks":[]}"#),
        "{json}"
    );
}

#[test]
fn clip_event_is_step_and_lowercase_status() {
    let event = ClipEvent {
        step: "transcribe".into(),
        status: StepStatus::Running,
    };
    assert_eq!(
        serde_json::to_string(&event).unwrap(),
        r#"{"step":"transcribe","status":"running"}"#
    );
}

/// The web client's `PIPELINE_STEPS` list must equal the ingest steps the worker emits.
#[test]
fn web_pipeline_steps_match_the_ingest_steps() {
    let types = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../web/src/services/api/types.ts"
    ));
    let start = types
        .find("PIPELINE_STEPS = [")
        .expect("PIPELINE_STEPS in types.ts");
    let list = &types[start..start + types[start..].find(']').unwrap()];
    let web: Vec<&str> = list.split('\'').skip(1).step_by(2).collect();
    assert_eq!(web, INGEST_STEPS);
}
