# Architecture

Rules live in `/CLAUDE.md`. Model facts live in `docs/meta-api.md`. Tables and keys live in
`docs/data-model.md`. Endpoints and JSON shapes live in `docs/contracts.md`. This file explains how
the pieces fit.

## System view

```
Phone (PWA, HTTPS)
  │  1. POST /api/uploads            → presigned multipart part URLs
  │  2. PUT parts straight to S3     (browser → S3, never through the API)
  │  3. POST /api/uploads/{id}/complete
  ▼
Caddy (TLS, <ip>.sslip.io)  ──►  web static files (Vite build)
  │
  └──►  api (Rust, Axum)  ──  SQLite (WAL) + sqlite-vec  ──  Tantivy index dir
           │                     (all on one EBS volume / local ./data in dev)
           ├── worker pool (Tokio) ── jobs table ── ingest / render / agent jobs
           │      ├── ffmpeg / ffprobe   (ingest only; tokio::process, timeouts)
           │      ├── renderer (Node + Remotion, compose service) ← previews + final MP4
           │      ├── PE-Core ONNX       (ort, CPU, in-process)
           │      └── Meta Model API     (reqwest; one MetaClient adapter; cache + cost log)
           └── S3 (aws-sdk-s3): originals, proxies, thumbs, faces, audio, renders
```

One process runs both the HTTP server and the worker pool. One box. No queue service, no second
database. That is enough for a demo library of tens of clips.

## Rust workspace (`api/`)

| Crate | Role (hexagonal) | Depends on |
| --- | --- | --- |
| `core` | `AppError` + `ErrorCode` (one source of error codes), domain types (`Clip`, `Segment`, `TranscriptTurn`, `FaceTrack`, `Person`, `Timeline`, `Critique`), ports (traits), use cases, pure rules (segmenting windows, RRF, phrase splitting, timeline clamping, cost maths) | `serde`, `thiserror` only |
| `contracts` | Wire types for HTTP (serde + `schemars`), re-export of `core::ErrorCode`, JSON schemas sent to Spark | `core`, `serde`, `schemars` |
| `adapters` | `MetaClient` (Spark, SAM, Transcribe), `S3BlobStore`, `FfmpegMediaTool`, `SqliteCatalogue`, `TantivySearchIndex`, `SqliteVecIndex`, `OrtEmbedder`, `SqliteJobQueue`, `SystemClock` | `core`, `contracts`, IO crates |
| `server` | Axum handlers (driving adapters), worker loop, `composition.rs` (only env reader, builds adapters, binds ports) | all |
| `testkit` | In-memory fakes of every port, builders, fixture loader; dev-dependency only | `core`, `contracts` |

Ports (in `core::ports`), each `Send + Sync`, domain types only:

| Port | Methods (sketch) | Adapter |
| --- | --- | --- |
| `BlobStore` | `presign_put_parts`, `complete_multipart`, `presign_get`, `put_file`, `get_to_file` | `S3BlobStore` |
| `MediaTool` | `probe`, `make_proxy`, `make_sam_fps1`, `extract_wav`, `scene_cuts`, `thumbnail`, `snippet`, `crop_frame`, `render(timeline)` | `FfmpegMediaTool` |
| `SegmentDescriber` | `describe(segment_video_url, context) -> SegmentFacts` | `MetaClient` (Spark) |
| `Transcriber` | `transcribe(wav_path) -> Vec<TranscriptTurn>` | `MetaClient` (Voice) |
| `FaceTracker` | `track_faces(video_url) -> Vec<FaceTrack>` | `MetaClient` (SAM) |
| `Reasoner` | `rewrite_query`, `rerank`, `plan_edit`, `critique`, `post_copy`, `agent_turn` | `MetaClient` (Spark) |
| `Embedder` | `embed_image(path)`, `embed_text(str)` | `OrtEmbedder` |
| `Catalogue` | clips, segments, turns, tracks, people, speakers, shorts CRUD | `SqliteCatalogue` |
| `TextIndex` / `VectorIndex` | `upsert`, `search(query, k)` | `TantivySearchIndex`, `SqliteVecIndex` |
| `JobQueue` | `enqueue`, `claim`, `advance(step)`, `fail`, `done` | `SqliteJobQueue` |
| `ModelLedger` | `cached(hash)`, `record(call)` | `SqliteCatalogue` (model_calls + model_cache) |
| `Clock`, `IdGenerator` | `now`, `new_id` | `SystemClock`, `UuidV7Ids` |

