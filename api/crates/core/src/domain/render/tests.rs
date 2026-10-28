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
    let mut fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    // The centred props: the fixture's camera (the reframed 9:16 sample) is checked below.
    for clip in fixture["clips"].as_array_mut().into_iter().flatten() {
        if let Some(c) = clip.as_object_mut() {
            c.remove("crop_path");
            c.remove("source_aspect");
        }
    }
    assert_eq!(built, fixture);
}

/// A cut-out cover still as the renderer reads it: the subject layer after the theme, the blur
/// flag (only for the blurred frame) before it.
// Embedded until the renderer's `cover_still.sample.json` carries a cut-out.
const CUTOUT_STILL: &str = r##"{"image_url":"https://example.com/scene.webp","width":1080,"height":1920,"title":{"text":"Nap champion","position":"bottom"},"theme":{"accent":"#1ed2dc","font":"Geist"},"cutout":{"image_url":"https://example.com/frame.jpg","frame":{"w":720,"h":1280},"path":"M10 20L300 20L300 900Z","box":{"x1":10,"y1":20,"x2":300,"y2":900}}}"##;

#[test]
fn a_cut_out_cover_still_serialises_the_subject_layer_and_the_blur_flag() {
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
    let mut props = cover_still_props(
        "https://example.com/scene.webp".into(),
        ExportAspect::Vertical,
        &title,
        theme,
    );
    props.cutout = Some(CutoutLayer {
        image_url: "https://example.com/frame.jpg".into(),
        frame: FrameSize { w: 720, h: 1280 },
        path: "M10 20L300 20L300 900Z".into(),
        bbox: BoxRect {
            x1: 10,
            y1: 20,
            x2: 300,
            y2: 900,
        },
    });
    assert_eq!(serde_json::to_string(&props).unwrap(), CUTOUT_STILL);
    let back: CoverStillProps = serde_json::from_str(CUTOUT_STILL).unwrap();
    assert_eq!(back, props);

    props.background_blur = Some(true);
    let blurred = serde_json::to_string(&props).unwrap();
    assert!(
        blurred.contains(r#""font":"Geist"},"background_blur":true,"cutout":{"#),
        "{blurred}"
    );
}

/// `seg_crossing` of the renderer's sample as the reframed 9:16 props carry it: the camera sits
/// between `subject` and `captions`, in clip seconds, with the 3:4 source's width / height.
const CROSSING_CAMERA: &str = r#""subject":"the crossing","crop_path":[{"t_s":46.0,"cx":0.42,"cy":0.5},{"t_s":47.5,"cx":0.55,"cy":0.48},{"t_s":49.5,"cx":0.6,"cy":0.48}],"source_aspect":0.75,"captions":"#;

fn crossing_row() -> crate::domain::reframe::ShotReframe {
    use crate::domain::reframe::{CropKey, ShotReframe};
    let key = |t_s, cx, cy| CropKey { t_s, cx, cy };
    ShotReframe {
        short_id: ShortId::parse("x").unwrap(),
        version_n: 1,
        segment_id: SegmentId::parse("seg_crossing").unwrap(),
        subject: "the crossing".into(),
        crop_path: vec![
            key(46.0, 0.42, 0.5),
            key(47.5, 0.55, 0.48),
            key(49.5, 0.6, 0.48),
        ],
        frames_tracked: 42,
        frames_total: 42,
        lost_s: 0.0,
        updated_at: "t".into(),
    }
}

#[test]
fn a_reframed_shot_carries_its_camera_and_source_aspect_next_to_its_subject() {
    use crate::domain::reframe::shot_cameras;
    let (timeline, media) = sample();
    let rows = [crossing_row()];
    let cameras = shot_cameras(&rows, 1, &timeline.clips, |_| Some(0.75));
    let built = with_cameras(props(&timeline, media).unwrap(), cameras);

    let json = serde_json::to_string(&built).unwrap();
    assert!(json.contains(CROSSING_CAMERA), "{json}");
    assert_eq!(
        json.matches("crop_path").count(),
        1,
        "other shots stay centred"
    );

    // The renderer's sample carries the same camera on seg_crossing, so the two cannot drift.
    let expected: Value = serde_json::from_str(FIXTURE).unwrap();
    assert_eq!(serde_json::to_value(&built).unwrap(), expected);
}

#[test]
fn a_camera_needs_its_subjects_row_and_the_source_size() {
    use crate::domain::reframe::shot_cameras;
    let (timeline, _) = sample();
    let rows = [crossing_row()];
    let none = shot_cameras(&rows, 1, &timeline.clips, |_| None);
    assert!(
        none.iter().all(Option::is_none),
        "no source size, no camera"
    );
    let mut other = crossing_row();
    other.subject = "a bus".into();
    let changed = shot_cameras(&[other], 1, &timeline.clips, |_| Some(0.75));
    assert!(changed.iter().all(Option::is_none), "a changed subject");
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
// The renderer validates the same file with its Zod schema, so the two sides cannot drift.
const COVER_STILL_SAMPLE: &str =
    include_str!("../../../../../../render/fixtures/cover_still.sample.json");

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

    let sample = COVER_STILL_SAMPLE.trim_end();
    let json = serde_json::to_string(&props).unwrap();
    assert_eq!(json, sample);
    let back: CoverStillProps = serde_json::from_str(&json).unwrap();
    assert_eq!(serde_json::to_string(&back).unwrap(), sample);
    assert_eq!(back, props);
}

const CUTOUT_SAMPLE: &str =
    include_str!("../../../../../../render/fixtures/cover_still_cutout.sample.json");

#[test]
fn the_cut_out_cover_still_matches_the_renderers_sample_byte_for_byte() {
    use crate::domain::cover::{CoverTitle, TitlePosition};
    let sample: Value = serde_json::from_str(CUTOUT_SAMPLE).unwrap();
    let cut = &sample["cutout"];
    let title = CoverTitle {
        text: "Nap champion".into(),
        show: true,
        position: TitlePosition::Top,
    };
    let theme = Theme {
        accent: "#1ed2dc".into(),
        font: "Geist".into(),
    };
    let frame_url = "https://example.com/frames/clip_dog_3.jpg";
    let mut props = cover_still_props(frame_url.into(), ExportAspect::Vertical, &title, theme);
    props.background_blur = Some(true);
    props.cutout = Some(CutoutLayer {
        image_url: frame_url.into(),
        frame: FrameSize { w: 240, h: 426 },
        path: cut["path"].as_str().unwrap().into(),
        bbox: BoxRect {
            x1: 16,
            y1: 149,
            x2: 239,
            y2: 425,
        },
    });
    assert_eq!(
        serde_json::to_string(&props).unwrap(),
        CUTOUT_SAMPLE.trim_end()
    );
}

/// The renderer validates `render/fixtures/step_still.sample.json` with its Zod schema; the Rust
/// props must serialise to the same bytes.
const STEP_STILL_SAMPLE: &str =
    include_str!("../../../../../../render/fixtures/step_still.sample.json");

#[test]
fn the_step_still_props_match_the_renderers_sample_byte_for_byte() {
    let props = StepStillProps {
        image_url: "https://example.com/step_1_frame.jpg".into(),
        width: 720,
        height: 1280,
        outline: "M300 400L360 400L360 460L300 460Z".into(),
    };

    assert_eq!(serde_json::to_string(&props).unwrap(), STEP_STILL_SAMPLE);
}
