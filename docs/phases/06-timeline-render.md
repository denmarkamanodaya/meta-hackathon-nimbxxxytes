# Phase 6 — Timeline, Remotion composition, instant preview, render

**Day:** Sat 31 Oct · **Depends on:** Phase 5 · **Milestone: full loop working**
**Revised 2026-10-27 (owner):** rendering moves from ffmpeg + ASS burn-in to **Remotion**, run in a
renderer container on the app box (no Lambda); the PWA previews timelines instantly with the
**Remotion Player**. Uploads stay on our own multipart code (Uppy rejected: already built and
proven). ffmpeg stays for ingest only (probe, proxy, fps1, WAV, scene cuts, thumbnails, snippets).

## Goal

Selected moments become a timeline (first from a single Spark planning call, before the agent loop
exists). The user previews it **instantly in the browser** (no render), can reorder / drop / trim
it, and the server renders a post-ready 4:5 or 1:1 MP4 with animated phrase captions from the
**same composition** the Player shows. What you see in the editor is what gets rendered.

## Why Remotion (and what it does not change)

- One React composition is the single source of how a short looks. The Player (browser) and the
  renderer (server) both run it, so preview and final cannot drift.
- Creator-grade captions: animated phrase captions (pop-in, active-word emphasis estimated within
  the phrase) instead of static ASS subtitles. Timing is still phrase-level: Voice Transcribe has no
  word timestamps (owner ruling stands); per-word emphasis is spread across the phrase by length.
- The agent still needs a **real MP4** for Muse Spark to watch in `critique_preview`, so the renderer
  produces low-res preview MP4s (540 wide) for every agent version. The Player makes the *human*
  preview free, not the agent's.
- Licence: Remotion's free licence covers individuals and companies of up to 3 people (re-check the
  exact text on remotion.dev before submission and record it in README "Third-party").

## Architecture

```
web (PWA)  ── @remotion/player ──► <NimbytesShort timeline captions media/>   (instant preview)
                                          ▲  single source: render/src/composition/
api (Rust) ── RemotionRenderer adapter ──► renderer (Node, @remotion/renderer, in compose)
               POST /render {props, out_url}     └► renderMedia → MP4 → PUT to presigned S3 URL
```

- New package **`render/`** (Node + TypeScript, Remotion). Holds the composition
  (`src/composition/`), its props type and a Zod schema for the props, and a tiny HTTP server
  (`src/server.ts`): `POST /render` → validates props → `renderMedia` → uploads to the presigned PUT
  URL it was given → returns `{ duration_s, bytes }`. One render at a time (queue in Rust), timeout
  set by the caller.
- The web app imports the composition from `render/src/composition/` through a path alias
  (`@nimbytes/composition`); there is no second copy (DRY).
- Rust keeps orchestration: `Renderer` port in `core::ports` with `render(props, quality) ->
  RenderOutput`; adapter `RemotionRenderer` (HTTP to `RENDERER_URL`) replaces the ffmpeg render path.
  Props are built in Rust from the timeline (`core::timeline` clamps) + phrase captions
  (`core::captions`) + presigned media URLs; Rust owns the props wire type, `render/` validates it
  with Zod, and a contract test on both sides checks one shared fixture
  (`render/fixtures/props.sample.json`).
- Media inputs: presigned GET URLs of the **720p proxies** (preview) and **originals** (final),
  with `<OffthreadVideo>` + `startFrom`/`endAt` per clip. Crop to 4:5 / 1:1 by CSS
  `object-fit: cover` + `punch_in` scale; centre crop unless a tracked box exists.
- Container `renderer`: `node:22-bookworm-slim` arm64 + Chrome Headless Shell Linux deps (Debian
  list from the Remotion docs) + bundled composition. Added to `docker-compose.yml`; only reachable
  on the compose network.