Every Meta call goes through `MetaClient`, which: hashes the request (model + normalised body +
media content hash), returns the cached response on a hit, otherwise calls the API, then writes a
`model_calls` row with cost. That one adapter gives us the cost log, the replayable demo and retries
in one place.

## Ingest pipeline (one resumable job per clip)

Each step writes its output, then advances `jobs.step`. A crashed or restarted worker resumes at the
recorded step; finished steps are never redone because their outputs exist and model calls are
cached.

| Step | What happens | Output |
| --- | --- | --- |
| `probe` | ffprobe: duration, fps, rotation, codec, `creation_time` | `clips` columns |
| `proxy` | 720p constant-fps H.264 proxy (rotation applied, HEVC decoded) | `proxies/{clip}_720p.mp4` |
| `derivatives` | 1 fps H.264 copy for SAM; 360p snippet source; 16 kHz mono WAV | `proxies/{clip}_fps1.mp4`, `audio/{clip}.wav` |
| `segments` | `scdet` cut points; shots split into 5–10 s windows; one thumbnail per segment (middle frame); one 360p snippet per segment | `segments` rows, `thumbs/…`, `snippets/…` |
| `transcribe` | Voice Transcribe (DIARIZATION); turns attached to overlapping segments | `transcript_turns`, `speakers` |
| `describe` | Spark per segment (snippet URL + transcript text for that window) → strict JSON; validate; one retry with the error; fallback short description | `segments.description, actions, objects, place, mood, quality, hook_score` |
| `faces` | SAM `face` on the 1 fps copy; parse stream; one track per object ordinal; drop boxes < 4 % of frame area; best (largest, most central) crop per track; link tracks to segments by frame time | `face_tracks`, `faces/…` |
| `embed` | PE image embedding per thumbnail | `segment_vectors` |
| `index` | Tantivy document per segment | index dir |
| `ready` | `clips.status = ready` | |

Concurrency: worker pool of N (default 2). Spark segment calls inside one clip run with a small
semaphore (default 4). ffmpeg runs one heavy job at a time.

## Search

```
query ─► Spark rewrite → { keywords, filters{people, speakers, place, date range, min_quality} }
      ├► Tantivy BM25 over keywords (+ filters)             → top 30
      ├► PE text embedding → sqlite-vec KNN (+ filters)      → top 30
      ▼
   RRF (k = 60) → fused top 30 → Spark rerank → top 10, one-line reason each
      ▼
   results: { segment, clip, start, end, reason, thumb_url }  → PWA jumps the player to `start`
```

If rewrite fails: use the raw query as keywords, no filters. If rerank fails or times out (> 6 s):
return the fused order with no reasons. If the vector leg is not ready: BM25 only.

Tantivy fields and weights are in `docs/data-model.md`.

## People and speakers

- A face track is one person within one clip. The user names a track (autocomplete from existing
  names); the name is linked through a `people` row and applied to every segment that track
  appears in. Search indexes the names. No face embeddings, no cross-clip matching.
- Speaker labels from DIARIZATION are per clip too; the user can rename them the same way.
- Hide: marks a track as bystander; excluded from search and from "people" chips.

## Agentic editor

Orchestrated in Rust (`core::usecases::edit_agent`), driven by Spark 1.3 tool calling.

```
user prompt + selected moments
  └► plan: Spark returns a Timeline (JSON contract in docs/contracts.md), validated + clamped
       └► render_preview(timeline)  — low-res from proxies, captions on  → preview.mp4 (S3)
            └► critique_preview(preview) — Spark watches the preview, scores hook, pacing,
                 continuity, captions, length (0–10 each) with timestamped notes
                 └► revise (max 2 revisions) → render_preview → critique …
  keep the version with the best total score; stop on: score ≥ threshold, 2 revisions,
  12 tool calls, or 150 s wall clock
```

Tools exposed to Spark: `search_moments(query, filters)`, `get_segment(id)`,
`render_preview(timeline)`, `critique_preview(preview_id, focus)`, stretch
`track_subject(segment_id, subject)`. Every step (tool call, arguments, result summary, cost)
is stored in `agent_steps` and streamed to the PWA over Server-Sent Events.

