# Build Brief: nimbytes for Mac (additive feature)

You are adding a **macOS desktop companion app** to the existing `nimbytes` repo. The PWA, API, renderer and infra are already shipped and tested (v1.0.0). This is an **addition, not a redesign**: everything that exists keeps working exactly as it does today.

---

## 0. Hard rules (non-negotiable)

1. **Naming:** The product is `nimbytes`. Never mention any of my other products or earlier project names anywhere: code, comments, commits, branches, README, configs, UI, bundle ids.
2. **Coding standard:** Use `/dk-coding` for all code. Also follow the conventions already in this repo (see section 2).
3. **No AI attribution:** No `Co-Authored-By` trailers, no "Generated with Claude Code", no AI mentions in commits, PR titles, PR descriptions or code comments.
4. **Speed first, no tests:** Do **not** write new tests. I test manually. Do not delete or edit existing tests.
5. **Don't break what's shipped:** Before each commit, the existing workspace must still build and lint: `cd api && cargo clippy --workspace --all-targets -- -D warnings` and `cd web && npm run build`. (Linting and building only, not testing.)
6. **Additive only:** Do not change existing routes, request/response shapes, DB migrations, S3 key layout, auth, ingest, search, agent, renderer, infra or deploy behaviour. New code goes in new files and new routes. If an existing file must be touched, keep the change minimal (e.g. registering a new route or module) and tell me why. If you think a redesign is needed anywhere, **stop and ask**.
7. **Parallelism:** `/dk-agents` is allowed. Split independent work (e.g. backend endpoints vs. desktop app vs. FCPXML writer).
8. **New work only:** Write fresh code in this repo. Do not copy code from any of my other repositories.
9. **Ask first** before anything irreversible or costly: `terraform apply`, deploying to the server, creating a GitHub Release, deleting data, force-pushing.
10. **Secrets:** The repo is public. Never commit signing identities, Apple credentials, passcodes or `.env` values.

---

## 1. Why and what (the in-depth picture)

**Problem it solves.** The PWA is the capture-and-understand surface: phones upload Ray-Ban Meta clips, Meta models understand them, and search and the agentic editor work in the browser. Editors who want to finish a cut on their Mac can't use cloud clips in Final Cut Pro, Premiere or DaVinci Resolve today.

**The addition.** A small signed Mac app, **nimbytes for Mac**, that turns the cloud library into a real local folder:

```
~/nimbytes/
  Library/      720p proxies of every ready clip, auto-synced (app-managed, read-only)
  Originals/    full-quality originals, downloaded on demand ("Make available offline")
  Projects/     FCPXML of AI-edited shorts, media linked to the local files
  Shorts/       final rendered shorts (MP4), auto-synced
  Exports/      drop finished edits here → uploaded to nimbytes → appear in the PWA
    Uploaded/   files moved here after a successful upload
```

**End-to-end flow (demo story):**
1. Phone: upload glasses clips in the PWA (already shipped).
2. Mac: new clips appear in `~/nimbytes/Library` within ~30 s.
3. PWA: the agentic editor makes a short (already shipped).
4. Mac: "Open in Final Cut Pro" writes `Projects/<short>.fcpxml`. The AI's cut opens as an editable timeline with media already linked.
5. Editor refines, exports to `~/nimbytes/Exports/` → the app uploads it through the **existing** upload flow → it shows up in the PWA library like any clip (understood and searchable), ready to post from the phone.

**Design decisions (keep these):**
- **Sync folder, not a mounted filesystem.** Real files work natively in every NLE. File Provider and FUSE are out of scope.
- **One-way down + upload-only `Exports/`.** No two-way sync, so no conflict resolution. App-managed folders may be overwritten. Only `Exports/` flows up.
- **Proxies by default, originals on demand.** 3K originals are large.
- **Polling, not push.** Poll a manifest every 30 s (plus on "Sync now" and app focus) with an ETag, so it's cheap.
- **Reuse, don't fork.** The desktop Rust core depends on the existing `nimbytes-contracts` crate for wire types, so there's one source of truth and no drift.
- **The PWA stays the primary product.** Judges will use the PWA. The Mac app is a demo-video moment and an editor bonus.

---

## 2. What already exists (read before coding, don't redo)

Read these first and match their style:

