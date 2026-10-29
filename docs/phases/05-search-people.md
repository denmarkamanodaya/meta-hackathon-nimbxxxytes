# Phase 5 — Hybrid search, people and speakers

**Day:** Fri 30 Oct · **Depends on:** Phase 4

## Goal

One search box that understands "when Sam laughed at the beach last weekend" and lands on the exact
second, with a one-line reason per result. Users name faces and speakers so names become searchable.

## Tasks

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 5.1 | `Reasoner::rewrite_query` (Spark): `{ keywords: [], filters: { people[], speakers[], place?, from?, to?, min_quality? } }` with today's date in the prompt for relative dates | api | Schema-validated; fallback = raw query |
| 5.2 | BM25 leg: Tantivy query over keywords + filter terms, top 30 | api | |
| 5.3 | Vector leg: PE text embedding of the original query → sqlite-vec KNN top 30, filtered by user and filters | api | |
| 5.4 | `core::fusion::rrf` (pure, k = 60) → fused top 30 | api | |
| 5.5 | `Reasoner::rerank` (Spark): candidates as compact text (description, transcript excerpt, people, place) → top 10 with `reason` ≤ 90 chars; 6 s timeout → fused order, `reranked = false` | api | |
| 5.6 | `POST /api/search` use case composing 5.1–5.5; log total latency + cost | api | |
| 5.7 | Search screen: one box, recent queries, result cards (thumb, clip date, `mm:ss`, reason), tap → clip detail at `start_s`; long-press / checkbox to select moments → "Make a short" | web | |
| 5.8 | People naming: tap face crop → bottom sheet with name input + autocomplete (`GET /api/people?prefix=`) + "Hide (bystander)" | web | |
| 5.9 | `PUT /api/tracks/{id}` → upsert person, set `person_id` / `hidden`, `reindex_segment` for linked segments | api | |
| 5.10 | Speaker rename: tap speaker name in transcript → sheet → `PUT /api/speakers/{id}` → reindex | web + api | |

## Unit tests

| Test | Covers |
| --- | --- |
| `core::fusion::rrf`: known rankings → known fused order; item in one list only; ties stable | 5.4 |
| Search use case with fakes: rewrite fails → raw keywords; rerank fails / times out → fused order with `reranked = false`; vector leg missing → BM25 only | 5.1–5.6 fallbacks |
| Rewrite prompt carries today's date from `Clock`; filter JSON validated | 5.1 |
| Rerank output referencing a segment not in the candidates is dropped | 5.5 guard |
| Naming: `PUT /api/tracks/{id}` upserts one person per name, sets `person_id`, triggers reindex of exactly the linked segments; hidden track excluded from index `people` field | 5.9 |
| Web: autocomplete debouncing; selection state for "Make a short" | 5.7, 5.8 |

## Acceptance checks

- [ ] Name a face "Sam"; search "Sam" returns only segments where Sam's track appears.
- [ ] A visual-only query ("sunset over water") with no matching words still finds the segment via
      the vector leg.
- [ ] A spoken-words query finds the segment where those words were said.
- [ ] Every result has a reason when rerank succeeds; with the API key removed the search still
      returns fused results.
- [ ] Hidden tracks never appear in results or people chips.
- [ ] Search p50 latency recorded in `LEARNING.md`.
- [ ] Gates pass.
