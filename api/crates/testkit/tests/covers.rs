//! Cover use cases: styled more covers, redraw with words, the published (titled) cover, the
//! cover title edit and the 9-cover cap, over in-memory fakes.

#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::cover::{CoverInfo, CoverStyle, CoverTitle, TitlePosition};
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::production::Platform;
use nimbytes_core::domain::render::{CoverStillProps, Quality, ShortProps};
use nimbytes_core::ports::{ExportStore, PortResult, RenderOutput, Renderer};
use nimbytes_core::usecases::exports::{
    ExportEdit, RedrawPlan, bake_titled_cover, bakes_due, draw_more_covers, draw_redraw,
    edit_export, list_exports, more_covers, redraw_requested,
};
use nimbytes_core::usecases::shorts::save_timeline;
use nimbytes_testkit::shorts_world::{timeline, user};
use nimbytes_testkit::studio_world::{StudioWorld, export_with_covers};

const REELS: Platform = Platform::Reels;

/// A short of u1 with version 1 over s0 then s1, and a Reels export with `covers` covers.
async fn world(covers: u32) -> (StudioWorld, ShortId) {
    let w = StudioWorld::default();
    let id = w.base.create().await.unwrap();
    let cut = timeline(&[("s0", 1.0, 4.0), ("s1", 11.0, 14.0)]);
    save_timeline(&w.base.deps(), &user("u1"), &id, cut)
        .await
        .unwrap();
    w.exports.put(export_with_covers(&id, REELS, covers));
    (w, id)
}

#[tokio::test]
async fn a_redraw_is_checked_for_owner_words_cover_and_cap() {
    let (w, id) = world(3).await;
    let d = w.export_deps();
    let at = (&id, REELS);

    let plan = redraw_requested(&d, &user("u1"), at, (1, "  golden hour ")).await;
    assert_eq!(
        plan.unwrap(),
        RedrawPlan {
            from: 1,
            n: 3,
            instruction: "golden hour".into()
        }
    );
    let code = |r: Result<RedrawPlan, nimbytes_core::AppError>| r.unwrap_err().code;
    let other = redraw_requested(&d, &user("u2"), at, (1, "golden hour")).await;
    assert_eq!(code(other), ErrorCode::Forbidden);
    let short_words = redraw_requested(&d, &user("u1"), at, (1, "ab")).await;
    assert_eq!(code(short_words), ErrorCode::ValidationFailed);
    let missing = redraw_requested(&d, &user("u1"), at, (3, "golden hour")).await;
    assert_eq!(code(missing), ErrorCode::ValidationFailed);

    w.exports.put(export_with_covers(&id, REELS, 9));
    let full = redraw_requested(&d, &user("u1"), at, (1, "golden hour")).await;
    assert_eq!(code(full), ErrorCode::ValidationFailed, "the 9-cover cap");
}

#[tokio::test]
async fn a_redraw_anchors_on_that_cover_then_the_hook_frame_and_appends_a_redrawn_cover() {
    let (w, id) = world(3).await;
    let plan = RedrawPlan {
        from: 1,
        n: 3,
        instruction: "make it moodier".into(),
    };

    draw_redraw(&w.export_deps(), (&id, REELS), plan)
        .await
        .unwrap();

    let sent = w.images.redraws.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].instruction, "make it moodier");
    let names: Vec<String> = sent[0]
        .anchors
        .iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["redraw_reels_1.webp", "cover_frame.jpg"]);
    let gets = w.base.blobs.gets();
    assert!(gets.contains(&format!("users/u1/exports/{id}/reels_cover_1.webp")));
    assert!(gets.contains(&"users/u1/thumbs/c1/s0.jpg".to_owned()));
    let row = w.exports.row(&id, REELS).unwrap();
    assert_eq!(row.cover_keys.len(), 4);
    assert_eq!(
        row.cover_keys[3].as_str(),
        format!("users/u1/exports/{id}/reels_cover_3.webp")
    );
    assert_eq!(
        row.cover_info[3],
        CoverInfo {
            style: CoverStyle::Redrawn,
            instruction: Some("make it moodier".into()),
            ..CoverInfo::styled(CoverStyle::Redrawn)
        }
    );
    let events = w.progress.events();
    assert_eq!(events.last().unwrap(), &format!("{id} done Done"));
}