- `README.md`, `Makefile`, `docker-compose.yml`, `Caddyfile`, `scripts/deploy.sh`, `.env.example`
- `api/Cargo.toml`: workspace, **exact version pins**, lints (`unwrap_used`/`expect_used`/`panic` denied, `missing_docs` warn), edition 2024, Rust 1.99
- Hexagonal layout in `api/crates/`: `core` (domain, ports, usecases), `contracts` (wire JSON types), `adapters`, `server` (axum handlers in `src/http/`, composition root in `src/composition/`)
- `api/crates/core/src/keys.rs`: the **only** place S3 keys are built (`original`, `proxy_720p`, `render`, …)
- `api/crates/core/src/ports/storage.rs`: `BlobStore::presign_get` and `presign_download` already exist
- `api/crates/server/src/http/mod.rs`: router; `auth.rs` (`CurrentUser` from the signed `nb_session` cookie); `session.rs` (passcode → cookie)
- `api/crates/contracts/src/{clips,uploads,shorts,session}.rs`: existing wire types
- `api/crates/core/src/domain/timeline.rs`: `Timeline`, `TimelineClip { segment_id, in, out, subject, punch_in, reason }`, `Aspect` (`4:5` = 1080×1350, `1:1` = 1080×1080)
- `web/src/design/tokens.css`: design tokens. Reuse them so the Mac UI matches the PWA
- Commit style: Conventional Commits with scopes (`feat(api): …`, `feat(web): …`, `chore(infra): …`). Use scope `desktop` for the new app.

Facts from the code to respect:
- Auth is a shared demo passcode → signed cookie `nb_session` (HttpOnly, Secure, SameSite=Lax, permanent). **No backend auth change needed**: the desktop app posts the passcode to `POST /api/session`, keeps the `nb_session` value in the macOS Keychain, and sends `Cookie: nb_session=<value>`.
- Presigned URLs live 1 hour (`URL_TTL`). Re-fetch on 403.
- Uploads accept only `mp4`, `mov`, `m4v` and go through `POST /api/uploads` → `POST /api/uploads/{id}/parts` → PUT parts to S3 → `POST /api/uploads/{id}/complete`, with `POST /api/uploads/check` for duplicates. **Reuse this unchanged for `Exports/`.**
- `GET /api/shorts/{id}` returns versions (each with a `Timeline`) and `segments` (each with `clip_id`, `start_s`, `end_s`). `GET /api/shorts/{id}/download` returns a presigned render URL.
- Clip statuses: `uploading`, `uploaded`, `processing`, `ready`, `failed`, `duplicate`. Sync only `ready`.
- S3 region in code is `ap-southeast-2`. Don't change it.

---

## 3. Backend additions (small, read-only, additive)

New files only: `api/crates/contracts/src/sync.rs`, `api/crates/core/src/usecases/sync.rs`, `api/crates/server/src/http/sync.rs`. Register them in the existing `mod`/router lists, the only edits to existing files. **No migrations.**

### 3.1 `GET /api/sync/manifest`
Owner-only (`CurrentUser`). Returns a full snapshot (the library is small, so no cursor or tombstones needed; the client diffs against local state):

```json
{
  "etag": "sha256-of-the-payload-without-urls",
  "clips": [
    {
      "clip_id": "…", "title": "…", "filename": "…", "ext": "mov",
      "size_bytes": 123, "duration_s": 12.4, "fps": 29.97,
      "width": 1440, "height": 1920, "recorded_at": "2026-10-27T01:02:03Z",
      "proxy_url": "presigned GET, 1 h",
      "proxy_size_bytes": 4567
    }
  ],
  "shorts": [
    {"short_id": "…", "prompt": "…", "aspect": "4:5", "status": "ready",
     "best_version": 2, "render_url": "presigned GET or null", "created_at": "…"}
  ]
}
```
- Only clips with status `ready`. Shorts newest first.
- Support `If-None-Match`: return `304` when the etag matches. Compute the etag from ids, titles, sizes and statuses only, **not** from URLs, which change hourly.
- Build presigned URLs with the existing `BlobStore::presign_get` and `keys::proxy_720p`. `proxy_size_bytes` via `BlobStore::object_size` (or omit if it slows the endpoint; the client can use `Content-Length`).

### 3.2 `POST /api/sync/clips/{id}/original`
Owner-only. Returns `{ "url": "…" }`, a presigned download of `keys::original(...)` via the existing `presign_download`, with filename `<title>.<ext>`. 404 if not owned or not ready.

Error handling, ownership checks and JSON shapes must follow the existing handlers (`ApiError`, `ErrorCode`). Never return another user's objects.

---

## 4. The Mac app: `desktop/`

