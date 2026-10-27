//! Deleting a short over fakes: ownership, its jobs, rows and exact objects, and late job steps.

#![cfg(test)]

use std::sync::Arc;

use nimbytes_core::ErrorCode;
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::render::{Quality, ShortProps};
use nimbytes_core::ports::{PortResult, RenderOutput, Renderer, ShortStore, StepRunner};
use nimbytes_core::usecases::shorts::{delete_short, request_render, save_timeline};
use nimbytes_testkit::InMemoryShorts;
use nimbytes_testkit::shorts_world::{ShortsWorld, seg, timeline, user};

/// A short of u1 with versions 1 (planned) and 2 (an edit) and a queued render of version 1.
async fn two_versions() -> (ShortsWorld, ShortId) {
    let w = ShortsWorld::new();
    let id = w.create().await.unwrap();
    w.reasoner
        .plans(timeline(&[("s0", 1.0, 4.0), ("s1", 11.0, 14.0)]));
    w.run(JobKind::Agent, "edit").await.unwrap();
    let edit = timeline(&[("s1", 11.0, 15.0), ("s0", 1.0, 3.0)]);
    save_timeline(&w.deps(), &user("u1"), &id, edit)
        .await
        .unwrap();
    request_render(&w.deps(), &user("u1"), &id, 1)
        .await
        .unwrap();
    (w, id)
}

#[tokio::test]
async fn deleting_a_short_cancels_its_jobs_removes_its_rows_and_exactly_its_objects() {
    let (w, id) = two_versions().await;
    let before = w.blobs.deleted().len();

    delete_short(&w.deps(), &user("u1"), &id).await.unwrap();

    assert_eq!(w.shorts.get(&id).await.unwrap(), None);
    assert!(w.shorts.versions(&id).await.unwrap().is_empty());
    assert!(w.shorts.steps(&id).await.unwrap().is_empty());
    assert!(w.shorts.segments(&id).await.unwrap().is_empty());
    assert!(
        w.jobs.all().is_empty(),
        "agent and render jobs: {:?}",
        w.jobs.all()
    );
    assert_eq!(
        w.blobs.deleted()[before..],
        [
            format!("users/u1/previews/{id}/v1.mp4"),
            format!("users/u1/previews/{id}/v2.mp4"),
            format!("users/u1/renders/{id}.mp4"),
        ]
    );
    let owners = w
        .shorts
        .segment_owners(&[seg("s0"), seg("s1")])
        .await
        .unwrap();
    assert_eq!(owners.len(), 2, "the moments it was cut from stay");
}

#[tokio::test]
async fn another_users_short_is_forbidden_and_an_unknown_one_not_found_and_nothing_goes() {
    let (w, id) = two_versions().await;
    let before = w.blobs.deleted().len();

    let theirs = delete_short(&w.deps(), &user("u2"), &id).await;
    let unknown = delete_short(&w.deps(), &user("u1"), &ShortId::parse("nope").unwrap()).await;

    assert_eq!(theirs.unwrap_err().code, ErrorCode::Forbidden);
    assert_eq!(unknown.unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(w.blobs.deleted().len(), before);
    assert!(w.shorts.get(&id).await.unwrap().is_some());
    assert_eq!(w.shorts.versions(&id).await.unwrap().len(), 2);
    assert_eq!(w.jobs.all().len(), 2, "agent and render jobs kept");
}

#[tokio::test]
async fn an_agent_run_that_starts_after_the_delete_stops_and_writes_nothing() {
    let (w, id) = two_versions().await;
    let job = w.job(JobKind::Agent).unwrap();
    delete_short(&w.deps(), &user("u1"), &id).await.unwrap();

    let late = w.steps().run(&job, "edit").await;

    assert_eq!(late.unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(w.shorts.get(&id).await.unwrap(), None);
    assert!(w.shorts.versions(&id).await.unwrap().is_empty());
    assert!(w.shorts.steps(&id).await.unwrap().is_empty());
}

/// Deletes the short while it "renders", as an owner deleting mid-render would.
struct DeletedMidRender {
    shorts: Arc<InMemoryShorts>,
    id: ShortId,
}

impl Renderer for DeletedMidRender {
    fn render<'a>(
        &'a self,
        _props: &'a ShortProps,
        _quality: Quality,
        _out_url: &'a str,
    ) -> PortResult<'a, RenderOutput> {
        Box::pin(async move {
            self.shorts.delete(&self.id).await?;
            Ok(RenderOutput {
                duration_s: 6.0,
                bytes: 1,
            })
        })
    }
}

#[tokio::test]
async fn a_render_that_finishes_after_the_delete_removes_its_own_upload() {
    let (w, id) = two_versions().await;
    let job = w.job(JobKind::Render).unwrap();
    let steps = nimbytes_core::usecases::shorts::ShortSteps {
        renderer: Arc::new(DeletedMidRender {
            shorts: w.shorts.clone(),
            id: id.clone(),
        }),
        ..w.steps()
    };
    let before = w.blobs.deleted().len();

    let late = steps.run(&job, "render").await;

    assert_eq!(late.unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(
        w.blobs.deleted()[before..],
        [format!("users/u1/renders/{id}.mp4")]
    );
    assert_eq!(w.shorts.get(&id).await.unwrap(), None);
}
