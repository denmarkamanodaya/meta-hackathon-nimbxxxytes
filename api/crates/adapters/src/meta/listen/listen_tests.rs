//! The four iListen calls against a fake Meta API answering with the spike's recorded responses
//! (the Mandarin/Japanese meeting): the exact bodies sent (`store: false`, effort, strict schema
//! names, the turn lines, the draft and notes), the parsed answers, the cost log purposes and
//! invalid answers. The spike's transcript parses into the five turns these calls start from.

use std::path::Path;

use nimbytes_core::domain::listen::{ListenTurn, output_language};
use nimbytes_core::domain::transcript::{chunks, clip_turns};

use super::*;
use crate::meta::fake_api::{Seen, client, fake_api};

const UNDERSTAND_PROMPT: &str = include_str!("../../../../../prompts/listen_understand.md");
const UNDERSTAND_SCHEMA: &str =
    include_str!("../../../../../prompts/listen_understand.schema.json");
const MERGE_PROMPT: &str = include_str!("../../../../../prompts/listen_merge.md");
const MERGE_SCHEMA: &str = include_str!("../../../../../prompts/listen_merge.schema.json");
const CHECK_PROMPT: &str = include_str!("../../../../../prompts/listen_check.md");
const CHECK_SCHEMA: &str = include_str!("../../../../../prompts/listen_check.schema.json");
const FIX_PROMPT: &str = include_str!("../../../../../prompts/listen_fix.md");
const FIX_SCHEMA: &str = include_str!("../../../../../prompts/listen_fix.schema.json");

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/listen")
        .join(name);
    std::fs::read_to_string(path).unwrap()
}

fn answer(text: &str) -> String {
    json!({"output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
           "usage": {"input_tokens": 1300, "output_tokens": 400}})
    .to_string()
}

async fn interpreter(base: String) -> (SparkListenInterpreter, sqlx::SqlitePool) {
    let (c, pool) = client(base).await;
    let pair = |md: &str, name: &str, schema: &str| {
        (
            Template::parse(md).unwrap(),
            StrictSchema::parse(name, schema).unwrap(),
        )
    };
    let prompts = ListenPrompts {
        understand: pair(UNDERSTAND_PROMPT, "listen_understand", UNDERSTAND_SCHEMA),
        merge: pair(MERGE_PROMPT, "listen_merge", MERGE_SCHEMA),
        check: pair(CHECK_PROMPT, "listen_check", CHECK_SCHEMA),
        fix: pair(FIX_PROMPT, "listen_fix", FIX_SCHEMA),
    };
    (
        SparkListenInterpreter::new(c, prompts, Duration::from_secs(10)),
        pool,
    )
}

async fn purposes(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT purpose FROM model_calls ORDER BY rowid")
        .fetch_all(pool)
        .await
        .unwrap()
}

fn first_body(seen: &std::sync::Mutex<Vec<Seen>>) -> (String, Value) {
    let seen = seen.lock().unwrap();
    (
        seen[0].path.clone(),
        serde_json::from_slice(&seen[0].body).unwrap(),
    )
}

/// The spike transcript as listen lines, through the real transcribe parser.
fn mix_turns() -> Vec<ListenTurn> {
    let v: Value = serde_json::from_str(&fixture("mix.transcribe.json")).unwrap();
    let raw = crate::meta::transcribe::turns(&v).unwrap();
    let turns = clip_turns(&chunks(26.16), &[raw]);
    turns
        .iter()
        .map(|t| {
            let ms = |s: f64| (s * 1000.0).round() as u64;
            let span = (ms(t.span.start_s), ms(t.span.end_s));
            ListenTurn::heard(t.turn_no, span, t.speaker_label.clone(), &t.text)
        })
        .collect()
}

fn assert_common(body: &Value, name: &str, effort: &str) {
    assert_eq!(
        (&body["model"], &body["store"]),
        (&json!("muse-spark-1.3"), &json!(false))
    );
    assert_eq!(body["reasoning"]["effort"], effort);
    assert_eq!(body["text"]["format"]["name"], name);
    assert_eq!(body["text"]["format"]["strict"], true);
    let user = body["input"][1]["content"].as_array().unwrap();
    assert_eq!(user.len(), 1, "text only");
}