## Tasks

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 6.1 | Timeline types in `contracts` + `api/prompts/timeline.schema.json` (shape in `docs/contracts.md`) | api | Done in prompts; wire types in contracts |
| 6.2 | `core::timeline` (pure): validate, clamp `in`/`out` to segment bounds, drop < 0.6 s, fit length to `target_seconds` ± 20 % | api | Returns the clamps applied |
| 6.3 | `Reasoner::plan_edit` (Spark, `api/prompts/plan_edit.md`, effort low, per-call segment enum) → timeline + post caption + hashtags + rationale | api | Single call; agent loop in Phase 7 |
| 6.4 | `core::captions` (pure): turns overlapping each clip → phrases of 3–5 words spread across the turn by character count → shifted onto the output timeline; per-word emphasis offsets within each phrase | api | Feeds composition props |
| 6.5 | **`render/` package**: Remotion project (exact pins), `NimbytesShort` composition (Sequence per clip, OffthreadVideo trimmed, aspect crop + punch-in, animated phrase captions in safe area, optional end card with post caption), props Zod schema, `src/server.ts`, Dockerfile, `npm run studio` for local design | web | Load the `remotion:*` skills first. Design must match the PWA tokens (fonts, accent) |
| 6.6 | `Renderer` port + `RemotionRenderer` adapter + render job kind `render`: preview (540 wide, CRF-ish fast, from proxies) and final (1080 wide, from originals) → `previews/{short}/v{n}.mp4` / `renders/{short}.mp4`; props builder in Rust | api | Timeouts in composition root; `RENDERER_URL` env |
| 6.7 | Endpoints: `POST /api/shorts` (plan only for now), `GET /api/shorts/{id}`, `PUT …/timeline`, `POST …/render`, `GET …/download` (shapes in `docs/contracts.md` "Shorts") | api | `GET /api/shorts/{id}` also returns `composition_props` per version for the Player |
| 6.8 | Editor: replace the preview placeholder with **`@remotion/player`** fed by `composition_props` (instant, re-renders on every edit: reorder / drop / trim previews live before saving); keep the server preview MP4 for the agent trail; Render final → download / share | web | iOS Safari: test multiple trimmed proxies in one Player |
| 6.9 | Compose + deploy: `renderer` service in `docker-compose.yml`; `scripts/deploy.sh` builds and ships its arm64 image too | lead | |

Wire addition (record in `docs/contracts.md` when built): each `versions[]` item in
`GET /api/shorts/{id}` gains `composition_props` (the exact props the renderer received, with
presigned proxy URLs, 1 h).

## Unit tests

| Test | Covers |
| --- | --- |
| `core::timeline`: clamp in/out (and report each clamp); drop < 0.6 s; length fit; unknown segment id rejected | 6.2 |
| `core::captions`: phrase split 3–5 words; time spread by characters; shift across clip boundaries; empty transcript → no captions; emphasis offsets inside the phrase | 6.4 |
| Props builder (Rust): timeline + captions + URLs → props JSON equals `render/fixtures/props.sample.json` | 6.6 wire |
| `render/`: Zod accepts the shared fixture, rejects bad aspect / negative times; frame maths (clip start frames, total duration in frames at 30 fps); caption visibility at given frames | 6.5 |
| `render/` server: `POST /render` with an invalid body → 400; valid body calls `renderMedia` (mocked) with the right composition id, codec h264, dimensions per aspect | 6.5 |
| `RemotionRenderer` adapter against a fake HTTP server: request body, timeout → `RENDER_FAILED` | 6.6 |
| One smoke render (feature-gated, local only): 2 lavfi clips → 2 s preview MP4 exists, h264, 540×675 | flags work together |
| Web: Player receives props from the version; edits update props without a request | 6.8 |

## Acceptance checks

- [ ] From a search, select 4 moments → plan → the Player shows the cut instantly; reorder / trim
      updates the preview immediately with no server round trip.
- [ ] Render final: a 4:5 MP4 of about the target length plays on the iPhone; captions animate and
      stay in sync within a phrase; it looks the same as the Player.
- [ ] 1:1 output also correct.
- [ ] Out-of-range `in`/`out` from the model are clamped and the clamp is visible in the step log.
- [ ] Gates pass (api, web, render).
- [ ] **Full loop demo recorded on the phone as a backup clip** (upload → search → name → short).

## Risks and fallbacks

- Remotion renderer on Linux arm64 in Docker unproven → spike it first thing Sat (30 min): render
  the sample composition in the container. Fallback: ffmpeg render path from the original plan
  (cut/crop/concat + ASS phrase captions) behind the same `Renderer` port.
- Render time on 4 vCPU too slow for the agent loop (> 30 s per preview) → lower preview to 360
  wide / 24 fps first; Remotion Lambda (Sydney is supported) is the later upgrade, not this week.
- iOS Safari Player with several `<OffthreadVideo>`/`<Video>` sources → if it stutters, preview the
  current clip only while scrubbing and play the server preview MP4 for full playback.