### 4.1 Stack
| Piece | Choice |
| --- | --- |
| Shell | **Tauri 2** (Rust core + web UI), macOS only, universal binary (`universal-apple-darwin`) |
| UI | Vite + React + TypeScript, reusing `web/src/design/tokens.css` (import or copy, same repo) |
| HTTP | `reqwest` (rustls, stream) + `tokio` |
| Wire types | Path dependency on `../api/crates/contracts` (+ its re-exports) |
| Credentials | `keyring` crate (macOS Keychain) for the `nb_session` value and server URL |
| File watching | `notify` (+ debouncer) on `~/nimbytes/Exports` |
| Removal | `trash` crate: moves removed clips to the macOS Trash, never hard-deletes |
| State | JSON file in `~/Library/Application Support/nimbytes/state.json` (clip id → local path, size, synced at; upload ids for resume) |
| Tauri plugins | tray icon (built-in), `opener` (reveal in Finder, open FCPXML with Final Cut Pro), `dialog` (choose folder), `autostart` (launch at login, optional), `notification` (optional) |

Pin exact versions like the API workspace, and apply the same clippy denies.

### 4.2 Screens (small window + menu-bar icon)
1. **Sign in:** server URL (default from build-time env `NIMBYTES_SERVER_URL`, editable), passcode → `POST /api/session` → store cookie value in Keychain → `GET /api/session` to verify.
2. **Status (main):** sync folder path ("Change…", "Reveal in Finder"), last sync time, counts (clips, shorts, originals offline), in-flight downloads and uploads with progress, "Sync now", "Sign out".
3. **Library list:** ready clips with title, duration and a toggle **"Make available offline"** (downloads the original into `Originals/`).
4. **Shorts list:** ready shorts with **"Open in Final Cut Pro"** (writes the FCPXML, then opens it), **"Reveal FCPXML"** (for Resolve or Premiere) and **"Reveal render"**.
5. **Menu-bar menu:** status line, Sync now, Open nimbytes folder, Open window, Quit.

Keep it visually consistent with the PWA (tokens, fonts, logo assets from `web/public/icons`).

### 4.3 Sync engine (down)
- Poll `GET /api/sync/manifest` every 30 s with `If-None-Match`, on "Sync now", and on window focus. Exponential backoff on errors. On 401 → sign-in screen.
- **New or changed clip:** download `proxy_url` to `Library/<recorded YYYY-MM-DD> <title> [<clip_id first 8>].mp4`.
- **Shorts:** download `render_url` to `Shorts/<created YYYY-MM-DD> <prompt slug> [<short_id first 8>].mp4` when present.
- **Originals:** only when toggled. Use `POST /api/sync/clips/{id}/original` → `Originals/<same base name>.<ext>`.
- **Downloads:** stream to `<name>.part`, resume with HTTP `Range`, verify size, atomic rename, `chmod 444` for app-managed files. Max 2 concurrent. On 403 (expired URL), re-fetch the manifest or URL and resume.
- **Removed from cloud** (missing from the manifest): move the local proxy, original and project to the Trash and drop it from state.
- File names: sanitise for macOS (no `/` or `:`), keep the short id suffix to stay unique, and update names on title change by renaming, not re-downloading.

### 4.4 Exports (up)
- Watch `Exports/` (top level only). Accept `.mp4`, `.mov`, `.m4v`. Ignore hidden, temp and `.part` files.
- Wait until the size is stable for 5 s (NLEs write progressively).
- `POST /api/uploads/check` → if `duplicate_of`, notify and move to `Exports/Uploaded/` without uploading.
- Else run the existing multipart flow: create → PUT parts (4 in parallel, part size from the response) → collect `ETag`s → complete. Persist `upload_id` and finished parts in state for resume after quit or crash.
- On success: move to `Exports/Uploaded/`, show a notification ("Uploaded to nimbytes, it will appear in your library shortly").
- Respect existing server limits (size and type). Surface server error messages in the UI.

### 4.5 FCPXML export (the editor bridge)
Generate it **in the desktop app** (it knows the local paths). No backend change.

- Input: `GET /api/shorts/{id}` → best version's `Timeline` + `segments` (segment → `clip_id`) + manifest clip metadata (fps, width, height, duration).
- Media per shot: the local original if available offline, else the local proxy. If a clip isn't on disk yet, download its proxy first.
- **FCPXML 1.10** (imports in Final Cut Pro 10.6+ and DaVinci Resolve):
  - `<resources>`: one `<format>` for the sequence (1080×1350 for `4:5`, 1080×1080 for `1:1`, frame duration from the first clip's fps, e.g. `1001/30000s`), one `<format>` per source size and fps, and one `<asset>` per clip with `<media-rep kind="original-media" src="file:///…">`, plus `hasVideo`, `hasAudio`, `duration` and `start="0s"`.
  - `<library><event name="nimbytes"><project name="<prompt or short id>"><sequence format=… duration=…><spine>`.
  - One `<asset-clip>` per timeline shot: `ref` = asset, `offset` = running sequence position, `start` = shot `in`, `duration` = `out − in`. **All times as rational seconds snapped to whole frames** of the clip's frame duration.
  - Add a `<marker>` at each shot start whose value is the shot's `reason` (the AI's "why this shot").
  - Escape XML properly. Use absolute, percent-encoded `file://` URLs.