Rendering (revised 2026-10-27): one Remotion composition (`render/src/composition/`) defines how a
short looks. The PWA plays it instantly with `@remotion/player` for human edits; the `renderer`
container renders the same composition to MP4 — 540-wide previews from proxies for the agent's
critique, 1080-wide finals from originals → `previews/…` / `renders/{short}.mp4` → presigned
download. Rust builds the props (clamped timeline + phrase captions + presigned URLs) and calls the
renderer through the `Renderer` port. Details: `docs/phases/06-timeline-render.md`.

Guardrails: clamp every `in`/`out` to its segment bounds; drop clips shorter than 0.6 s; total
length within ±20 % of `target_seconds`; centre crop if tracking fails; captions from transcript
only (never invented text).

## Auth

One demo account. The API issues a signed session cookie on `POST /api/session` with a shared demo
passcode from env. Every S3 key starts with `users/{user_id}/`, and every handler checks the clip or
short belongs to the session user before presigning anything. That is the whole auth story; no
time spent beyond it.

## Deploy

Local: `docker compose up --build` (api, caddy serving web build; `./data` volume for SQLite +
Tantivy + model cache). Phone testing in dev: `cloudflared tunnel --url https://localhost` quick
tunnel, or the deployed box.

Event deploy (Phase 8): Terraform creates one EC2 `t4g.large` (arm64, 2 vCPU, 8 GB) with a 30 GB gp3 EBS data
volume, an Elastic IP, a security group (80/443 open, 22 from the owner's IP), and an instance role
scoped to the bucket. The arm64 image is built natively on the Mac, shipped with
`docker save | ssh … docker load`, and started with compose. Caddy gets a Let's Encrypt cert for
`<elastic-ip-dashed>.sslip.io` (no DNS purchase). Everything is destroyed after judging.

### Running on one machine (judge stack, 2026-10-31)

`make judge` runs `docker-compose.yml` plus `docker-compose.judge.yml`: SeaweedFS (S3 API on
`storage:8333`, a one-shot container creates the `nimbytes-media` bucket), Caddy on plain HTTP at
`http://localhost:${NIMBYTES_PORT:-8080}` (`Caddyfile.judge`, which also passes `/nimbytes-media/*`
through to SeaweedFS), the api with `STORAGE_PROVIDER=local`, and the renderer sharing Caddy's network
namespace. The api's S3 client calls `LOCAL_S3_ENDPOINT` (`http://storage:8333`); a second client
signs presigned URLs for `LOCAL_S3_PUBLIC_URL` (`http://localhost:8080`), so the browser and the
renderer fetch media on the app's origin, and the Host header Caddy keeps matches the signature.
Meta calls send media as data URLs, so no part of the stack must be reachable from outside.
The converted Perception Encoder comes from the `models-v1` GitHub release (SHA-256 checked); the
web app is built in a `node:22` container. Only `MODEL_API_KEY`, `DEMO_PASSCODE` and
`SESSION_SECRET` come from `.env`.

## v1.0.0 additions (2026-10-27)

- **Duplicates:** the probe step streams a SHA-256 of the local original into `clips.content_sha256`.
  When another clip of the same user has the same hash, the newer one is marked `duplicate`
  (`duplicate_of` = older): the ingest stops before any model call, or the copy's search docs and
  vectors are removed. `POST /api/uploads/check` warns before upload; `DELETE /api/clips/{id}`
  removes rows, S3 objects, Tantivy docs and vectors.
- **Face matching (opt-in, `users.face_matching`):** PE embeds each kept face crop into `face_vectors`
  (vec0, user partition). Pairs at cosine ≥ `PROPOSE_MIN` go to Muse Spark with both crops as
  `input_image` (`api/prompts/face_match.md`). Only Spark-confirmed pairs form groups or suggestions.
  Turning it off deletes the vectors.
- **Clip titles:** a text-only Spark step after `describe`; ready clips are backfilled at worker start.
- **Session check:** `GET /api/session`; the PWA draws nothing but the background until it answers.
- **Logo:** one geometry source, `render/src/composition/LogoMark.tsx`, used by the PWA (alias
  `@nimbytes/logo`) and the render end card. Drift tests pin the icon SVGs to it.
