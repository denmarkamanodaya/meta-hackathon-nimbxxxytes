# Phase 3 — Understanding (Spark facts, SAM faces, PE embeddings)

**Day:** Thu 29 Oct (morning) · **Depends on:** Phase 2 (snippets, 1 fps copy, thumbs, transcript)

## Goal

Every segment gets strict, validated facts from Muse Spark; every clip gets face tracks with one
crop per person from SAM 3.1; every segment gets a Perception Encoder image embedding.

## Tasks

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 3.1 | Prompt + schema: `api/prompts/segment_facts.md` and `segment_facts.schema.json` (shape in `docs/contracts.md`). Context per call: snippet URL, segment start/end, transcript text overlapping the window, clip `recorded_at` | lead | Stable system prefix for prompt caching |
| 3.2 | `SegmentDescriber` via `MetaClient` (Spark, `input_video` presigned URL, 10 min expiry) → parse → `jsonschema` validate → on failure retry once with the validation error appended → on second failure store fallback (`description` = first 120 chars of model text or "Untitled moment", `facts_status = fallback`) | api | Semaphore of 4 per clip |
| 3.3 | `FaceTracker` via `MetaClient` (SAM `face`, stream on, `include_confidence`): incremental stream parser in `adapters::meta::sam_stream` → per-ordinal list of `(t, box, conf)` | api | Format notes from spike 0.2 in `LEARNING.md` |
| 3.4 | `core::faces` (pure): drop boxes < 4 % of frame area or conf < 0.5; drop tracks seen in < 2 frames; pick best frame per track (area × centredness × conf) | api | |
| 3.5 | Crop the best frame from the **720p proxy** at that time, pad 20 %, square, 256 px → `faces/{clip}/{track}.jpg`; write `face_tracks`; link `track_segments` by time | api | Map 1 fps box coords to 720p scale |
| 3.6 | `OrtEmbedder`: load image + text ONNX once (composition root), preprocessing per spike 0.4 (resize 224, normalise), L2-normalise output | api | Model path from env |
| 3.7 | Embed each thumbnail → `segment_vectors` | api | |
| 3.8 | Pipeline wiring: steps `describe` → `faces` → `embed` in the ingest job (order lets the library show descriptions first) | api | |

## Unit tests

| Test | Covers |
| --- | --- |
| Spark request body: model `muse-spark-1.3` (never `-contributor`), `input_video` with the presigned URL, segment start/end echoed in the prompt | 3.2 wire format |
| Segment facts: valid fixture passes; invalid JSON → retry carries the validation error; second failure → fallback row with `facts_status = fallback`; model-invented `segment_id` is overwritten with ours | 3.2 |
| SAM stream parser on the recorded fixture, fed in random chunk sizes (deltas split mid-token) → same tracks | 3.3 |
| `core::faces`: small / low-confidence boxes dropped; 1-frame tracks dropped; best-frame scoring; 1 fps → 720p coordinate scaling; crop padding stays inside the frame | 3.4, 3.5 |
| Embedder preprocessing (resize, normalise, L2) against values from `ml/` `meta.json` | 3.6 |
| Text→image ranking sanity check with the real ONNX files, behind cargo feature `pe-model` (`cargo test --features pe-model`), because the model files are git-ignored. Run it after each export; the default suite stays model-free instead of silently skipping | 3.6 |

## Acceptance checks

- [ ] For the 3 sample clips: ≥ 90 % of segments have `facts_status = ok`; descriptions read as
      concrete and correct when watched side by side.
- [ ] Multi-face sample: one track per real person; crops are recognisable faces, not shoulders.
- [ ] `segment_vectors` row count = segment count; text "coffee" nearest neighbour is the coffee
      segment (manual check in a debug endpoint `GET /api/debug/knn?q=`, removed before submit).
- [ ] Re-running ingest on a clip makes zero paid model calls (`model_calls.cache_hit = 1`).
- [ ] Cost per clip-minute recorded in `LEARNING.md`.
- [ ] Gates pass.

## Risks

- SAM may also return faces on posters / screens; acceptable — the user can hide them.
- Spark might drift from the schema on long transcripts; trim transcript context to 600 characters.
