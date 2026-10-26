//! Search use case over fakes: rewrite, both legs, fusion, filters, rerank and every fallback.

#![cfg(test)]

use std::time::Duration;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::ids::{ClipId, PersonId, SegmentId, UserId};
use nimbytes_core::domain::index::DocScope;
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::search::{Rewritten, SearchFilters, raw_rewrite};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::{Catalogue, PeopleStore, TextIndex, VectorIndex};
use nimbytes_core::usecases::search::{SearchDeps, SearchOutcome, search};
use nimbytes_testkit::world::facts;
use nimbytes_testkit::{
    FakeBlobStore, FakeEmbedder, FixedClock, InMemoryCatalogue, InMemoryPeople, InMemoryTextIndex,
    InMemoryVectorIndex, ScriptedReasoner,
};

struct Lib {
    catalogue: InMemoryCatalogue,
    people: InMemoryPeople,
    reasoner: ScriptedReasoner,
    text: InMemoryTextIndex,
    vectors: InMemoryVectorIndex,
    blobs: FakeBlobStore,
    clock: FixedClock,
}

fn u1() -> UserId {
    UserId::parse("u1").unwrap()
}

fn empty() -> Lib {
    Lib {
        catalogue: InMemoryCatalogue::default(),
        people: InMemoryPeople::default(),
        reasoner: ScriptedReasoner::default(),
        text: InMemoryTextIndex::default(),
        vectors: InMemoryVectorIndex::default(),
        blobs: FakeBlobStore::default(),
        clock: FixedClock::at(1_793_062_923_456),
    }
}

fn clip_c1() -> Clip {
    Clip {
        id: ClipId::parse("c1").unwrap(),
        user_id: u1(),
        filename: "a.mov".into(),
        ext: MediaExt::Mov,
        size_bytes: 1,
        status: ClipStatus::Ready,
        probe: None,
        created_at: "2026-10-27T00:00:00.000Z".into(),
    }
}

const TEXTS: [&str; 3] = [
    "A dog sleeps on the sofa.",
    "Golden light over still water.",
    "Sam laughs at the beach.",
];

/// Three 7 s segments of `clip`.
fn segments(clip: &ClipId) -> Vec<Segment> {
    (0..3u32)
        .map(|i| Segment {
            id: SegmentId::parse(format!("c1-s{i}")).unwrap(),
            clip_id: clip.clone(),
            idx: i,
            span: Span {
                start_s: f64::from(i) * 7.0,
                end_s: f64::from(i + 1) * 7.0,
            },
        })
        .collect()
}

/// Clip c1 of u1 with three described segments, all indexed; only c1-s1 has a vector.
async fn library() -> Lib {
    let lib = empty();
    let clip = clip_c1();
    lib.catalogue.put_clip(clip.clone());
    let segs = segments(&clip.id);
    lib.catalogue
        .replace_segments(&clip.id, &segs)
        .await
        .unwrap();
    for (s, t) in segs.iter().zip(TEXTS) {
        lib.catalogue
            .set_segment_facts(&s.id, &facts(t))
            .await
            .unwrap();
    }
    let docs = lib
        .catalogue
        .index_docs(DocScope::Clip(&clip.id))
        .await
        .unwrap();
    lib.text.upsert(&docs).await.unwrap();
    lib.vectors
        .upsert(&segs[1].id, &u1(), &[1.0, 0.0, 0.0, 0.0])
        .await
        .unwrap();
    lib
}

async fn run(lib: &Lib, query: &str) -> SearchOutcome {
    let deps = SearchDeps {
        catalogue: &lib.catalogue,
        people: &lib.people,
        reasoner: &lib.reasoner,
        text: &lib.text,
        embedder: &FakeEmbedder,
        vectors: &lib.vectors,
        blobs: &lib.blobs,
        clock: &lib.clock,
        url_ttl: Duration::from_secs(3600),
    };
    search(&deps, &u1(), query).await.unwrap()
}

fn ids(o: &SearchOutcome) -> Vec<&str> {
    o.results
        .iter()
        .map(|h| h.candidate.segment_id.as_str())
        .collect()
}

