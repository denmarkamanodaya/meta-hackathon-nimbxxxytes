# Phase 10: nimbytes for Mac (DMG)

**Start:** 2026-10-27, after v1.0.0. **Brief:** `~/Downloads/nimbytes-mac-prompt.md`. This file is the
one source for the Mac plan; the brief's hard rules hold except where an owner ruling below overrides
them.

## Goal

A signed Mac app that:
- turns the cloud library into a real `~/nimbytes` folder that NLEs can use;
- runs the full nimbytes app in its window, with media played from disk;
- opens AI-made shorts as FCPXML timelines;
- uploads finished edits from `Exports/` back into the library.

```
~/nimbytes/
  Library/     720p proxies of every ready clip (app-managed, read-only)
  Originals/   full originals: pinned ("Make available offline") or auto (LRU budget)
  Projects/    FCPXML of AI shorts, media linked to the local files
  Shorts/      final rendered shorts
  Exports/     drop finished edits here; they upload, then move to Exports/Uploaded/
```

## Owner rulings (2026-10-27)

| Ruling | Overrides |
| --- | --- |
| **Full app in the window.** The Mac window runs the same web app (Search, Make a short, People & pets, Upload, Settings, every Meta model feature), plus a native Sync panel and a tray menu. Media plays from `~/nimbytes` when synced, otherwise from the cloud | Brief §4.2 (small native window) and §5 ("no other web changes") |
| **Unit tests for risky logic only:** FCPXML frame maths, manifest etag, naming, sync diff, eviction, upload resume, the new endpoints. No UI or e2e tests | Brief rule 4 ("no tests") |
| **Server:** develop against `https://localhost` (dev builds trust the local Caddy CA); the released DMG defaults to the judging server (t4g.large, owner yes at release) | – |
| **No notarization for now.** The DMG is signed with the Developer ID but not notarized; the first open is right-click → Open | Brief §6 (notarize, `stapler validate`) |
| The real dog copy was deleted (204; its 9 S3 objects went to 0) | – |

The brief's other rules stand:
- naming;
- no AI attribution;
- **additive only**: no change to existing routes, shapes, migrations, S3 keys, auth, ingest, search,
  agent, renderer or deploy;
- secrets stay out of the repo;
- ask before a release or deploy.

## Architecture

```
desktop/ (Tauri 2, universal-apple-darwin, id dev.denmarkamanodaya.nimbytes, macOS 13+)
  src-tauri/src/
    core/      sync diff, cache policy (pinned + LRU auto), file naming, FCPXML writer   (pure, tested)
    ports/     Http, Secrets, Watcher, Trash, Files, Clock
    adapters/  reqwest+rustls, keyring, notify, trash, std fs
    commands/  Tauri invoke surface used by the web desktop adapters
    tray.rs, main.rs (composition root)
  wire types: path dependency on ../api/crates/contracts (one source)
  frontend:   web/ built with `vite --mode desktop` into desktop/dist (no second UI)

web/src/core/ports: ApiTransport, MediaResolver
web/src/app/compose.ts chooses the adapters:
  PWA (unchanged): fetch to the same-origin /api; media URLs as given
  desktop: invoke('api_request' | 'api_stream') → Rust adds the nb_session cookie from the Keychain;
           MediaResolver → convertFileSrc(local path) when synced, else the cloud URL

api (new files only, plus route registration):
  GET  /api/sync/manifest              ready clips + shorts, etag, If-None-Match → 304
  POST /api/sync/clips/{id}/original   {url} presigned download, 404 if not owned or not ready
```

**Smart cache:**
- `Library/` holds every proxy.
- `Shorts/` holds every render.
- Originals are either pinned (never evicted) or auto (fetched for an NLE export, evicted LRU above a
  budget, 20 GB by default, set in the Sync panel).

**Feels local:** playback, scrubbing and the Remotion preview read from disk; only AI work (search,
the agent, naming) reaches the server and its Meta model pipeline and cache.

## Phases