#[tokio::test]
async fn a_failed_redraw_adds_nothing_and_fails_the_covers_step() {
    let (w, id) = world(3).await;
    w.images.fail();
    let plan = RedrawPlan {
        from: 0,
        n: 3,
        instruction: "comic style".into(),
    };

    draw_redraw(&w.export_deps(), (&id, REELS), plan)
        .await
        .unwrap();

    assert_eq!(w.exports.row(&id, REELS).unwrap().cover_keys.len(), 3);
    assert_eq!(
        w.progress.events().last().unwrap(),
        &format!("{id} covers Failed")
    );
}

#[tokio::test]
async fn more_covers_in_a_style_draw_that_style_and_unpickable_styles_are_refused() {
    let (w, id) = world(3).await;
    let d = w.export_deps();
    let refused = more_covers(&d, &user("u1"), (&id, REELS), Some(CoverStyle::KeyArt)).await;
    assert_eq!(refused.unwrap_err().code, ErrorCode::ValidationFailed);

    let numbers = more_covers(&d, &user("u1"), (&id, REELS), Some(CoverStyle::Illustrated))
        .await
        .unwrap();
    assert_eq!(numbers, 3..6);
    draw_more_covers(&d, (&id, REELS), numbers, Some(CoverStyle::Illustrated))
        .await
        .unwrap();

    let styles: Vec<CoverStyle> = w
        .images
        .covers
        .lock()
        .unwrap()
        .iter()
        .map(|c| c.style)
        .collect();
    assert_eq!(styles, [CoverStyle::Illustrated; 3]);
    let row = w.exports.row(&id, REELS).unwrap();
    let infos: Vec<CoverStyle> = row.cover_info.iter().map(|i| i.style).collect();
    assert_eq!(
        infos,
        [
            CoverStyle::Bright,
            CoverStyle::CloseDetail,
            CoverStyle::Dramatic,
            CoverStyle::Illustrated,
            CoverStyle::Illustrated,
            CoverStyle::Illustrated
        ],
        "legacy covers keep their looks by number"
    );
}

#[tokio::test]
async fn more_covers_without_a_style_keep_the_three_original_looks() {
    let (w, id) = world(3).await;
    draw_more_covers(&w.export_deps(), (&id, REELS), 3..6, None)
        .await
        .unwrap();
    let styles: Vec<CoverStyle> = w
        .images
        .covers
        .lock()
        .unwrap()
        .iter()
        .map(|c| c.style)
        .collect();
    assert_eq!(
        styles,
        [
            CoverStyle::Bright,
            CoverStyle::CloseDetail,
            CoverStyle::Dramatic
        ]
    );
}

fn title(text: &str, show: bool) -> CoverTitle {
    CoverTitle {
        text: text.into(),
        show,
        position: TitlePosition::Top,
    }
}

#[tokio::test]
async fn the_published_cover_is_baked_with_the_default_title_and_brand_theme() {
    let (w, id) = world(2).await;
    let d = w.export_deps();
    let view = list_exports(&d, &user("u1"), &id).await.unwrap().remove(0);
    assert!(view.needs_bake);
    assert_eq!(view.download_cover_url, None, "baking");
    assert_eq!(view.cover_title.text, "Nap champion of the street");
    assert_eq!(bakes_due(&d, &id).await.unwrap(), [REELS]);

    assert!(bake_titled_cover(&d, (&id, REELS)).await.unwrap());

    let stills = w.base.renderer.stills();
    assert_eq!(stills.len(), 1);
    let (props, out) = &stills[0];
    assert_eq!(props.title.text, "Nap champion of the street");
    assert_eq!((props.width, props.height), (1080, 1920));
    assert!(props.image_url.contains("reels_cover_0.webp"), "{props:?}");
    assert!(out.contains(&format!("users/u1/exports/{id}/reels_cover_titled.jpg")));
    let view = list_exports(&d, &user("u1"), &id).await.unwrap().remove(0);
    assert!(!view.needs_bake);
    assert!(
        view.download_cover_url
            .unwrap()
            .contains("reels_cover_titled.jpg")
    );
    assert!(bakes_due(&d, &id).await.unwrap().is_empty());
}

