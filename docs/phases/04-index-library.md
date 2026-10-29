# Phase 4 — Index and library

**Day:** Thu 29 Oct (afternoon) · **Depends on:** Phase 3

## Goal

Segments are searchable (Tantivy + vectors) and browsable: a library of clips and a clip detail
screen with segments, transcript, speakers and the "People in this clip" row.

## Tasks

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 4.1 | Tantivy schema + `TantivySearchIndex` (fields and boosts in `docs/data-model.md`); one writer behind a mutex, commit after each clip | api | Index dir under `DATA_DIR` |
| 4.2 | `index` step in the ingest job; `reindex_segment(id)` use case for later name changes | api | |
| 4.3 | `GET /api/clips` and `GET /api/clips/{id}` with presigned thumb / proxy / face URLs (1 h) | api | Ownership check |
| 4.4 | Library screen: grid of clips (first thumb, duration, date, status, people chips), pull-to-refresh, empty state pointing to Upload | web | |
| 4.5 | Clip detail: video player (proxy), segment strip (thumb + description; tap seeks), transcript list with speaker names (tap seeks), "People in this clip" row of face crops | web | |
| 4.6 | Design pass on tokens: type scale, spacing, card, chip, button, sheet; light + dark | web | Vanilla CSS only |

## Unit tests

| Test | Covers |
| --- | --- |
| Tantivy in a temp dir (RAM directory): boosts rank a description match above a mood match; user filter never returns another user's segment; reindex replaces, never duplicates | 4.1, 4.2 |
| `GET /api/clips/{id}` handler with fakes: presigned URLs only for the owner; 404 vs 403 behaviour | 4.3 |
| Web: `useClips` / `useClip` with a mocked service (loading, error, live status update from a fake SSE source) | 4.4, 4.5 |

## Acceptance checks

- [ ] Library shows all sample clips with correct status; processing clips update live.
- [ ] Clip detail: tapping a segment or a transcript line seeks the player to that second.
- [ ] People row shows one crop per track.
- [ ] Gates pass.
