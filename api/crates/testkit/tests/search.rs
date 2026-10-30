//! Search use case over fakes: rewrite, both legs, fusion, filters, rerank and every fallback.

#![cfg(test)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::cost::ModelCall;
use nimbytes_core::domain::ids::{ClipId, PersonId, SegmentId, UserId};
use nimbytes_core::domain::index::DocScope;
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::search::{FaceSeen, Rewritten, SearchFilters, raw_rewrite};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::{Catalogue, Clock, ModelLedger, PeopleStore, TextIndex, VectorIndex};
use nimbytes_core::time::format_utc;
use nimbytes_core::usecases::search::{SearchDeps, SearchOutcome, search, search_in_stages};
use nimbytes_testkit::world::facts;
use nimbytes_testkit::{
    FakeBlobStore, FakeEmbedder, FixedClock, InMemoryCatalogue, InMemoryLedger, InMemoryPeople,
    InMemoryTextIndex, InMemoryVectorIndex, ScriptedReasoner,
};

struct Lib {
    catalogue: InMemoryCatalogue,
    people: InMemoryPeople,
    reasoner: ScriptedReasoner,
    text: InMemoryTextIndex,
    vectors: InMemoryVectorIndex,
    blobs: FakeBlobStore,
    clock: FixedClock,
    ledger: InMemoryLedger,
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
        ledger: InMemoryLedger::default(),
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
        title: None,
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
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

fn deps(lib: &Lib) -> SearchDeps<'_> {
    SearchDeps {
        catalogue: &lib.catalogue,
        people: &lib.people,
        reasoner: &lib.reasoner,
        text: &lib.text,
        embedder: &FakeEmbedder,
        vectors: &lib.vectors,
        blobs: &lib.blobs,
        clock: &lib.clock,
        url_ttl: Duration::from_secs(3600),
        ledger: &lib.ledger,
        photos: None,
    }
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
        ledger: &lib.ledger,
        photos: None,
    };
    search(&deps, &u1(), query).await.unwrap()
}