fn user_text(body: &Value) -> String {
    body["input"][1]["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn the_spike_transcript_gives_five_turns_of_two_speakers() {
    let turns = mix_turns();
    assert_eq!(turns.len(), 5);
    assert_eq!((turns[1].start_ms, turns[1].end_ms), (5_340, 10_620));
    assert_eq!(turns[1].speaker.as_deref(), Some("B"));
    assert!(turns[1].text.contains("午前十時"));
}

#[tokio::test]
async fn understand_sends_the_target_and_numbered_turns_and_reads_every_line() {
    let ok = answer(&fixture("mix.understand.json"));
    let (base, seen) = fake_api(vec![(200, ok.as_str())]).await;
    let (s, pool) = interpreter(base).await;
    let turns = mix_turns();
    let request = UnderstandRequest {
        target: output_language("en").unwrap(),
        turns: &turns,
    };

    let d = s.understand(request).await.unwrap();

    assert_eq!(d.title, "Confirmation for Tomorrow's 10 AM Meeting");
    let langs: Vec<&str> = d.turns.iter().map(|t| t.lang.as_str()).collect();
    assert_eq!(langs, ["zh", "ja", "zh", "ja", "zh"]);
    assert!(d.turns[1].translation.contains("10 AM"));
    assert_eq!(d.key_points.len(), 5);
    let (path, body) = first_body(&seen);
    assert_eq!(path, "/v1/responses");
    assert_common(&body, "listen_understand", "low");
    let system = body["input"][0]["content"][0]["text"].as_str().unwrap();
    assert!(system.starts_with("You read speech transcripts made by a speech recogniser."));
    let user = user_text(&body);
    assert!(
        user.starts_with("Output language: English\n\nTurns:\n0 [A] 我们明天的会议几点开始？"),
        "{user}"
    );
    assert!(
        user.contains("\n1 [B] 明日の会議は午前十時からです。"),
        "{user}"
    );
    assert_eq!(user.lines().count(), 3 + 5);
    assert_eq!(purposes(&pool).await, ["listen_understand"]);
}

#[tokio::test]
async fn the_check_is_medium_effort_and_reads_the_planted_errors_back() {
    let bad = answer(&fixture("check-bad.json"));
    let (base, seen) = fake_api(vec![(200, bad.as_str())]).await;
    let (s, pool) = interpreter(base).await;
    let turns = mix_turns();
    let mut draft = draft_from(&serde_json::from_str(&fixture("mix.understand.json")).unwrap());
    draft.turns[1].translation = "Tomorrow's meeting is from 11 AM.".into();
    let request = CheckRequest {
        part: "the whole recording",
        turns: &turns,
        draft: &draft,
    };

    let a = s.check(request).await.unwrap();

    assert_eq!(a.turns.len(), 5);
    assert_eq!((a.turns[1].index, a.turns[1].score), (1, 30));
    assert!(a.turns[1].issue.contains("11 AM instead of 10 AM"));
    assert!(a.turns[1].back_translation.contains("午前11時"));
    assert_eq!(a.summary_score, 75);
    assert_eq!(a.summary_issues.len(), 1);
    let (_, body) = first_body(&seen);
    assert_common(&body, "listen_check", "medium");
    let user = user_text(&body);
    assert!(user.starts_with("These turns are the whole recording.\n\nORIGINAL TURNS:\n0 [A] "));
    let sent: Value = serde_json::from_str(user.split("DRAFT:\n").nth(1).unwrap()).unwrap();
    assert_eq!(sent["turns"][1]["lang"], "ja");
    assert_eq!(
        sent["turns"][1]["translation"],
        "Tomorrow's meeting is from 11 AM."
    );
    assert_eq!(sent["key_points"].as_array().unwrap().len(), 5);
    assert!(
        sent.get("title").is_none(),
        "the checker judges lines and summary only"
    );
    assert_eq!(purposes(&pool).await, ["listen_check"]);
}

#[tokio::test]
async fn a_clean_check_passes_every_line() {
    let good = answer(&fixture("check-good.json"));
    let (base, _seen) = fake_api(vec![(200, good.as_str())]).await;
    let (s, _pool) = interpreter(base).await;
    let turns = mix_turns();
    let draft = draft_from(&serde_json::from_str(&fixture("mix.understand.json")).unwrap());
    let request = CheckRequest {
        part: "the whole recording",
        turns: &turns,
        draft: &draft,
    };
    let a = s.check(request).await.unwrap();
    assert!(a.turns.iter().all(|t| t.score == 100 && t.issue.is_empty()));
    assert!(a.turns.iter().all(|t| t.heard_as.is_empty()));
    assert_eq!(a.summary_score, 100);
}

#[tokio::test]
async fn the_fix_sends_the_notes_and_the_answer_shape_draft() {
    let fixed = answer(&fixture("mix.fix.json"));
    let (base, seen) = fake_api(vec![(200, fixed.as_str())]).await;
    let (s, pool) = interpreter(base).await;
    let turns = mix_turns();
    let draft = draft_from(&serde_json::from_str(&fixture("mix.understand.json")).unwrap());
    let notes = vec![
        "turn 1: Time mistranslated as 11 AM instead of 10 AM.".to_owned(),
        "Key points list meeting time as 11:00 AM.".to_owned(),
    ];
    let request = FixRequest {
        target: output_language("en").unwrap(),
        turns: &turns,
        draft: &draft,
        notes: &notes,
    };

    let f = s.fix(request).await.unwrap();

    assert_eq!(f.turns.len(), 5);
    assert!(f.turns[1].translation.contains("10 AM"));
    assert_eq!(f.key_points[0], "Meeting tomorrow at 10:00 AM");
    let (_, body) = first_body(&seen);
    assert_common(&body, "listen_fix", "low");
    let user = user_text(&body);
    assert!(user.starts_with("Output language: English\n\nORIGINAL TURNS:\n"));
    assert!(user.ends_with(
        "CHECKER NOTES:\nturn 1: Time mistranslated as 11 AM instead of 10 AM.\nKey points list meeting time as 11:00 AM."
    ));
    let sent: Value = serde_json::from_str(
        user.split("DRAFT:\n")
            .nth(1)
            .unwrap()
            .split("\n\nCHECKER NOTES")
            .next()
            .unwrap(),
    )
    .unwrap();
    assert!(
        sent["turns"][0].get("lang").is_none(),
        "the fixer's own answer shape"
    );
    assert_eq!(purposes(&pool).await, ["listen_fix"]);
}

#[tokio::test]
async fn merge_sends_each_part_in_order_in_the_target_language() {
    let merged = answer(r#"{"title":"会议","summary":"十点开会。","key_points":["十点"]}"#);
    let (base, seen) = fake_api(vec![(200, merged.as_str())]).await;
    let (s, pool) = interpreter(base).await;
    let parts = [
        Overview {
            title: "One".into(),
            summary: "First half.".into(),
            key_points: vec!["a".into()],
        },
        Overview {
            title: "Two".into(),
            summary: "Second half.".into(),
            key_points: Vec::new(),
        },
    ];
    let request = MergeRequest {
        target: output_language("zh").unwrap(),
        parts: &parts,
    };

    let o = s.merge(request).await.unwrap();

    assert_eq!((o.title.as_str(), o.key_points.len()), ("会议", 1));
    let (_, body) = first_body(&seen);
    assert_common(&body, "listen_merge", "low");
    assert_eq!(
        user_text(&body),
        "Output language: 中文\n\nParts:\nPart 1: One\nFirst half.\n- a\n\nPart 2: Two\nSecond half.\n"
    );
    assert_eq!(purposes(&pool).await, ["listen_merge"]);
}

#[tokio::test]
async fn an_answer_off_the_schema_or_an_empty_fix_is_model_unavailable() {
    let off = answer(r#"{"title":"x","turns":[],"summary":"s"}"#);
    let empty = answer(r#"{"turns":[],"summary":"  ","key_points":[]}"#);
    let (base, _seen) = fake_api(vec![(200, off.as_str()), (200, empty.as_str())]).await;
    let (s, _pool) = interpreter(base).await;
    let turns = mix_turns();
    let target = output_language("en").unwrap();

    let err = s
        .understand(UnderstandRequest {
            target,
            turns: &turns,
        })
        .await
        .unwrap_err();
    assert_eq!(
        err.code,
        ErrorCode::ModelUnavailable,
        "key_points is required"
    );

    let draft = Draft::default();
    let request = FixRequest {
        target,
        turns: &turns,
        draft: &draft,
        notes: &[],
    };
    let err = s.fix(request).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ModelUnavailable);
}

#[tokio::test]
async fn a_slip_comes_back_in_heard_as_apart_from_the_issue() {
    let slip = answer(
        r#"{"turns":[{"index":1,"back_translation":"x","heard_as":"'肃朽' heard as '速朽'","score":95,"issue":""}],"summary_score":92,"summary_issues":[]}"#,
    );
    let (base, _seen) = fake_api(vec![(200, slip.as_str())]).await;
    let (s, _pool) = interpreter(base).await;
    let turns = mix_turns();
    let draft = draft_from(&serde_json::from_str(&fixture("mix.understand.json")).unwrap());
    let request = CheckRequest {
        part: "the whole recording",
        turns: &turns,
        draft: &draft,
    };
    let a = s.check(request).await.unwrap();
    assert_eq!(a.turns[0].heard_as, "'肃朽' heard as '速朽'");
    assert_eq!((a.turns[0].score, a.turns[0].issue.as_str()), (95, ""));
}
