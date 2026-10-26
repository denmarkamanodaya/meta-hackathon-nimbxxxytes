use super::*;
use crate::domain::ids::SegmentId;
use crate::domain::timeline::{
    Aspect, CaptionPlan, CaptionSource, CaptionStyle, Post, Revision, RevisionAction,
    RevisionChange, TimelineClip,
};

fn critique(notes: usize, verdict: Verdict) -> Critique {
    Critique {
        version: 9,
        scores: Scores {
            hook: 6,
            pacing: 5,
            continuity: 7,
            captions: 8,
            length: 9,
        },
        total: 99,
        notes: (0..notes)
            .map(|i| CritiqueNote {
                at: 2.4 + f64::from(u32::try_from(i).unwrap()),
                issue: format!("issue {i}"),
                fix: format!("fix {i}"),
            })
            .collect(),
        verdict,
    }
}

fn change(note_index: Option<u32>) -> RevisionChange {
    RevisionChange {
        action: RevisionAction::Trim,
        detail: "the latte pour now ends at 0:04.5".into(),
        why: "the hook held too long".into(),
        note_index,
    }
}

fn timeline(revision: Option<Revision>) -> Timeline {
    Timeline {
        aspect: Aspect::Portrait,
        target_seconds: 6.0,
        clips: vec![TimelineClip {
            segment_id: SegmentId::parse("s0").unwrap(),
            in_s: 1.0,
            out_s: 4.0,
            subject: None,
            punch_in: 1.0,
            reason: "r".into(),
        }],
        captions: CaptionPlan {
            style: CaptionStyle::Phrase,
            source: CaptionSource::Transcript,
        },
        post: Post {
            caption: "c".into(),
            hashtags: vec![],
        },
        rationale: "why".into(),
        revision,
    }
}

fn revision(from_version: u32, changes: Vec<RevisionChange>) -> Option<Revision> {
    Some(Revision {
        from_version,
        changes,
    })
}

#[test]
fn a_settled_critique_takes_its_version_and_the_true_score_sum() {
    let c = critique(1, Verdict::Revise).settled(2);
    assert_eq!((c.version, c.total), (2, 35));
}

#[test]
fn the_wire_shape_matches_the_schema_and_bad_verdicts_are_rejected() {
    let raw = r#"{"version":1,"scores":{"hook":6,"pacing":5,"continuity":7,"captions":8,"length":9},
        "total":35,"notes":[{"at":2.4,"issue":"x","fix":"y"}],"verdict":"revise"}"#;
    let c: Critique = serde_json::from_str(raw).unwrap();
    assert_eq!((c.verdict, c.notes.len()), (Verdict::Revise, 1));
    assert!(serde_json::from_str::<Critique>(&raw.replace("\"revise\"", "\"maybe\"")).is_err());
}

#[test]
fn a_revision_citing_notes_of_the_previous_critique_passes() {
    let t = timeline(revision(1, vec![change(Some(0)), change(Some(1))]));
    assert!(check_revision(&t, 2, &critique(2, Verdict::Revise)).is_ok());
}

#[test]
fn a_revision_without_a_revision_block_wrong_version_no_changes_or_bad_notes_is_rejected() {
    let c = critique(2, Verdict::Revise);
    let cases = [
        (timeline(None), "must say what it revised"),
        (
            timeline(revision(3, vec![change(Some(0))])),
            "must revise version 1",
        ),
        (timeline(revision(1, vec![])), "lists no changes"),
        (
            timeline(revision(1, vec![change(Some(2))])),
            "cites note 2, but the critique has 2",
        ),
        (
            timeline(revision(1, vec![change(None)])),
            "cites no critique note",
        ),
    ];
    for (t, want) in cases {
        let err = check_revision(&t, 2, &c).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed);
        assert!(err.message.contains(want), "{} / {want}", err.message);
    }
}

#[test]
fn previous_text_numbers_the_notes_the_revision_must_cite() {
    let c = critique(2, Verdict::Revise).settled(1);
    let text = previous_text("{\"clips\":[]}", &c);
    assert_eq!(
        text,
        "Version 1 timeline:\n{\"clips\":[]}\nCritique (total 35/50, verdict revise):\n\
         note 0 at 2.4 s: issue 0 Fix: fix 0\nnote 1 at 3.4 s: issue 1 Fix: fix 1"
    );
}
