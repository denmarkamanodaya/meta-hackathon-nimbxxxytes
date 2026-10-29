# Positioning

How nimbytes differs from what POV creators use today. Source of the demo video's claims and the
README "What's different" section (Phase 9). Keep claims to what is built on `main`.

| Area | Typical tools today | nimbytes |
| --- | --- | --- |
| AI editing | Generate and lightly adjust | Agentic editor that critiques and revises its own cut, with the reasoning shown |
| Storage | Phone fills up, or a plain cloud folder | Footage lives in S3 (Sydney), tiers itself to save cost, and still browses like it is on the phone |
| AI cost | Every question re-runs the model | Every Meta model answer is cached by its input: repeats cost $0 and return instantly |

Each row must map to a built feature:

| Row | Built in | Shown in the demo at |
| --- | --- | --- |
| AI editing | Phase 7 (agent loop 7.2–7.7, reasoning trail 7.8) | 0:25–1:20 (`docs/demo-video.md`) |
| Storage | Phases 1, 4 (multipart upload, tiering, cache headers, hourly-stable signed URLs) | 2:20–2:40 |
| AI cost | Phase 3 (`model_cache` table, one `MetaClient`) | 1:20–1:55 (search) and 2:40–3:00 (cost line) |

## Smart storage and caching: pitch points (all built, 2026-10-27)

| Layer | What it does | Evidence | Pitch line |
| --- | --- | --- | --- |
| Direct-to-S3 media | The phone uploads and plays straight from S3 with presigned URLs; the server never proxies video bytes | `adapters/src/s3.rs` | "Your video never queues behind our server." |
| Light proxies | Playback, search and the editor use 720p proxies; full-size originals are read only for the final render | ingest pipeline, renderer props | "Browse in 720p, export from the original." |
| Browser media cache | Every derived file (proxy, thumbnail, face crop, render) is written with `Cache-Control: private, max-age=31536000, immutable`; GET URLs are signed as of the start of the UTC hour, so the URL, and the cache entry, stay the same all hour | `core/src/keys.rs` `DERIVED_CACHE_CONTROL`; unit tests in `adapters/src/s3/tests.rs`, `testkit/tests/ingest.rs` | "Watch it once, it replays from your phone." |
| App shell cache | Service worker precaches the shell, so the installed PWA opens instantly and offline; never caches `/api/*` or S3 media | `web/public/sw.js` | "Opens like a native app." |
| AI answer cache | Every Meta model call is keyed by a hash of its input in `model_cache`; repeats are free | `adapters/src/sqlite/ledger.rs`; search p50 3.6 s cold vs 0.06 s cached (measured 2026-10-27) | "Ask twice, pay once: the second search is 60x faster and free." |
| Self-tiering storage | Originals move to S3 Intelligent-Tiering on day 0 (cheaper when not watched); agent preview MP4s expire after 7 days; unfinished multipart uploads are cleaned after 1 day | `infra/modules/storage/main.tf` lifecycle, tag `nimbytes-class` | "Storage that gets cheaper the less you watch." |
| Cost visible | `GET /api/costs` + cost line in settings | ≈ $0.11 per clip end to end (measured 2026-10-27) | "About 11 cents a clip, everything included." |

## nimbytes for Mac: zero bytes on disk and the smart cache (built 2026-10-27, Mac 1.1.0)

| Layer | What it does | Evidence | Pitch line |
| --- | --- | --- | --- |
| Zero bytes on disk | `~/nimbytes` is a drive the app serves itself (NFS v3 on 127.0.0.1). Every clip and short shows at full size, but Finder's "on disk" stays 0 until something reads it; only the 1 MiB pieces read are kept. Finder previews pass through without storing anything. Works in Finder, QuickTime and editors. | `desktop/src-tauri/src/adapters/nfs_drive.rs`, `adapters/chunk_cache.rs`. Live check: `fileAllocatedSize` 0 before play and after a preview read; a full read was byte-identical (sha256) | "Your whole library in Finder. Zero bytes on your Mac." |
| Smart cache: space-based release | The cache has a cap (5 GB default) and shrinks on its own whenever the Mac's free disk drops below 15%. Plain footage goes first, least recently used first; footage used in shorts and editor projects goes last. | `core/drive.rs` `evictions`, `cache_budget`; `services/drive.rs` `evict`; unit tests plus mutation checks | "It never fights you for disk space." |
| Smart cache: time-based release | Anything not read for 3 minutes is freed on the next 30 s check. | `core/drive.rs` `IDLE_MS`, `idle_keys` | "Watch it, and it's gone from your disk minutes later." |
| Keep what you choose | "Make available offline" keeps a clip's every piece and is never released by either rule. | `Keep::Always` in `core/drive.rs` | "Pin what you need offline; everything else lets itself go." |
| Mac does the heavy lifting | During upload the Mac makes the 720p proxy with its hardware media engine (`avconvert`) and sends it along, so the server skips its software encode. Upload is resumable multipart. | `desktop/src-tauri/src/services/exports.rs` `start_proxy`; api `domain/proxy.rs` | "5.5 minutes of camera-original footage: the proxy takes 18 s on your Mac instead of 9.5 min on our server." (measured 2026-10-27, 327 s HEVC 10-bit at 83 Mbit/s) |

Demo beat (true story, 2026-10-27, keep the numbers generic in public): a played clip left about
40 MB in the cache. When the Mac's free disk dipped under 15%, the cache released it on its own and
"On this Mac" went back to 0, with no user action. Show "On this Mac" before and after playing a
clip, then after the 3-minute release.

Do not say: "never downloads anything". Playing a clip does fetch its pieces; they are released
afterwards. Say "zero bytes on disk until you play it".

> **Stale rows above (after the R2 move, 2026-10-27):** "S3 (Sydney)", "Direct-to-S3" and "Self-tiering
> storage (S3 Intelligent-Tiering)" no longer match the build. Media is on Cloudflare R2, Standard
> class only, with no tiering. Re-word these rows before the README and the video.

### "Cloud media that feels local": what we may and may not say

Owner-approved wording (2026-10-27):

> Can we say "we use our media in the cloud like local"? Not as worded. First playback needs the
> network, and the phone can clear its cache. Pitch this instead: **"Lives in the cloud, browses
> like it's on your phone."** What backs it:
> - 0 GB is stored on the phone.
> - Clips play from light 720p copies streamed straight from S3.
> - A repeat search took 0.06 s and cost $0.
> - Thumbnails replay from the phone's cache.


Say: **"Lives in the cloud, browses like it's on your phone."** Thumbnails, search and repeat
playback are instant; clips start from light 720p proxies; nothing is stored on the phone.

Do not say: "works offline", "same as local", "zero latency". Media needs the network on first
view, and the browser cache can evict.

Before the video, measure on the iPhone against the deployed box and fill in:
- time to first frame for a proxy, first view: ‹ › s; repeat view: ‹ › s
- whether iOS Safari serves the repeat from cache (Safari Web Inspector, Network tab). Safari
  plays video with HTTP Range requests and may not reuse cached 206 responses; if it does not,
  drop "replays from your phone" for video and keep it for thumbnails and face crops.