fn ids(o: &SearchOutcome) -> Vec<&str> {
    o.results
        .iter()
        .map(|h| h.candidate.key().as_str())
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
    assert_eq!(
        req.query, "sam at the beach yesterday",
        "the model sees the normalised query (v1.1 cache key)"
    );
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
        ledger: &lib.ledger,
        photos: None,
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

fn seen(name: &str, n: u32) -> FaceSeen {
    FaceSeen {
        name: name.into(),
        crop_key: Some(format!("users/u1/faces/c1/c1-f{n}.jpg")),
    }
}

#[tokio::test]
async fn a_result_shows_each_named_person_once_biggest_face_first_at_most_three() {
    let lib = library().await;
    let s0 = SegmentId::parse("c1-s0").unwrap();
    for f in [
        seen("Ana", 1),
        seen("ana", 0),
        seen("Ben", 2),
        seen("Cid", 3),
        seen("Dee", 4),
    ] {
        lib.catalogue.put_face(s0.clone(), f);
    }

    let out = run(&lib, "sofa").await;

    let hit = out
        .results
        .iter()
        .find(|h| h.candidate.key() == &s0)
        .unwrap();
    let faces: Vec<(&str, Option<&str>)> = hit
        .faces
        .iter()
        .map(|f| (f.name.as_str(), f.crop_url.as_deref()))
        .collect();
    assert_eq!(
        faces,
        [
            (
                "Ana",
                Some("https://signed/users/u1/faces/c1/c1-f1.jpg?ttl=3600")
            ),
            (
                "Ben",
                Some("https://signed/users/u1/faces/c1/c1-f2.jpg?ttl=3600")
            ),
            (
                "Cid",
                Some("https://signed/users/u1/faces/c1/c1-f3.jpg?ttl=3600")
            ),
        ]
    );
    assert_eq!(hit.candidate.moment().unwrap().clip_title, "a");
}

fn call(id: &str, purpose: &str, at: &str, (cost_usd, cache_hit): (f64, bool)) -> ModelCall {
    ModelCall {
        id: id.into(),
        at: at.into(),
        model: "muse-spark-1.3".into(),
        purpose: purpose.into(),
        input_hash: "h".into(),
        usage: None,
        cost_usd,
        latency_ms: 1,
        cache_hit,
        error: None,
    }
}

#[tokio::test]
async fn a_search_reports_its_own_model_spend_and_whether_the_cache_answered_it_all() {
    let lib = library().await;
    let now = format_utc(lib.clock.now_millis());
    let earlier = "2020-01-01T00:00:00.000Z";
    let before = [
        call("old", "rerank", earlier, (0.9, false)),
        call("ingest", "segment_facts", &now, (0.4, false)),
        call("r1", "query_rewrite", &now, (0.0, true)),
        call("r2", "rerank", &now, (0.0, true)),
    ];
    for c in &before {
        lib.ledger.record(c).await.unwrap();
    }

    let cached = run(&lib, "sofa").await;
    let r3 = call("r3", "rerank", &now, (0.003, false));
    lib.ledger.record(&r3).await.unwrap();
    let paid = run(&lib, "sofa").await;

    assert_eq!((cached.cached, cached.cost_usd), (true, 0.0));
    assert!(!paid.cached);
    assert!(
        (paid.cost_usd - 0.003).abs() < 1e-12,
        "only this search's purposes and time"
    );
    assert_eq!(cached.took_ms, 0, "the fixed clock does not move");
}

#[tokio::test]
async fn a_search_with_no_model_call_is_not_called_cached() {
    let lib = library().await;

    let out = run(&lib, "sofa").await;

    assert_eq!((out.cached, out.cost_usd), (false, 0.0));
}

#[tokio::test]
async fn both_model_calls_see_the_normalised_query_so_case_and_spacing_share_a_cache_key() {
    let lib = library().await;

    run(&lib, "  Dog   ON the\tSofa ").await;
    run(&lib, "dog on the sofa").await;

    let rewrites: Vec<String> = lib
        .reasoner
        .rewrite_requests()
        .into_iter()
        .map(|r| r.query)
        .collect();
    assert_eq!(rewrites, ["dog on the sofa", "dog on the sofa"]);
    assert_eq!(
        lib.reasoner.rerank_queries(),
        ["dog on the sofa", "dog on the sofa"]
    );
}

#[tokio::test]
async fn the_local_answer_comes_first_and_no_model_call_has_answered_by_then() {
    let lib = library().await;
    lib.reasoner.rewrites_to(Rewritten {
        keywords: vec!["the".into()],
        filters: SearchFilters::default(),
    });
    lib.reasoner.reranks_to(vec![("c1-s2", "Sam laughing")]);
    let at_local = Mutex::new(None);
    let d = deps(&lib);

    let ranked = search_in_stages(&d, &u1(), "sofa", |local| {
        let calls = (
            lib.reasoner.rewrite_requests().len(),
            lib.reasoner.rerank_candidates().len(),
        );
        *at_local.lock().unwrap() = Some((local, calls));
    })
    .await
    .unwrap();

    let (local, calls) = at_local.into_inner().unwrap().unwrap();
    assert_eq!(
        calls,
        (0, 0),
        "rewrite and rerank calls seen by the local answer"
    );
    assert_eq!(local.rewritten, raw_rewrite("sofa"));
    assert_eq!(ids(&local), ["c1-s0", "c1-s1"]);
    assert!(!local.reranked);
    assert!(local.results.iter().all(|h| h.reason.is_none()));
    assert!(ranked.reranked);
    assert_eq!(ids(&ranked), ["c1-s2"]);
    assert_eq!(ranked.rewritten.keywords, ["the"]);
}

#[tokio::test]
async fn the_local_answer_is_handed_out_while_the_rewrite_is_still_pending() {
    let lib = library().await;
    let gate = Arc::new(AtomicBool::new(false));
    lib.reasoner.rewrite_waits_for(gate.clone());
    let (d, user) = (deps(&lib), u1());

    // The rewrite answers only once the local answer is out; a local stage that waited on the
    // rewrite would never finish.
    let staged = search_in_stages(&d, &user, "sofa", |_| gate.store(true, Ordering::SeqCst));
    let ranked = tokio::time::timeout(Duration::from_secs(5), staged)
        .await
        .expect("the local stage waited on the rewrite")
        .unwrap();

    assert_eq!(lib.reasoner.rewrite_requests().len(), 1);
    assert_eq!(ids(&ranked), ["c1-s0", "c1-s1"]);
}

#[tokio::test]
async fn when_rewrite_and_rerank_fail_the_ranked_answer_keeps_the_local_order() {
    let lib = library().await;
    let local = Mutex::new(None);
    let d = deps(&lib);

    let ranked = search_in_stages(&d, &u1(), "sofa", |l| *local.lock().unwrap() = Some(l))
        .await
        .unwrap();

    let local = local.into_inner().unwrap().unwrap();
    assert_eq!(
        lib.reasoner.rerank_candidates().len(),
        1,
        "rerank was tried"
    );
    assert!(!ranked.reranked);
    assert_eq!(ids(&ranked), ids(&local));
    assert_eq!(ranked.rewritten, local.rewritten);
    assert!(ranked.results.iter().all(|h| h.reason.is_none()));
}

#[tokio::test]
async fn a_refused_query_hands_out_no_local_answer() {
    let lib = library().await;
    let called = AtomicBool::new(false);
    let d = deps(&lib);

    let err = search_in_stages(&d, &u1(), "  ", |_| called.store(true, Ordering::SeqCst))
        .await
        .unwrap_err();

    assert_eq!(err.code, nimbytes_core::ErrorCode::ValidationFailed);
    assert!(!called.load(Ordering::SeqCst));
}

/// The library plus u1's analysed photo p1 ("A white loveseat on the beach stage") indexed and
/// embedded, and u2's photo p2 with the same words.
async fn with_photos(
    lib: &Lib,
    photos: &nimbytes_testkit::InMemoryPhotos,
    pv: &InMemoryVectorIndex,
) {
    use nimbytes_core::domain::ids::PhotoId;
    use nimbytes_core::domain::index::PhotoDoc;
    use nimbytes_core::domain::photo::{Photo, PhotoFacts, PhotoFormat, search_key};
    for (id, owner) in [("p1", "u1"), ("p2", "u2")] {
        let req = nimbytes_testkit::photos_world::jpeg("_MG_4210.jpg");
        let pid = PhotoId::parse(id).unwrap();
        let user = UserId::parse(owner).unwrap();
        let mut p = Photo::uploading((pid.clone(), user.clone()), req, PhotoFormat::Jpeg, "t");
        p.title = "Beach stage".into();
        p.taken_at = Some("2026-08-08T06:09:37.000Z".into());
        p.facts = PhotoFacts {
            description: "A white loveseat at the beach.".into(),
            place: "beach".into(),
            ..PhotoFacts::default()
        };
        photos.put(p);
        let key = search_key(&pid).unwrap();
        let doc = PhotoDoc {
            key: key.clone(),
            user_id: user.clone(),
            description: "Beach stage. A white loveseat at the beach.".into(),
            things: String::new(),
            place: "beach".into(),
            mood: String::new(),
            taken_at: None,
        };
        lib.text.upsert_photo(&doc).await.unwrap();
        pv.upsert(&key, &user, &[0.0, 1.0, 0.0, 0.0]).await.unwrap();
    }
}

fn photo_deps<'a>(
    lib: &'a Lib,
    photos: &'a nimbytes_testkit::InMemoryPhotos,
    pv: &'a InMemoryVectorIndex,
) -> SearchDeps<'a> {
    SearchDeps {
        photos: Some(nimbytes_core::usecases::search::PhotoSearch {
            store: photos,
            vectors: pv,
        }),
        ..deps(lib)
    }
}