#[tokio::test]
async fn editing_the_title_or_pick_rebakes_and_a_hidden_title_publishes_the_plain_pick() {
    let (w, id) = world(2).await;
    let d = w.export_deps();
    bake_titled_cover(&d, (&id, REELS)).await.unwrap();

    let edit = ExportEdit {
        cover_title: Some(title(" Nap champ ", true)),
        ..ExportEdit::default()
    };
    assert!(
        edit_export(&d, &user("u1"), (&id, REELS), edit)
            .await
            .unwrap()
    );
    let row = w.exports.row(&id, REELS).unwrap();
    assert_eq!(row.cover_title.unwrap().text, "Nap champ");
    assert_eq!(row.titled_cover_key, None, "the old still is forgotten");

    let caption_only = ExportEdit {
        caption: Some("New words".into()),
        ..ExportEdit::default()
    };
    let rebake = edit_export(&d, &user("u1"), (&id, REELS), caption_only).await;
    assert!(!rebake.unwrap(), "a caption alone keeps the cover");

    let hide = ExportEdit {
        cover_title: Some(title("Nap champ", false)),
        cover_pick: Some(1),
        ..ExportEdit::default()
    };
    edit_export(&d, &user("u1"), (&id, REELS), hide)
        .await
        .unwrap();
    let view = list_exports(&d, &user("u1"), &id).await.unwrap().remove(0);
    assert!(!view.needs_bake);
    assert!(
        view.download_cover_url
            .unwrap()
            .ends_with(&format!("{id}/reels_cover_1.webp?ttl=3600"))
    );
}

#[tokio::test]
async fn a_bad_title_or_pick_is_refused_and_changes_nothing() {
    let (w, id) = world(2).await;
    let d = w.export_deps();
    for edit in [
        ExportEdit {
            cover_title: Some(title(&"x".repeat(33), true)),
            ..ExportEdit::default()
        },
        ExportEdit {
            cover_title: Some(title("   ", true)),
            ..ExportEdit::default()
        },
        ExportEdit {
            cover_pick: Some(2),
            caption: Some("changed".into()),
            ..ExportEdit::default()
        },
    ] {
        let err = edit_export(&d, &user("u1"), (&id, REELS), edit).await;
        assert_eq!(err.unwrap_err().code, ErrorCode::ValidationFailed);
    }
    let row = w.exports.row(&id, REELS).unwrap();
    assert_eq!(row.cover_title, None);
    assert_eq!(row.caption, "Nap champion of the street #dog");
    let other = edit_export(&d, &user("u2"), (&id, REELS), ExportEdit::default()).await;
    assert_eq!(other.unwrap_err().code, ErrorCode::Forbidden);
}

/// Renders nothing; while "rendering", the owner retitles the export.
struct RetitledMidStill<'a> {
    exports: &'a nimbytes_testkit::InMemoryExports,
    id: ShortId,
}

impl Renderer for RetitledMidStill<'_> {
    fn render<'a>(
        &'a self,
        _: &'a ShortProps,
        _: Quality,
        _: &'a str,
    ) -> PortResult<'a, RenderOutput> {
        Box::pin(async {
            Err(nimbytes_core::AppError::new(
                ErrorCode::RenderFailed,
                "not used",
            ))
        })
    }

    fn still<'a>(&'a self, _: &'a CoverStillProps, _: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.exports
                .set_cover_title(&self.id, REELS, &title("Retitled", true))
                .await
        })
    }
}

#[tokio::test]
async fn a_still_made_for_a_title_changed_meanwhile_is_not_recorded() {
    let (w, id) = world(2).await;
    let racing = RetitledMidStill {
        exports: &w.exports,
        id: id.clone(),
    };
    let mut d = w.export_deps();
    d.renderer = &racing;

    let settled = bake_titled_cover(&d, (&id, REELS)).await.unwrap();

    assert!(!settled, "the caller makes it again");
    let row = w.exports.row(&id, REELS).unwrap();
    assert_eq!(row.titled_cover_key, None);
    assert_eq!(row.cover_title.unwrap().text, "Retitled");
}
