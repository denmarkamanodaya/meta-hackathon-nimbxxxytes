use super::*;

fn seg(id: &str) -> SegmentId {
    SegmentId::parse(id).unwrap()
}

fn bounds() -> Vec<Bounds> {
    vec![
        Bounds {
            segment_id: seg("s1"),
            span: Span {
                start_s: 0.0,
                end_s: 8.0,
            },
        },
        Bounds {
            segment_id: seg("s2"),
            span: Span {
                start_s: 10.0,
                end_s: 18.0,
            },
        },
    ]
}

fn shot(id: &str, in_s: f64, out_s: f64) -> TimelineClip {
    TimelineClip {
        segment_id: seg(id),
        in_s,
        out_s,
        subject: None,
        punch_in: 1.0,
        reason: "r".into(),
    }
}

fn timeline(target: f64, clips: Vec<TimelineClip>) -> Timeline {
    Timeline {
        aspect: Aspect::Portrait,
        target_seconds: target,
        clips,
        captions: CaptionPlan {
            style: CaptionStyle::Phrase,
            source: CaptionSource::Transcript,
        },
        post: Post {
            caption: "c".into(),
            hashtags: vec![],
        },
        rationale: "why".into(),
        revision: None,
    }
}

fn spans(t: &Timeline) -> Vec<(f64, f64)> {
    t.clips.iter().map(|c| (c.in_s, c.out_s)).collect()
}

#[test]
fn shots_inside_their_segments_and_on_target_are_unchanged() {
    let t = timeline(6.0, vec![shot("s1", 1.0, 4.0), shot("s2", 11.0, 14.0)]);
    let (out, clamps) = fit(t.clone(), &bounds()).unwrap();
    assert_eq!(out, t);
    assert!(clamps.is_empty());
}

#[test]
fn in_and_out_are_clamped_to_the_segment_and_each_clamp_is_reported() {
    let mut first = shot("s2", 8.5, 12.0);
    first.subject = Some("the crossing".into());
    let t = timeline(6.0, vec![first, shot("s1", 5.0, 9.25)]);
    let (out, clamps) = fit(t, &bounds()).unwrap();
    assert_eq!(spans(&out), [(10.0, 12.0), (5.0, 8.0)]);
    let notes: Vec<&str> = clamps.iter().map(|c| c.note.as_str()).collect();
    assert_eq!(
        notes,
        [
            "the crossing: in 8.50 → 10.00 s (segment 10.00–18.00 s)",
            "Shot 2: out 9.25 → 8.00 s (segment 0.00–8.00 s)",
        ]
    );
    assert_eq!(clamps[1].shot, Some(1));
}

#[test]
fn shots_under_the_minimum_are_dropped_and_reported() {
    let t = timeline(4.0, vec![shot("s1", 7.7, 9.0), shot("s2", 10.0, 14.0)]);
    let (out, clamps) = fit(t, &bounds()).unwrap();
    assert_eq!(spans(&out), [(10.0, 14.0)]);
    assert!(
        clamps
            .iter()
            .any(|c| c.shot == Some(0) && c.note.contains("dropped"))
    );
}

#[test]
fn a_cut_that_is_too_long_is_trimmed_proportionally_to_the_upper_tolerance() {
    let t = timeline(5.0, vec![shot("s1", 0.0, 6.0), shot("s2", 10.0, 16.0)]);
    let (out, clamps) = fit(t, &bounds()).unwrap();
    assert_eq!(spans(&out), [(0.0, 3.0), (10.0, 13.0)]);
    assert!((out.length_s() - 6.0).abs() < 1e-9, "5 s + 20 %");
    assert_eq!(
        clamps.last().unwrap().note,
        "length 12.0 → 6.0 s to fit the 5 s target"
    );
}

#[test]
fn a_cut_that_is_too_short_grows_inside_its_segments() {
    let t = timeline(15.0, vec![shot("s1", 2.0, 4.0), shot("s2", 12.0, 14.0)]);
    let (out, _) = fit(t, &bounds()).unwrap();
    assert!((out.length_s() - 12.0).abs() < 1e-9, "15 s − 20 %");
    assert_eq!(spans(&out), [(2.0, 8.0), (12.0, 18.0)]);
}

#[test]
fn zoom_is_kept_between_one_and_three() {
    let mut a = shot("s1", 0.0, 3.0);
    a.punch_in = 4.0;
    let mut b = shot("s2", 10.0, 13.0);
    b.punch_in = 0.5;
    let (out, clamps) = fit(timeline(6.0, vec![a, b]), &bounds()).unwrap();
    assert_eq!(out.clips[0].punch_in, 3.0);
    assert_eq!(out.clips[1].punch_in, 1.0);
    assert_eq!(clamps.len(), 2);
}

#[test]
fn unknown_segments_and_bad_shapes_are_refused() {
    let unknown = timeline(6.0, vec![shot("s9", 0.0, 3.0)]);
    let err = fit(unknown, &bounds()).unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
    assert!(err.message.contains("s9"));
    for t in [
        timeline(6.0, vec![]),
        timeline(2.0, vec![shot("s1", 0.0, 3.0)]),
        timeline(6.0, vec![shot("s1", f64::NAN, 3.0)]),
        timeline(6.0, vec![shot("s1", 7.9, 8.0)]),
        timeline(6.0, vec![shot("s1", 0.0, 1.0); 21]),
    ] {
        assert_eq!(
            fit(t, &bounds()).unwrap_err().code,
            ErrorCode::ValidationFailed
        );
    }
}

#[test]
fn the_wire_shape_uses_in_and_out_and_defaults_zoom_subject_and_revision() {
    let raw = r##"{"aspect":"1:1","target_seconds":10,"clips":[{"segment_id":"s1","in":1,"out":3}],
        "captions":{"style":"none","source":"transcript"},"post":{"caption":"x","hashtags":["#a"]},
        "rationale":"r"}"##;
    let t: Timeline = serde_json::from_str(raw).unwrap();
    assert_eq!(t.aspect, Aspect::Square);
    assert_eq!(
        (t.clips[0].punch_in, t.clips[0].subject.as_deref()),
        (1.0, None)
    );
    assert_eq!(t.revision, None);
    let back = serde_json::to_value(&t).unwrap();
    assert_eq!(back["clips"][0]["in"], 1.0);
    assert_eq!(back["revision"], serde_json::Value::Null);
    assert_eq!(back["captions"]["style"], "none");
}

#[test]
fn a_model_rounding_the_segment_end_is_fixed_without_a_note() {
    let ends_at = vec![Bounds {
        segment_id: seg("s1"),
        span: Span {
            start_s: 7.0,
            end_s: 12.399_166_5,
        },
    }];
    let t = timeline(5.4, vec![shot("s1", 7.0, 12.4)]);
    let (out, clamps) = fit(t, &ends_at).unwrap();
    assert_eq!(out.clips[0].out_s, 12.399_166_5);
    assert!(clamps.is_empty(), "{clamps:?}");
}
