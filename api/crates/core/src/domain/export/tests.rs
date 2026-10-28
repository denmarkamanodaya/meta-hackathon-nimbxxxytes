use super::*;
use crate::domain::cover::next_covers;

fn tags(raw: &[&str]) -> Vec<String> {
    raw.iter().map(|t| (*t).to_owned()).collect()
}

#[test]
fn an_export_uses_the_best_version_else_the_latest() {
    assert_eq!(export_version(Some(2), &[1, 2, 3]), Some(2));
    assert_eq!(export_version(None, &[1, 3, 2]), Some(3));
    assert_eq!(
        export_version(Some(9), &[1, 2]),
        Some(2),
        "a best that no longer exists"
    );
    assert_eq!(export_version(None, &[]), None);
}

#[test]
fn covers_anchor_on_the_strongest_hook_first_on_a_tie() {
    let shots = [("a", Some(4)), ("b", Some(8)), ("c", Some(8)), ("d", None)];
    let refs: Vec<&(&str, Option<u8>)> = shots.iter().collect();
    assert_eq!(hook_segment(&refs, |s| s.1).unwrap().0, "b");
    let unscored = [("x", None), ("y", None)];
    let refs: Vec<&(&str, Option<u8>)> = unscored.iter().collect();
    assert_eq!(hook_segment(&refs, |s| s.1).unwrap().0, "x");
    assert!(hook_segment::<(&str, Option<u8>)>(&[], |s| s.1).is_none());
}

#[test]
fn exports_have_their_own_aspects_and_sizes() {
    assert_eq!(ExportAspect::Vertical.size(), (1080, 1920));
    assert_eq!(ExportAspect::Portrait.size(), (1080, 1350));
    assert_eq!(ExportAspect::Square.size(), (1080, 1080));
    assert_eq!(ExportAspect::Vertical.image_size(), "1080x1920");
    assert_eq!(ExportAspect::parse("9:16").unwrap(), ExportAspect::Vertical);
    assert_eq!(
        serde_json::to_string(&ExportAspect::Vertical).unwrap(),
        "\"9:16\""
    );
    assert!(
        serde_json::from_str::<Aspect>("\"9:16\"").is_err(),
        "a short's own aspect never takes 9:16"
    );
}

#[test]
fn vertical_platforms_share_one_9_16_render_and_the_feed_keeps_the_shorts_frame() {
    for p in [Platform::Tiktok, Platform::Reels, Platform::Shorts] {
        assert_eq!(export_aspect(p, Aspect::Square), ExportAspect::Vertical);
    }
    assert_eq!(
        export_aspect(Platform::Feed, Aspect::Square),
        ExportAspect::Square
    );
    assert_eq!(
        export_aspect(Platform::Feed, Aspect::Portrait),
        ExportAspect::Portrait
    );
    let all = [
        Platform::Tiktok,
        Platform::Reels,
        Platform::Shorts,
        Platform::Feed,
    ];
    assert_eq!(
        render_plan(&all),
        RenderPlan {
            vertical: true,
            feed: true
        }
    );
    assert_eq!(
        render_plan(&[Platform::Feed]),
        RenderPlan {
            vertical: false,
            feed: true
        }
    );
    assert_eq!(
        render_plan(&[Platform::Reels]),
        RenderPlan {
            vertical: true,
            feed: false
        }
    );
}

#[test]
fn platforms_are_kept_once_each_and_at_least_one() {
    let got = checked_platforms(&[Platform::Reels, Platform::Feed, Platform::Reels]).unwrap();
    assert_eq!(got, [Platform::Reels, Platform::Feed]);
    assert!(checked_platforms(&[]).is_err());
}

#[test]
fn captions_fit_each_platforms_limit_at_a_word() {
    assert_eq!(caption_limit(Platform::Shorts), 100);
    assert_eq!(caption_limit(Platform::Tiktok), 2200);
    assert_eq!(caption_limit(Platform::Reels), 2200);
    assert_eq!(fit_caption("  short enough  ", 100), "short enough");
    let long = "word ".repeat(30);
    let fitted = fit_caption(&long, 100);
    assert!(fitted.chars().count() <= 100, "{}", fitted.chars().count());
    assert!(fitted.ends_with("word…"), "{fitted}");
    assert_eq!(
        fit_caption(&"x".repeat(150), 100).chars().count(),
        100,
        "no space: cut mid-word"
    );
}

#[test]
fn hashtags_are_cleaned_deduplicated_and_capped_at_eight() {
    let got = clean_hashtags(&tags(&[
        "#Travel",
        "travel",
        " #pov ",
        "#day-in life",
        "#",
        "#🙂",
        "#a",
        "#b",
        "#c",
        "#d",
        "#e",
        "#f",
    ]));
    assert_eq!(
        got,
        [
            "#Travel",
            "#pov",
            "#dayinlife",
            "#a",
            "#b",
            "#c",
            "#d",
            "#e"
        ]
    );
    assert_eq!(clean_hashtags(&tags(&["#café"])), ["#café"]);
}

#[test]
fn covers_come_three_at_a_time_up_to_nine() {
    assert_eq!(next_covers(0).unwrap(), 0..3);
    assert_eq!(next_covers(3).unwrap(), 3..6);
    assert_eq!(next_covers(7).unwrap(), 7..9);
    assert_eq!(
        next_covers(9).unwrap_err().code,
        ErrorCode::ValidationFailed
    );
}

#[test]
fn a_feed_export_is_ready_once_the_short_has_its_render() {
    let key = ObjectKey::from_stored("users/u1/renders/x1.mp4".into());
    assert_eq!(
        feed_render(ExportStatus::Rendering, Some(&key), false),
        (ExportStatus::Ready, Some(key.clone()))
    );
    assert_eq!(
        feed_render(ExportStatus::Rendering, Some(&key), true),
        (ExportStatus::Ready, Some(key.clone())),
        "a render that exists wins over an older failed job"
    );
    assert_eq!(
        feed_render(ExportStatus::Rendering, None, false),
        (ExportStatus::Rendering, None)
    );
    assert_eq!(
        feed_render(ExportStatus::Rendering, None, true),
        (ExportStatus::Failed, None),
        "a final render that gave up fails the feed instead of rendering forever"
    );
    assert_eq!(
        feed_render(ExportStatus::Ready, None, false),
        (ExportStatus::Rendering, None),
        "a new render of the short replaces the old one"
    );
    assert_eq!(ExportStatus::parse("failed").unwrap(), ExportStatus::Failed);
}