#[tokio::test]
async fn the_rewrite_sees_todays_date_from_the_clock_and_the_users_names() {
    let lib = library().await;
    lib.people
        .upsert_person(&u1(), &PersonId::parse("p1").unwrap(), "Sam")
        .await
        .unwrap();

    run(&lib, "Sam at the beach yesterday").await;

    let req = &lib.reasoner.rewrite_requests()[0];
    assert_eq!(
        (req.today.as_str(), req.people.as_slice()),
        ("2026-10-27 (Tuesday)", ["Sam".to_owned()].as_slice())
    );
    assert_eq!(req.query, "Sam at the beach yesterday");
}

#[tokio::test]
async fn when_both_models_fail_search_uses_raw_words_and_fused_order_without_reasons() {
    let lib = library().await;

    let out = run(&lib, "sofa").await;

    assert_eq!(out.rewritten, raw_rewrite("sofa"));
    assert_eq!(
        ids(&out),
        ["c1-s0", "c1-s1"],
        "keyword hit first, then the vector-leg hit"
    );
    assert!(!out.reranked);
    assert!(out.results.iter().all(|h| h.reason.is_none()));
    assert_eq!(
        out.results[0].thumb_url,
        "https://signed/users/u1/thumbs/c1/c1-s0.jpg?ttl=3600"
    );
}

#[tokio::test]
async fn rerank_orders_and_explains_and_drops_invented_or_repeated_ids() {
    let lib = library().await;
    lib.reasoner.rewrites_to(Rewritten {
        keywords: vec!["the".into()],
        filters: SearchFilters::default(),
    });
    lib.reasoner.reranks_to(vec![
        ("c1-s2", "Sam laughing"),
        ("ghost", "x"),
        ("c1-s0", "Dog on sofa"),
        ("c1-s2", "again"),
    ]);

    let out = run(&lib, "fun").await;

    assert!(out.reranked);
    assert_eq!(ids(&out), ["c1-s2", "c1-s0"]);
    assert_eq!(out.results[0].reason.as_deref(), Some("Sam laughing"));
    assert_eq!(
        lib.reasoner.rerank_candidates()[0].len(),
        3,
        "both keyword hits and the vector hit"
    );
}

#[tokio::test]
async fn a_visual_only_query_is_found_by_the_vector_leg() {
    let lib = library().await;

    let out = run(&lib, "sunset glow").await;

    assert_eq!(ids(&out), ["c1-s1"]);
}

#[tokio::test]
async fn filters_narrow_the_fused_pool_and_unknown_names_are_ignored() {
    let lib = library().await;
    let filters = SearchFilters {
        place: Some("beach".into()),
        people: vec!["Zed".into()],
        ..Default::default()
    };
    lib.reasoner.rewrites_to(Rewritten {
        keywords: vec!["the".into()],
        filters,
    });

    let out = run(&lib, "at the beach").await;

    assert!(
        out.rewritten.filters.people.is_empty(),
        "Zed is not one of the user's people"
    );
    assert_eq!(ids(&out), ["c1-s2"]);
}

#[tokio::test]
async fn an_empty_or_huge_query_is_refused() {
    let lib = library().await;
    let deps = SearchDeps {
        catalogue: &lib.catalogue,
        people: &lib.people,
        reasoner: &lib.reasoner,
        text: &lib.text,
        embedder: &FakeEmbedder,
        vectors: &lib.vectors,
        blobs: &lib.blobs,
        clock: &lib.clock,
        url_ttl: Duration::from_secs(3600),
    };
    for q in ["   ", &"x".repeat(301)] {
        let err = search(&deps, &u1(), q).await.unwrap_err();
        assert_eq!(err.code, nimbytes_core::ErrorCode::ValidationFailed);
    }
    assert!(lib.reasoner.rewrite_requests().is_empty());
}

#[tokio::test]
async fn a_rerank_that_keeps_nothing_falls_back_to_the_fused_hits() {
    let lib = library().await;
    lib.reasoner.reranks_to(vec![("ghost", "x")]);

    let out = run(&lib, "sofa").await;

    assert!(!out.reranked);
    assert_eq!(ids(&out), ["c1-s0", "c1-s1"]);
    assert!(out.results.iter().all(|h| h.reason.is_none()));
}
