# nimbytes for Mac

A small signed Mac app (Tauri 2) that turns the nimbytes cloud library into a real folder and runs
the full nimbytes web app in its window, with media played from disk.

```
~/nimbytes/
  Library/     720p proxies of every ready clip (app-managed, read-only)
  Originals/   full originals: pinned ("Make available offline") or fetched for an NLE export
  Projects/    FCPXML of AI shorts, media linked to the local files
  Shorts/      final rendered shorts
  Exports/     drop finished edits here; they upload, then move to Exports/Uploaded/
```

- **Sync down** polls `GET /api/sync/manifest` every 30 s (and on focus and "Sync now"). Downloads
  resume with HTTP `Range`, are size-checked and renamed into place. Clips deleted in the cloud go
  to the macOS Trash, never a hard delete.
- **Originals** you pin stay. Originals fetched for an NLE export are evicted least-recently-used
  above the budget (20 GB by default).
- **Exports up**: a `.mp4`, `.mov` or `.m4v` dropped into `Exports/` uploads once its size has
  held still for 5 s. It goes through the same resumable multipart upload as the phone, then
  appears in the library.
- **FCPXML 1.10** for Final Cut Pro 10.6+ and DaVinci Resolve. Each shot is frame-snapped and
  carries a marker with the AI's reason; critique notes become to-do markers. Captions, punch-in
  and transitions are left for the editor.
- The session cookie lives in the macOS Keychain; the web layer never sees it.

## Develop

Needs Rust 1.99.1 (pinned in `src-tauri/rust-toolchain.toml`, both macOS targets), the Tauri CLI
(`cargo install tauri-cli --version '=2.12.4' --locked`) and the local stack running
(`https://localhost`).

```bash
make desktop-dev     # trusts the local Caddy CA, builds web/ in desktop mode, runs the app
make gates-desktop   # cargo fmt --check, clippy -D warnings, unit tests
```

Dev builds accept `http://localhost`, and they trust the local Caddy root CA when `NIMBYTES_DEV_CA`
points at its PEM. Release builds accept https only and never read that variable.

## Build the DMG

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: …"   # see desktop/.env.example
export NIMBYTES_SERVER_URL=https://…                           # default server for first run
make desktop-dmg     # universal (arm64 + x86_64), hardened runtime, signed
```

The DMG is signed but not notarized, so open it the first time with right-click → Open.
Settings and sync state live in `~/Library/Application Support/nimbytes/`.
