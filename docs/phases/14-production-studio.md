# Phase 14: Production Studio (analysis and phased plan, for owner review)

Source brief: `~/Downloads/nimbytes-studio-prompt.md` (owner, 2026-10-27). The brief was written
against the v1.0.0 snapshot. This doc checks it against the code on `main` today, lists pros and
cons, names the rule conflicts the owner must rule on, and proposes the phases. **No code is
written until the owner approves this doc.**

Pitch it makes true: *"An AI production studio for your glasses footage: plan it, shoot it, cut it,
publish it."*

## 1. Verdict

Feasible, and the strongest pitch addition left. Most of it reuses what is built: search, the
agent short loop, the renderer, People & pets and the share service. Two parts carry most of the
risk:

- **Muse Image.** `muse-image-1.0` exists (dev.meta.ai docs: `/v1/images/generations` and
  `/edits`; base64 or signed URL). Its request fields, reference anchoring and price are **not
  verified**, so it needs a spike first.
- **Privacy blur in renders.** A blur overlay in headless Chromium on a 2-vCPU box may make renders
  much slower, so it needs a measured spike.

The full MVP is about 6 tables, about 15 endpoints, 7 screens, a new model and render changes. On
the 8 days left to 4 Nov that is tight next to the demo video, README and submission. The plan
below orders it so each phase ends in something demoable, and cuts from the end.

## 2. Drift: brief vs current code

| Brief says | Code today | Effect |
| --- | --- | --- |
| Migration `0008_productions.sql` | `0008_faces_job.sql` shipped today | Use **0009** |
| `jobs.kind` is `ingest\|render\|agent`, never alter | Already `ingest, render, agent, title, hash, face_vectors, faces` (0005, 0006, 0008) | The "don't alter jobs" rule still stands: productions run as tokio tasks, as the brief says |
| Face boxes "not persisted"; tracks = SAM ordinals | Since today (3237c90) a track is a **continuous run** of one SAM object. Tracks are rebuilt from SAM's cached answer by the `faces` job | Box persistence fits better: one track = one person's boxes. Backfill = re-run the existing `faces` job (`queue.restart`), $0 SAM (cache hit, verified today). No new job kind and no `jobs` change |
| Storage is S3 | Cloudflare R2 (Standard only); `BlobStore` unchanged | No effect; `presign_put` works on R2 (used today for Mac proxies) |
| "Mist: light only" | PWA light only. The Mac app (same web code) now has the Midnight dark theme via tokens | New screens use tokens only, so they work in both. No hex in CSS (the theme test enforces it) |
| Mac app "leave untouched" | The Mac app renders the same web pages, its sidebar has Shorts, and the Library is the search | New pages appear in the Mac app for free. **Web Share is not available in the Mac app's WebKit window**, so Publish on Mac falls back to download / "Reveal in Finder" |
| `Aspect` 4:5 / 1:1 | `Aspect { Portrait, Square }` in `core/domain/timeline.rs`, used across api, contracts and render | Adding `9:16` to the shared enum touches every match. Recommend a separate `ExportAspect` (see 4) |
| Share via existing share service | `web/src/services/share/share-video.ts` (Web Share level 2) | Reuse as is |
| Renders: existing renderer + limits | t4g.large, `RENDER_CONCURRENCY=2`, ~5 GB renderer memory | Exports add renders. Share one 9:16 render across TikTok, Reels and Shorts (see 4) |

## 3. Rule conflicts the owner must rule on

| # | Brief | Repo rule | Recommendation |
| --- | --- | --- | --- |
| R1 | "Do not write new tests" | `CLAUDE.md` rule 4: unit tests for every pure rule, parser, use case and handler, in the same commit | **Keep unit tests for pure rules and parsers only** (props builder, blur box maths, act ordering, coverage selection, Muse Image parser). Today's 4 bugs (upload expiry, mount hang, face grouping, the 0-bytes tile) were all seams. Skip handler and UI tests if speed matters |
| R2 | "No mockups: section 3 is the spec" | Rule 11: mock first on the design canvas, then build exactly what was approved | Either waive rule 11 for this feature, or do **one mock pass for screens 3 and 6** (shot list and Publish), the two the demo shows |
| R3 | Story cut "through the existing agent unchanged" with the act order in the prompt | The agent planner may reorder shots: the prompt asks, it does not force | Accept: a soft order through `story_brief.md`, checked in the critique. If the order matters for the demo, a small optional `locked_order` flag on the planner input would change agent behaviour, which the brief forbids. Owner call |
| R4 | Coverage runs "the existing search use case" per shot | Search = Spark rewrite + local hybrid + Spark rerank (~4 s and ~$0.003 per query) | Use the **local stage only** (BM25 + PE, under 100 ms, $0) for candidates, then **one batched** `coverage_match` call for all shots: 1 Spark call, not about 36. Same Meta-first quality, much faster |

## 4. Design choices (recommended)

- **9:16 as `ExportAspect`.** A new enum `{ Portrait4x5, Square, Vertical9x16 }` for exports only.
  `Aspect` and its CHECK stay untouched, so create-short and save-timeline can never accept 9:16.
  Zod gets `"9:16"` as an optional extra value on a separate export props field; the existing
  fixtures stay valid.
- **One 9:16 render for three platforms.** TikTok, Reels and Shorts share the same 9:16 MP4;
  only captions, hashtags and covers differ. Feed reuses the short's existing best render (no new
  render). That is 1 export render per short, not 4.
- **Face boxes** are written by the faces step (now one track per person-run), normalised 0–1 at
  1 fps, idempotent (delete and insert per clip). Backfill = restart the `faces` jobs.
  **Ask before running on the server.**
