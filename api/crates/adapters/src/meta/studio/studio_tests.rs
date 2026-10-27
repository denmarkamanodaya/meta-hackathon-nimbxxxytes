//! Shot list and coverage judge: wire format, schema checks and answer parsing against a local
//! fake API.

use std::time::Duration;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::{ClipId, SegmentId};
use nimbytes_core::domain::production::Format;
use nimbytes_core::domain::search::Candidate;
use nimbytes_core::domain::timeline::Aspect;
use serde_json::json;

use super::*;
use crate::meta::fake_api::{client, fake_api};

const SHOT_LIST_MD: &str = include_str!("../../../../../prompts/shot_list.md");
const SHOT_LIST_SCHEMA: &str = include_str!("../../../../../prompts/shot_list.schema.json");
const COVERAGE_MD: &str = include_str!("../../../../../prompts/coverage_match.md");
const COVERAGE_SCHEMA: &str = include_str!("../../../../../prompts/coverage_match.schema.json");

async fn studio(base: String) -> SparkStudio {
    let (client, _pool) = client(base).await;
    let prompts = StudioPrompts {
        shot_list: (
            Template::parse(SHOT_LIST_MD).unwrap(),
            StrictSchema::parse("shot_list", SHOT_LIST_SCHEMA).unwrap(),
        ),
        coverage: (
            Template::parse(COVERAGE_MD).unwrap(),
            StrictSchema::parse("coverage_match", COVERAGE_SCHEMA).unwrap(),
        ),
    };
    SparkStudio::new(client, prompts, Duration::from_secs(10))
}

fn answer(v: &Value) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text",
        "text": v.to_string()}]}],
        "usage": {"input_tokens": 900, "output_tokens": 600}})
    .to_string()
}

fn shot_json(act: &str, title: &str) -> Value {
    json!({"act": act, "title": title, "direction": "Eye level, slow walk.",
        "tips": ["Keep the sun behind you"], "query": "walking on a beach", "duration_s": 6})
}

fn library() -> LibrarySummary {
    LibrarySummary {
        clips: 12,
        minutes: 34.4,
        places: vec!["beach".into(), "cafe".into()],
        people: vec!["Ana".into()],
        actions: vec![],
    }
}

fn request<'a>(library: &'a LibrarySummary, rejection: Option<&'a str>) -> ShotListRequest<'a> {
    ShotListRequest {
        brief: "A morning at the beach",
        format: Format::Story,
        aspect: Aspect::Portrait,
        target_s: 60.0,
        library,
        rejection,
    }
}

fn candidate(id: &str, description: &str) -> Candidate {
    Candidate {
        segment_id: SegmentId::parse(id).unwrap(),
        clip_id: ClipId::parse("c1").unwrap(),
        clip_filename: "a.mp4".into(),
        clip_title: "Beach".into(),
        start_s: 0.0,
        end_s: 5.0,
        recorded_at: Some("2026-10-20T07:00:00.000Z".into()),
        description: description.into(),
        place: "beach".into(),
        people: vec![],
        speakers: vec![],
        speech: String::new(),
        quality: Some(7),
        faces: vec![],
    }
}

#[tokio::test]
async fn the_shot_list_call_sends_the_brief_format_and_library_with_low_effort() {
    let list = json!({"title": "Beach morning", "shots": [
        shot_json("hook", "Waves"), shot_json("story", "Walk"), shot_json("outro", "Sunset")]});
    let ok = answer(&list);
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let s = studio(base).await;
    let lib = library();

    let got = s.shot_list(&request(&lib, None)).await.unwrap();

    let ShotListAttempt::Valid(got) = got else {
        panic!("expected a valid list: {got:?}")
    };
    assert_eq!(got.title, "Beach morning");
    assert_eq!(got.shots.len(), 3);
    assert_eq!(got.shots[0].act, Act::Hook);
    assert_eq!(got.shots[2].act, Act::Outro);
    assert_eq!(got.shots[1].tips, ["Keep the sun behind you"]);
    assert_eq!(got.shots[1].duration_s, 6.0);
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0].path, "/v1/responses");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(
        (
            body["model"].as_str(),
            body["store"].as_bool(),
            body["reasoning"]["effort"].as_str()
        ),
        (Some("muse-spark-1.3"), Some(false), Some("low"))
    );
    assert_eq!(body["text"]["format"]["name"], "shot_list");
    assert_eq!(body["text"]["format"]["strict"], true);
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert_eq!(
        user,
        "Brief: A morning at the beach\nFormat: story, about 60 seconds, aspect 4:5.\n\n\
         What the owner's library holds:\n12 clips, 34 minutes.\nPlaces: beach, cafe\n\
         People: Ana\nActions: (none yet)"
    );
}

