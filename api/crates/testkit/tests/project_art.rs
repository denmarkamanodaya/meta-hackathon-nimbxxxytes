//! Project key art over in-memory fakes: the first art once a project holds 3 clips, the 4
//! strongest hooks of its own clips as anchors, the stored sources, and the signed page data.

#![cfg(test)]

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::{ClipId, ProjectId};
use nimbytes_core::domain::project::{Project, ProjectColor};
use nimbytes_core::ports::ProjectStore;
use nimbytes_core::usecases::project_art::{
    auto_project_art_due, draw_project_art, project_art_requested,
};
use nimbytes_core::usecases::projects::{delete_project, list_projects};
use nimbytes_testkit::shorts_world::user;
use nimbytes_testkit::studio_world::StudioWorld;

#[tokio::test]
async fn deleting_a_project_removes_its_key_art_but_never_another_users() {
    let w = StudioWorld::default();
    with_project(&w, &["k1"]).await;
    let d = w.project_deps();

    let other = delete_project(&d, &user("u2"), &pid()).await;
    assert_eq!(other.unwrap_err().code, ErrorCode::Forbidden);
    assert!(w.base.blobs.deleted().is_empty());

    delete_project(&d, &user("u1"), &pid()).await.unwrap();
    assert_eq!(w.base.blobs.deleted(), ["users/u1/projects/pr1/art.webp"]);
}

fn pid() -> ProjectId {
    ProjectId::parse("pr1").unwrap()
}

fn clip(id: &str) -> ClipId {
    ClipId::parse(id).unwrap()
}

/// Project pr1 "Tokyo" of u1 holding `clips`.
async fn with_project(w: &StudioWorld, clips: &[&str]) {
    let p = Project {
        id: pid(),
        user_id: user("u1"),
        name: "Tokyo".into(),
        color: ProjectColor::Blue,
        created_at: "t".into(),
        updated_at: "t".into(),
    };
    let ids: Vec<ClipId> = clips.iter().map(|c| clip(c)).collect();
    w.projects.create(&p, &ids).await.unwrap();
    for c in &ids {
        w.catalogue.put_in_project(c, &pid());
    }
}

#[tokio::test]
async fn the_first_art_is_due_once_the_project_holds_3_clips_and_only_once() {
    let w = StudioWorld::default();
    with_project(&w, &["k1", "k2"]).await;
    assert!(!auto_project_art_due(&w.projects, &pid()).await.unwrap());

    w.projects
        .add_clips(&pid(), &[clip("k3")], "t")
        .await
        .unwrap();
    assert!(auto_project_art_due(&w.projects, &pid()).await.unwrap());
    assert!(!auto_project_art_due(&w.projects, &pid()).await.unwrap());
}

#[tokio::test]
async fn project_art_is_drawn_from_the_4_strongest_hooks_of_its_own_clips() {
    let w = StudioWorld::default();
    w.put_moment("u1", ("k1", "a"), Some(2)).await;
    w.put_moment("u1", ("k1", "b"), Some(9)).await;
    w.put_moment("u1", ("k2", "c"), Some(7)).await;
    w.put_moment("u1", ("k2", "d"), None).await;
    w.put_moment("u1", ("k3", "e"), Some(8)).await;
    w.put_moment("u1", ("k9", "z"), Some(10)).await; // not in the project
    with_project(&w, &["k1", "k2", "k3"]).await;

    draw_project_art(&w.project_art_deps(), &pid(), 0)
        .await
        .unwrap();

    let sent = w.images.art.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!((sent[0].shape, sent[0].size), ("16:9", "1920x1080"));
    assert_eq!(sent[0].theme, "Tokyo");
    assert_eq!(sent[0].anchors.len(), 4);
    let summary = w.projects.summary(&pid()).await.unwrap().unwrap();
    let picked: Vec<&str> = summary
        .art
        .sources
        .iter()
        .map(|s| s.segment_id.as_str())
        .collect();
    assert_eq!(picked, ["b", "e", "c", "a"]);
    assert_eq!(summary.art.sources[0].clip_title, "Clip k1");
    assert_eq!(summary.art.sources[0].title, "moment b");
    assert_eq!(
        summary.art.key.unwrap().as_str(),
        "users/u1/projects/pr1/art.webp"
    );
}

#[tokio::test]
async fn the_project_page_signs_the_art_and_each_moment_it_was_drawn_from() {
    let w = StudioWorld::default();
    w.put_moment("u1", ("k1", "b"), Some(9)).await;
    with_project(&w, &["k1"]).await;
    draw_project_art(&w.project_art_deps(), &pid(), 0)
        .await
        .unwrap();

    let views = list_projects(&w.project_deps(), &user("u1")).await.unwrap();

    let v = &views[0];
    assert_eq!(
        v.art_url.as_deref(),
        Some("https://signed/users/u1/projects/pr1/art.webp?ttl=3600")
    );
    assert_eq!(v.art_sources.len(), 1);
    assert_eq!(
        v.art_sources[0].1,
        "https://signed/users/u1/thumbs/k1/b.jpg?ttl=3600"
    );
}

#[tokio::test]
async fn new_project_art_is_the_owners_and_nothing_to_draw_from_is_an_error() {
    let w = StudioWorld::default();
    with_project(&w, &["k1"]).await;
    let d = w.project_art_deps();

    assert!(project_art_requested(&d, &user("u1"), &pid()).await.is_ok());
    let other = project_art_requested(&d, &user("u2"), &pid()).await;
    assert_eq!(other.unwrap_err().code, ErrorCode::Forbidden);
    let missing = ProjectId::parse("nope").unwrap();
    let none = project_art_requested(&d, &user("u1"), &missing).await;
    assert_eq!(none.unwrap_err().code, ErrorCode::NotFound);

    let empty = draw_project_art(&d, &pid(), 0).await;
    assert_eq!(empty.unwrap_err().code, ErrorCode::ValidationFailed);
    assert!(w.images.art.lock().unwrap().is_empty());
}
