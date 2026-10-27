//! The brand kit themes every props build: the Player's props and the agent's preview renders.

#![cfg(test)]

use nimbytes_core::domain::brand::{BRICOLAGE_FONT, BrandKit, TitleFont};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::render::{VIDEO_ACCENT, VIDEO_FONT};
use nimbytes_core::usecases::shorts::short_detail;
use nimbytes_testkit::shorts_world::{ShortsWorld, timeline, user};

#[tokio::test]
async fn without_a_kit_the_player_keeps_the_default_theme() {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    w.reasoner.plans(timeline(&[("s0", 1.0, 6.0)]));
    w.run(JobKind::Agent, "edit").await.unwrap();

    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();

    let theme = &detail.versions[0].props.theme;
    assert_eq!(
        (theme.accent.as_str(), theme.font.as_str()),
        (VIDEO_ACCENT, VIDEO_FONT)
    );
    let rendered = &w.renderer.calls()[0].props.theme;
    assert_eq!(rendered.accent, VIDEO_ACCENT);
}

#[tokio::test]
async fn a_kit_themes_the_preview_render_and_the_player() {
    let w = ShortsWorld::new();
    w.brand.kits.lock().unwrap().insert(
        user("u1"),
        BrandKit {
            colors: vec!["#0b6e85".into(), "#ffffff".into()],
            title_font: TitleFont::Bricolage,
            logo_key: None,
            ref_keys: vec![],
            updated_at: "t".into(),
        },
    );
    let id = w.create().await.unwrap();
    w.reasoner.plans(timeline(&[("s0", 1.0, 6.0)]));

    w.run(JobKind::Agent, "edit").await.unwrap();

    let rendered = &w.renderer.calls()[0].props.theme;
    assert_eq!(
        (rendered.accent.as_str(), rendered.font.as_str()),
        ("#0b6e85", BRICOLAGE_FONT)
    );
    let detail = short_detail(&w.deps(), &user("u1"), &id).await.unwrap();
    assert_eq!(detail.versions[0].props.theme, *rendered);
}
