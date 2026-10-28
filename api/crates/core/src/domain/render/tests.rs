use serde_json::Value;

use super::*;
use crate::domain::captions::CaptionWord;
use crate::domain::timeline::{CaptionPlan, CaptionSource, TimelineClip};

/// The fixture the renderer's Zod schema and the browser Player are tested against.
const FIXTURE: &str = include_str!("../../../../../../render/fixtures/props.sample.json");
/// The web design tokens; the video accent must be `--video-accent` there.
const TOKENS: &str = include_str!("../../../../../../web/src/design/tokens.css");

const PROXY: &str = "https://media.example/users/u_demo/proxies/";

fn shot(id: &str, (in_s, out_s): (f64, f64), punch_in: f64, subject: Option<&str>) -> TimelineClip {
    TimelineClip {
        segment_id: SegmentId::parse(id).unwrap(),
        in_s,
        out_s,
        subject: subject.map(str::to_owned),
        punch_in,
        reason: "because".into(),
    }
}

fn phrase(start_s: f64, end_s: f64, words: &[(&str, f64)]) -> Caption {
    Caption {
        start_s,
        end_s,
        text: words.iter().map(|(w, _)| *w).collect::<Vec<_>>().join(" "),
        words: words
            .iter()
            .map(|(w, at)| CaptionWord {
                text: (*w).to_owned(),
                at_s: *at,
            })
            .collect(),
    }
}

fn media(file: &str, captions: Vec<Caption>) -> ShotMedia {
    ShotMedia {
        src_url: Some(format!("{PROXY}{file}?X-Amz-Signature=test")),
        captions,
    }
}

fn sample() -> (Timeline, Vec<ShotMedia>) {
    let timeline = Timeline {
        aspect: Aspect::Portrait,
        target_seconds: 14.0,
        clips: vec![
            shot("seg_coffee", (3.0, 6.5), 1.0, Some("the latte pour")),
            shot("seg_street", (31.0, 35.0), 1.0, None),
            shot("seg_crossing", (46.0, 49.5), 1.15, Some("the crossing")),
            shot("seg_desk", (61.0, 63.5), 1.0, Some("laptop opening")),
        ],
        captions: CaptionPlan {
            style: CaptionStyle::Phrase,
            source: CaptionSource::Transcript,
        },
        post: Post {
            caption: "Slow mornings".into(),
            hashtags: vec!["#pov".into(), "#morning".into()],
        },
        rationale: "Open on the pour.".into(),
        revision: None,
    };
    (timeline, sample_media())
}

fn sample_media() -> Vec<ShotMedia> {
    let coffee = vec![
        phrase(
            1.2,
            3.0,
            &[
                ("Okay,", 1.2),
                ("latte", 1.6),
                ("art", 2.1),
                ("attempt", 2.4),
            ],
        ),
        phrase(
            3.4,
            5.1,
            &[
                ("that", 3.4),
                ("one", 3.7),
                ("looks", 4.0),
                ("like", 4.4),
                ("a heart", 4.6),
            ],
        ),
    ];
    let crossing = vec![phrase(
        46.4,
        48.2,
        &[
            ("tram's", 46.4),
            ("right", 47.0),
            ("on", 47.4),
            ("time", 47.7),
        ],
    )];
    vec![
        media("clip_kitchen.mp4", coffee),
        media("clip_walk.mp4", vec![]),
        media("clip_walk.mp4", crossing),
        media("clip_office.mp4", vec![]),
    ]
}

#[test]
fn props_built_from_a_timeline_equal_the_shared_renderer_fixture() {
    let (timeline, media) = sample();
    let built = serde_json::to_value(props(&timeline, media).unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    assert_eq!(built, fixture);
}

#[test]
fn the_video_accent_is_the_video_accent_design_token() {
    let token = TOKENS
        .split("--video-accent:")
        .nth(1)
        .and_then(|rest| rest.split(';').next())
        .map(str::trim)
        .expect("tokens.css defines --video-accent");
    // Hex colour case carries no meaning; the token file writes it in lower case.
    assert!(
        token.eq_ignore_ascii_case(VIDEO_ACCENT),
        "VIDEO_ACCENT {VIDEO_ACCENT} drifted from --video-accent {token} in web/src/design/tokens.css"
    );
}

#[test]
fn style_none_drops_captions_and_no_post_text_drops_the_end_card() {
    let (mut timeline, media) = sample();
    timeline.captions.style = CaptionStyle::None;
    timeline.post.caption = "  ".into();
    let p = props(&timeline, media).unwrap();
    assert!(p.clips.iter().all(|c| c.captions.is_empty()));
    assert_eq!(p.end_card_s, 0.0);
}

#[test]
fn media_must_cover_every_shot() {
    let (timeline, mut media) = sample();
    media.pop();
    assert_eq!(
        props(&timeline, media).unwrap_err().code,
        ErrorCode::Internal
    );
}

#[test]
fn render_subjects_name_one_short_version_and_read_back() {
    let short = ShortId::parse("01abc").unwrap();
    let subject = render_subject(&short, 3);
    assert_eq!(subject, "01abc:v3");
    assert_eq!(parse_render_subject(&subject).unwrap(), (short, 3));
    for bad in ["01abc", "01abc:vx", ":v2"] {
        assert!(parse_render_subject(bad).is_err(), "{bad}");
    }
}

/// The renderer keeps the same JSON as `render/fixtures/cover_still.sample.json`; the two must
/// stay byte for byte equal.
const COVER_STILL_SAMPLE: &str = r##"{"image_url":"https://example.com/cover.webp","width":1080,"height":1920,"title":{"text":"Nap champion","position":"bottom"},"theme":{"accent":"#1ed2dc","font":"Geist"}}"##;

#[test]
fn the_cover_still_props_match_the_renderers_sample_byte_for_byte() {
    use crate::domain::cover::{CoverTitle, TitlePosition};
    let title = CoverTitle {
        text: "Nap champion".into(),
        show: true,
        position: TitlePosition::Bottom,
    };
    let theme = Theme {
        accent: "#1ed2dc".into(),
        font: "Geist".into(),
    };
    let props = cover_still_props(
        "https://example.com/cover.webp".into(),
        ExportAspect::Vertical,
        &title,
        theme,
    );

    let json = serde_json::to_string(&props).unwrap();
    assert_eq!(json, COVER_STILL_SAMPLE);
    let back: CoverStillProps = serde_json::from_str(&json).unwrap();
    assert_eq!(serde_json::to_string(&back).unwrap(), COVER_STILL_SAMPLE);
    assert_eq!(back, props);
}
