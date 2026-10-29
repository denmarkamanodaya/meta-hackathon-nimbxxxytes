# Phase 2 — Media prep and transcript

**Day:** Wed 28 Oct (afternoon) · **Depends on:** Phase 1 (clips in S3, job queue)

## Goal

Turn each uploaded original into everything the models need: an upright 720p proxy, a 1 fps copy for
SAM, a 16 kHz mono WAV, segments with thumbnails and 360p snippets, and a speaker-labelled
transcript attached to segments. Every step is resumable and visible in the PWA.

## Tasks

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 2.1 | `FfmpegMediaTool`: `probe` (ffprobe JSON → duration, fps, rotation incl. display matrix side data, codec, `creation_time`) | api | All child processes get a timeout from `composition.rs` |
| 2.2 | `make_proxy`: 720p (long edge 1280), CFR 30, H.264 `veryfast` CRF 23, AAC, `+faststart`, rotation applied | api | Upload to `proxies/{clip}_720p.mp4` |
| 2.3 | `make_sam_fps1`: 1 fps, long edge 640, H.264, no audio | api | Input to SAM in Phase 3 |
| 2.4 | `extract_wav`: `-ac 1 -ar 16000 -c:a pcm_s16le`; split into ≤ 9.5 min chunks if longer (offsets added back) | api | Voice Transcribe limits in `docs/meta-api.md` |
| 2.5 | `scene_cuts`: `select='gt(scene,0.3)',metadata=print` or `scdet`; parse cut times | api | Spike 0.6 picks the filter |
| 2.6 | `core::segmenting` (pure): cut points + duration → windows of 5–10 s (target 7 s), merging slivers < 2 s into neighbours | api | Pure function, easy to reason about |
| 2.7 | Thumbnail (middle frame, 640 wide JPEG) + 360p snippet mp4 per segment | api | `thumbs/…`, `snippets/…` |
| 2.8 | `Transcriber` via `MetaClient`: multipart POST, `mode: DIARIZATION`; map turns → `transcript_turns`; create `speakers` rows ("Speaker 1", …) | api | Cache by WAV hash |
| 2.9 | Attach turns to segments by time overlap (`segment_turns`) | api | Pure function in `core` |
| 2.10 | `MetaClient` base: request hashing, `model_cache` lookup, `model_calls` cost row, retry (2×, jittered) on 429/5xx, per-model timeout | api | Prices from `api/config/prices.toml` |
| 2.11 | `GET /api/clips/{id}/events` SSE from job step changes | api | |
| 2.12 | Library card shows live step ("making proxy… transcribing…") from SSE | web | |

## Unit tests

| Test | Covers |
| --- | --- |
| ffprobe JSON fixtures (HEVC portrait with display matrix, H.264 landscape, missing `creation_time`) → correct duration, rotation, recorded_at | 2.1 |
| ffmpeg argument builders for proxy / fps1 / WAV / snippet / thumb produce the expected argv (no process spawned) | 2.2–2.4, 2.7 |
| One smoke test per builder on a 2 s `lavfi` test pattern (generated in the test) checking output codec/fps/sample rate with ffprobe | ffmpeg flags actually work |
| `scdet` output fixture → cut times | 2.5 |
| `core::segmenting`: no cuts, many cuts, slivers < 2 s merged, last window, windows always 5–10 s except the last | 2.6 |
| WAV chunk offsets: turns from chunk 2 shifted by chunk start | 2.4 |
| Transcribe: outgoing multipart has `request` JSON with `mode: DIARIZATION` and an `audio` part; response fixture → turns + speakers | 2.8 (assert the wire format) |
| Turn ↔ segment overlap join, including turns spanning two segments | 2.9 |
| `MetaClient` with a fake HTTP server (`wiremock`): cache hit skips HTTP; 429 then 200 retries once; cost row computed from `prices.toml` | 2.10 |
| Ingest use case with fakes: crash after step N → resume runs only steps > N | resumability |

## Acceptance checks

- [ ] Each sample clip (HEVC portrait, H.264, multi-speaker) produces an upright proxy that plays in
      iOS Safari.
- [ ] Segments are 5–10 s except the last; every segment has a thumb and a snippet in S3.
- [ ] Transcript turns have speaker labels; `model_calls` shows one transcribe row per clip with
      `audio_s` and `cost_usd`.
- [ ] Kill the api mid-ingest, restart: job resumes at the recorded step; no duplicate model call
      (second run is a cache hit).
- [ ] Gates pass.

## Risks

- Rotation metadata differs between HEVC (display matrix) and older tags; test the portrait sample.
- Long clips: Ray-Ban captures are short (≤ 3 min), but the chunking in 2.4 keeps us safe.