- Write to `Projects/<short slug> [<id8>].fcpxml`. "Open in Final Cut Pro" opens it with Final Cut if installed, else reveals it in Finder.
- Captions, punch-in and transitions are **not** exported (the editor finishes those in the NLE). Say so in the UI tooltip.

---

## 5. Small PWA addition (additive)
In the existing Settings sheet (`web/src/components/SettingsSheet.tsx`), add one row: **"nimbytes for Mac"** linking to the GitHub Releases page (URL from a Vite env var, hidden if unset). Shown only on desktop browsers (reuse `web/src/services/device.ts` if it has a check). No other web changes.

---

## 6. Build, sign, notarize, release

- Prereqs on my Mac: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`, a **Developer ID Application** certificate in the Keychain.
- Tauri config: `identifier` = `dev.denmarkamanodaya.nimbytes` (or ask me), product name `nimbytes`, macOS minimum 13.0, hardened runtime on, DMG target, app icon from `web/public/icons`.
- Signing and notarization via environment variables only, never committed: `APPLE_SIGNING_IDENTITY`, plus either `APPLE_ID` / `APPLE_PASSWORD` (app-specific password) / `APPLE_TEAM_ID`, or `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH`. Document them in `desktop/.env.example` (names only).
- Add Make targets (don't change existing ones): `desktop-dev` and `desktop-dmg` (`tauri build --target universal-apple-darwin`).
- Verify: `spctl -a -vvv -t install <dmg>` and `xcrun stapler validate <dmg>` must pass.
- Release: **ask me first**, then `gh release create desktop-v1.0.0 <dmg> --title "nimbytes for Mac 1.0.0" --notes "<short notes>"`. **Never commit the DMG to git.** No GitHub Actions (quota is exhausted); build locally.
- `.gitignore`: add `desktop/src-tauri/target`, `desktop/node_modules`, `desktop/dist`.

---

## 7. Docs
Add a **"nimbytes for Mac"** section to `README.md` (keep existing sections intact): what it does, folder layout, install (download the DMG from Releases), sign in with the server URL and passcode, and NLE notes (FCPXML for Final Cut and Resolve, proxies vs originals). Add `desktop/README.md` with dev and build steps.

---

## 8. Order of work

| Phase | Deliver | Commit scope |
| --- | --- | --- |
| 1 | Backend: `sync.rs` contract + usecase + handlers, routes registered; workspace still builds and lints | `feat(api)` |
| 2 | `desktop/` Tauri scaffold, design tokens, sign-in with Keychain, tray menu | `feat(desktop)` |
| 3 | Sync down: manifest polling, proxies, shorts, offline originals, Trash on removal | `feat(desktop)` |
| 4 | Exports up: watcher, stable-size wait, duplicate check, resumable multipart upload | `feat(desktop)` |
| 5 | FCPXML writer + "Open in Final Cut Pro" | `feat(desktop)` |
| 6 | PWA Settings link, README sections, Make targets, signed + notarized universal DMG (release only after I approve) | `feat(web)`, `docs`, `chore(desktop)` |

Phases 1 and 2 can run in parallel (`/dk-agents`). After each phase, give me a 3–5 line status: what works, how to run it, anything I need to do (e.g. a deploy for the new endpoints, signing env vars).

Cut order if short on time: autostart → notifications → Shorts folder sync → offline originals (FCPXML then always uses proxies). **Never cut:** sign-in, proxy sync, Exports upload, FCPXML.

---

## 9. Definition of done (I'll verify manually)
- Signed, notarized universal DMG installs and opens without Gatekeeper warnings.
- Sign in with the server URL + passcode; the session survives an app restart.
- A clip uploaded from the phone appears in `~/nimbytes/Library` within ~30 s of becoming ready.
- "Make available offline" downloads the original. Deleting a clip in the PWA moves its local files to the Trash.
- "Open in Final Cut Pro" opens the AI cut with all media linked and shot markers showing the AI's reasons; the same FCPXML imports in DaVinci Resolve.
- A file exported into `~/nimbytes/Exports/` uploads, moves to `Uploaded/`, and appears in the PWA library.
- Everything that worked before still works: PWA flows, existing endpoints, deploy script.