#[tokio::test]
async fn a_retry_carries_the_refusal_and_a_schema_failure_is_an_invalid_attempt() {
    let bad = answer(&json!({"title": "Beach", "shots": [shot_json("climax", "Waves")]}));
    let (base, seen) = fake_api(vec![(200, bad.as_str())]).await;
    let s = studio(base).await;
    let lib = library();

    let got = s
        .shot_list(&request(&lib, Some("shot 3 comes after shot 2")))
        .await
        .unwrap();

    let ShotListAttempt::Invalid { error } = got else {
        panic!("expected an invalid attempt: {got:?}")
    };
    assert!(error.contains("/shots"), "{error}");
    let body: Value = serde_json::from_slice(&seen.lock().unwrap()[0].body).unwrap();
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert!(
        user.ends_with(
            "\n\nYour last answer was refused: shot 3 comes after shot 2. Answer again and fix that."
        ),
        "{user}"
    );
}

fn two_shots(first: &[Candidate]) -> [CoverageShot<'_>; 2] {
    [
        CoverageShot {
            ord: 1,
            act: Act::Hook,
            title: "Waves",
            direction: "Look at the water.",
            candidates: first,
        },
        CoverageShot {
            ord: 2,
            act: Act::Story,
            title: "Walk",
            direction: "Walk on the sand.",
            candidates: &[],
        },
    ]
}

#[tokio::test]
async fn coverage_judges_every_shot_in_one_call_with_its_own_candidates() {
    let verdicts = json!({"results": [
        {"shot": 1, "segment_id": "seg-a", "reason": "waves breaking", "take_count": 2},
        {"shot": 2, "segment_id": null, "reason": "no walk on the sand", "take_count": 0}]});
    let ok = answer(&verdicts);
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let s = studio(base).await;
    let first = [candidate("seg-a", "Waves."), candidate("seg-b", "A cafe.")];

    let got = s.match_coverage("Beach", &two_shots(&first)).await.unwrap();

    let ids: Vec<_> = got.iter().map(|a| a.segment_id.as_deref()).collect();
    assert_eq!(ids, [Some("seg-a"), None]);
    assert_eq!((got[0].shot, got[0].take_count), (1, 2));
    assert_eq!(got[1].reason, "no walk on the sand");
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1, "one call for every shot");
    let body: Value = serde_json::from_slice(&seen[0].body).unwrap();
    assert_eq!(body["text"]["format"]["name"], "coverage_match");
    assert_eq!(body["reasoning"]["effort"], "low");
    let user = body["input"][1]["content"][0]["text"].as_str().unwrap();
    assert_eq!(
        user,
        format!(
            "Brief: Beach\n\n\
             Shots, each with its moments, one per line as id | date | description | place | people | speech:\n{}",
            shots_text(&two_shots(&first))
        )
    );
}

#[test]
fn each_shot_lists_its_candidates_one_line_each() {
    let first = [
        candidate("seg-a", "Waves | break\non the shore."),
        candidate("seg-b", "A cafe."),
    ];

    let text = shots_text(&two_shots(&first));

    assert_eq!(
        text,
        "Shot 1 (hook): Waves. Look at the water.\n\
         - seg-a | 2026-10-20 | Waves   break on the shore. | beach | - | -\n\
         - seg-b | 2026-10-20 | A cafe. | beach | - | -\n\n\
         Shot 2 (story): Walk. Walk on the sand.\n\
         - (no moments found)"
    );
}

#[tokio::test]
async fn an_invalid_coverage_answer_is_model_unavailable() {
    let bad = answer(
        &json!({"results": [{"shot": 0, "segment_id": null, "reason": "", "take_count": 0}]}),
    );
    let (base, _seen) = fake_api(vec![(200, bad.as_str())]).await;
    let s = studio(base).await;

    let err = s.match_coverage("x", &[]).await.unwrap_err();

    assert_eq!(err.code, ErrorCode::ModelUnavailable);
    assert!(
        err.message.contains("coverage_match answer invalid"),
        "{}",
        err.message
    );
}

#[test]
fn both_schemas_load_strict_and_check_answers() {
    let shots = StrictSchema::parse("shot_list", SHOT_LIST_SCHEMA).unwrap();
    assert_eq!(shots.format()["schema"]["additionalProperties"], false);
    let ok = json!({"title": "T", "shots": [shot_json("hook", "a"), shot_json("story", "b"),
        shot_json("outro", "c")]});
    assert!(shots.check(&ok.to_string()).is_ok());
    let thirteen: Vec<Value> = (0..13).map(|_| shot_json("story", "s")).collect();
    assert!(
        shots
            .check(&json!({"title": "T", "shots": thirteen}).to_string())
            .is_err(),
        "at most 12 shots"
    );
    let coverage = StrictSchema::parse("coverage_match", COVERAGE_SCHEMA).unwrap();
    let verdict =
        json!({"results": [{"shot": 1, "segment_id": null, "reason": "r", "take_count": 0}]});
    assert!(coverage.check(&verdict.to_string()).is_ok());
    let extra = json!({"results": [{"shot": 1, "segment_id": null, "reason": "r",
        "take_count": 0, "why": "x"}]});
    assert!(coverage.check(&extra.to_string()).is_err());
}