| # | Phase | Teammate | Delivers | Gate |
| --- | --- | --- | --- | --- |
| 10.1 | Spikes (3 h) | desktop | S1 invoke transport + SSE through a Tauri Channel + Keychain cookie. S2 asset-protocol mp4 plays, seeks and serves Range in WKWebView. S3 Remotion Player on local asset URLs. S4 dev trust of the Caddy root CA. S5 universal build signed with the Developer ID. Verdicts go in `LEARNING.md` | each spike: works / limit / fallback |
| 10.2 | Sync API | api | `contracts/src/sync.rs`, `core/src/usecases/sync.rs`, `server/src/http/sync.rs`. Manifest: etag over ids, titles, sizes and statuses only (not URLs). URLs via `BlobStore::presign_get` + `keys::proxy_720p`; `object_size` for proxies. Original via `presign_download` | etag stability, 304, ownership and ready-only tests |
| 10.3 | Desktop scaffold | desktop | Tauri app, exact pins, the same clippy denies, server-URL first run, Keychain session, tray (status, Sync now, Open folder, Open window, Quit), icons from `web/public/icons`, `.gitignore` | clippy clean; app launches |
| 10.4 | Web desktop mode | web | `ApiTransport` + `MediaResolver` ports and adapters; `vite --mode desktop`; SW off in desktop mode; `/sync` panel; Short page "Open in Final Cut Pro", "Reveal FCPXML", "Reveal render"; PWA Settings row "nimbytes for Mac" (`VITE_MAC_DOWNLOAD_URL`, desktop browsers only) | existing web tests unchanged and green; both builds pass |
| 10.5 | Sync down + smart cache | desktop | 30 s poll + focus + Sync now, backoff, 401 → sign-in. `.part` + Range resume, size check, atomic rename, `chmod 444`, 2 at a time, re-fetch on 403. Pinned and auto originals with LRU. Cloud removal → Trash. Rename on title change. `state.json` | diff, naming, eviction and resume tests |
| 10.6 | Exports up | desktop | Watcher on top-level `Exports/` (mp4, mov, m4v); 5 s stable size; `uploads/check`; existing multipart (4 parallel, resumable); then `Uploaded/` + a notification | stability and resume tests |
| 10.7 | FCPXML bridge | desktop | FCPXML 1.10: formats, assets with `file://` media-rep (original if local, else proxy), frame-snapped rational times, a marker per shot with the AI's reason, plus critique notes. Open in Final Cut if installed, else reveal. Test path: **DaVinci Resolve** (installed) | frame snapping 29.97/30/60, escaping, paths, golden file |
| 10.8 | Build, docs, release | lead + desktop | `make desktop-dev`, `make desktop-dmg`; `desktop/.env.example` (names only); README "nimbytes for Mac" + `desktop/README.md`; signed universal DMG (no notarization). **Owner yes** for the judging box and for `gh release create desktop-v1.0.0` | `codesign --verify --deep --strict` |

Order:
- 10.2 runs alongside 10.1 + 10.3.
- 10.4 starts after the S1–S3 verdicts.
- 10.5 runs alongside 10.6.
- 10.7 comes after 10.5.

Cut order if short:
1. autostart;
2. notifications;
3. Shorts sync;
4. auto-original eviction;
5. local media in the window (falls back to cloud).

Never cut: sign-in, proxy sync, Exports upload, FCPXML, the full app in the window.

## Acceptance (owner checks by hand)

- [ ] The DMG installs and opens (right-click → Open, not notarized); sign-in survives a restart.
- [ ] A phone upload appears in `~/nimbytes/Library` within ~30 s of becoming ready.
- [ ] "Make available offline" downloads the original; a clip deleted in the PWA goes to the Trash.
- [ ] In the Mac window, synced clips play from disk (asset URL) and seek instantly; Search, Make a short and People all work.
- [ ] The FCPXML opens in DaVinci Resolve with media linked and markers showing the AI's reasons.
- [ ] A file dropped into `Exports/` uploads, moves to `Uploaded/` and appears in the PWA library.
- [ ] Everything that already shipped still works (PWA on https://localhost, existing endpoints, deploy script).

## Risks

| Risk | Fallback |
| --- | --- |
| SSE over invoke is awkward (S1) | Use the Tauri HTTP plugin's streaming fetch, or poll the existing events endpoints every 2 s in desktop mode |
| Asset protocol doesn't serve Range in WKWebView (S2) | Register a custom URI scheme handler in Rust that serves byte ranges from `~/nimbytes` |
| Remotion Player rejects local URLs (S3) | Use cloud URLs for the Player only; files on disk keep powering clip playback and NLEs |
| Unnotarized app blocked on another Mac | Document right-click → Open; notarize later when the owner allows |