- **Blur** draws in the Remotion composition from the optional `blur` props. Spike both options
  (`backdrop-filter` vs a blurred duplicate video under a clip-path) on the box. Pick the one that
  adds the least render time. If both add more than about 2x, blur previews at a lower resolution
  and keep full quality only for exports.
- **Muse Image** goes through the one `MetaClient` (cache by input hash, ledger cost line). Its
  price goes in `config/prices.toml` only after the spike confirms it.
- **Background work** runs on tokio tasks per production, with status in `productions.status` and
  progress through `BroadcastProgress`. At start, `planning` becomes `failed` with Retry. Up to 4
  boards at once.
- **Status words.** "Published" means the owner shared or downloaded it. Nothing posts to
  platforms.

## 5. Pros and cons

| Pros | Cons and risks |
| --- | --- |
| A big, visible pitch upgrade: planning to publish, all on Meta models (Spark, Muse Image, SAM, Transcribe, PE) | Large scope for 8 days next to the demo video, README and submit |
| Reuses most of what is built: search, the agent loop, the renderer, people, share, SSE | Muse Image is unverified (request shape, anchors, price), so a spike comes first |
| Coverage turns the library into "what's still missing", which fits glasses footage | Blur in headless Chromium on 2 vCPU may slow renders a lot; needs measuring |
| Privacy blur is a strong, honest trust feature that reuses SAM boxes at $0 | More renders on the same small box. Shared 9:16 and a reused Feed render keep it to 1 extra render per short |
| Additive: new tables and routes, existing flows untouched | The act order in the agent is only asked for, not enforced (R3) |
| Cost stays small and visible in the ledger | Coverage on the full search path is slow and costly; the local stage plus one batched call is needed (R4) |
| | Mac: no Web Share in its window, so Publish falls back to download |

Rough cost per production:
- shot list: 1 Spark call;
- boards: up to 12 images × Muse Image price (brief says $0.01, to verify);
- coverage: 1 Spark call per check;
- story cut: the existing agent (~$0.05);
- publish: 1 Spark call and 12 covers;
- export: 1 render.

That is roughly **$0.30–0.40 per production** if the image price is $0.01.

## 6. Phases (each ends demoable; gates as `CLAUDE.md`, local commits, no push)

| Phase | Deliver | Owner checkpoint |
| --- | --- | --- |
| **14.0 Spikes (≤ 3 h)** | (a) Muse Image: generate + reference-anchored, request and response shape, price; a recorded fixture. (b) Blur render: both overlay methods on a 20 s 4:5 render on the box; time and look | Owner sees 2 sample boards and a blurred frame; approves the image cost |
| **14.1 Data + contracts** | Migration 0009 (brand_kits, productions, production_shots, face_boxes, short_finish, short_exports), keys, contracts, TS mirror, Muse Image adapter, 4 prompt pairs | — |
| **14.2 Plan + coverage** | `POST/GET /api/productions`, SSE events, shot list (Spark), boards (Muse Image, 4 at once), coverage (local hybrid + one batched `coverage_match`), recheck, retry. Web: Shorts \| Productions switch, New production, Shot list and coverage (mock fixtures first) | **Demo 1:** brief → shot list with boards → covered and missing |
| **14.3 Story cut** | `POST /api/productions/{id}/cut` through the existing create-short use case with `story_brief`; acts strip and "Director's notes" on the short page; Finish button | **Demo 2:** cut the story |
| **14.4 Privacy blur** | Face boxes written in the faces step; backfill by restarting `faces` jobs (**ask before running**); optional `blur` props; overlay in the composition; `GET/PUT /api/shorts/{id}/finish`; Finish screen | **Demo 3:** hide a face, see it blurred; switch it off |
| **14.5 Brand kit** | `GET/PUT /api/brand`, upload presign, theme mapping, anchors for boards and covers; Brand kit sheet (Settings + New production) | Owner sets a kit, renders change |
| **14.6 Publish** | `ExportAspect` 9:16 composition, one shared 9:16 render, `platform_pack` (one Spark call), 3 covers per platform, `/exports` endpoints, Publish screen with share (download on Mac) | **Demo 4:** publish pack on the phone |
| **14.7 Stretch + README** | In order: opening title card, speaker colours, try 3 hooks, subject effect. README "Production Studio" section; positioning rows | Cut from the end if late |

Parallel work (dk-agents): 14.2 web screens against mock fixtures while 14.1–14.2 backend runs;
render work (9:16 + blur) alongside 14.2–14.3.

## 7. Owner decisions (ruled 2026-10-27)

- R1: core rules and parsers only.
- R2: backend first, screens after the redesign mocks.
- R3: ask only. Re-confirmed after a real cut (agent reused a moment, dropped a shot, added its own); the acts strip shows "not in plan" and missing shots.
- R4: local + 1 batched call.
- 14.0a Muse Image spike done: $0.01 per image, about 15 s each; facts in docs/meta-api.md.
- 14.0b blur spike moves into 14.4.

### Original questions

1. R1 tests: keep unit tests for pure rules and parsers (recommended), or none?
2. R2 mocks: waive rule 11, or mock screens 3 and 6 first?
3. R3 act order: soft (prompt only, recommended), or allow an optional planner flag?
4. R4 coverage: local stage + one batched Spark call (recommended)?
5. Spikes 14.0: go (Muse Image costs a few cents)?
6. If time runs short, cut from 14.7 backwards, then covers (one cover for all platforms), as the
   brief says.