#[tokio::test]
async fn a_photo_hit_is_merged_with_moment_hits_by_score_and_signed_as_a_photo() {
    let lib = library().await;
    let (photos, pv) = (
        nimbytes_testkit::InMemoryPhotos::default(),
        InMemoryVectorIndex::default(),
    );
    with_photos(&lib, &photos, &pv).await;

    let out = search(&photo_deps(&lib, &photos, &pv), &u1(), "beach")
        .await
        .unwrap();

    assert_eq!(
        ids(&out),
        ["photo_p1", "c1-s2", "c1-s1"],
        "keyword and photo vector put the photo first; u2's photo never shows"
    );
    let photo = &out.results[0];
    assert!(matches!(
        photo.candidate,
        nimbytes_core::domain::search::Found::Photo(_)
    ));
    assert_eq!(
        photo.thumb_url,
        "https://signed/users/u1/photos/p1/thumb.jpg?ttl=3600"
    );
    assert!(photo.faces.is_empty());
    assert_eq!(
        lib.reasoner.rerank_candidates().len(),
        1,
        "rerank failed: fused order kept"
    );
}

#[tokio::test]
async fn rerank_sees_photos_and_moments_and_the_short_planner_never_gets_photos() {
    let lib = library().await;
    let (photos, pv) = (
        nimbytes_testkit::InMemoryPhotos::default(),
        InMemoryVectorIndex::default(),
    );
    with_photos(&lib, &photos, &pv).await;
    lib.reasoner.reranks_to(vec![
        ("c1-s2", "Sam at the beach"),
        ("photo_p1", "The beach stage"),
    ]);

    let out = search(&photo_deps(&lib, &photos, &pv), &u1(), "beach")
        .await
        .unwrap();

    assert_eq!(ids(&out), ["c1-s2", "photo_p1"]);
    assert!(
        lib.reasoner.rerank_candidates()[0]
            .iter()
            .any(|k| k.as_str() == "photo_p1")
    );
    let moments_only = search(&deps(&lib), &u1(), "beach").await.unwrap();
    assert!(
        ids(&moments_only).iter().all(|k| !k.starts_with("photo_")),
        "{:?}",
        ids(&moments_only)
    );
}

#[tokio::test]
async fn a_quality_filter_leaves_photos_out_and_a_place_filter_keeps_them() {
    let lib = library().await;
    let (photos, pv) = (
        nimbytes_testkit::InMemoryPhotos::default(),
        InMemoryVectorIndex::default(),
    );
    with_photos(&lib, &photos, &pv).await;
    let filtered = |filters| Rewritten {
        keywords: vec!["beach".into()],
        filters,
    };
    lib.reasoner.rewrites_to(filtered(SearchFilters {
        min_quality: Some(1),
        ..SearchFilters::default()
    }));
    let d = photo_deps(&lib, &photos, &pv);
    let out = search(&d, &u1(), "good shots of the beach").await.unwrap();
    assert!(
        ids(&out).iter().all(|k| !k.starts_with("photo_")),
        "photos have no quality"
    );
    lib.reasoner.rewrites_to(filtered(SearchFilters {
        place: Some("beach".into()),
        ..SearchFilters::default()
    }));
    let out = search(&d, &u1(), "at the beach").await.unwrap();
    assert!(ids(&out).contains(&"photo_p1"), "{:?}", ids(&out));
}
