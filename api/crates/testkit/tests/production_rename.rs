//! Renaming a production over in-memory fakes: ownership first, then the checked title.

#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::{ProductionId, UserId};
use nimbytes_core::ports::ProductionStore;
use nimbytes_core::usecases::productions::rename_production;
use nimbytes_testkit::studio_world::{StudioWorld, production, shot};

fn pid(id: &str) -> ProductionId {
    ProductionId::parse(id).unwrap()
}

fn uid(id: &str) -> UserId {
    UserId::parse(id).unwrap()
}

fn world() -> StudioWorld {
    let w = StudioWorld::default();
    w.productions
        .put(production("p1", "u1", None), vec![shot("a", 1, None)]);
    w
}

async fn title_of(w: &StudioWorld, id: &str) -> String {
    w.productions.get(&pid(id)).await.unwrap().unwrap().title
}

#[tokio::test]
async fn the_owner_renames_with_a_tidied_title_and_gets_the_detail_back() {
    let w = world();
    let view = rename_production(&w.studio_deps(), &uid("u1"), &pid("p1"), "  Night \t walk ")
        .await
        .unwrap();

    assert_eq!(view.production.title, "Night walk");
    assert_eq!(view.shots.len(), 1, "the detail carries the shots");
    assert_eq!(title_of(&w, "p1").await, "Night walk");
}

#[tokio::test]
async fn ownership_is_checked_before_the_title() {
    let w = world();
    let d = w.studio_deps();
    let rename = |user: &'static str, id: &'static str, raw: &'static str| {
        let d = &d;
        async move { rename_production(d, &uid(user), &pid(id), raw).await }
    };

    assert_eq!(
        rename("u2", "p1", "Mine").await.unwrap_err().code,
        ErrorCode::Forbidden
    );
    assert_eq!(
        rename("u2", "p1", "").await.unwrap_err().code,
        ErrorCode::Forbidden,
        "another user learns nothing about the title rule"
    );
    assert_eq!(
        rename("u1", "zz", "Mine").await.unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(
        rename("u1", "p1", "   ").await.unwrap_err().code,
        ErrorCode::ValidationFailed
    );
    assert_eq!(title_of(&w, "p1").await, "Beach day", "nothing was stored");
}
