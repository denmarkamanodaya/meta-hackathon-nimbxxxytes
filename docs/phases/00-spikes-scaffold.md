# Phase 0 — Spikes and scaffold

**Day:** Tue 27 Oct (Perth) · **Status:** see `STATUS.md`

## Goal

Prove every risky external dependency works the way the plan assumes, before building on it, and
stand up an empty repo that runs end to end (`docker compose up` serves a blank PWA and a `/api/health`).
Each spike ends with a one-line verdict in `LEARNING.md`: **works / limits found / fallback chosen**.

## Prerequisites (owner)

- [ ] `MODEL_API_KEY` written to `nimbytes/.env` by the owner (never pasted in chat).
- [ ] AWS profile name for the throwaway bucket (see `STATUS.md` open question Q2).
- [ ] 3 short test clips from the glasses (one with speech, one with 2+ faces, one shot in portrait)
      copied to `nimbytes/data/samples/` (git-ignored).
- [ ] Yes to `terraform apply` for the storage stack (task 0.8).

## Spikes

Spike code lives in `api/crates/server/src/bin/spike_*.rs` (throwaway binaries, deleted or folded in
by Phase 3). Each spike writes the raw response to `data/spikes/<name>.json` (git-ignored) and the
facts to `LEARNING.md`.

| # | Spike | Owner | Question it answers | Pass | Fallback if it fails |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Spark video | lead | Does `muse-spark-1.3` accept an `input_video` presigned S3 URL of a 7 s 360p mp4 and return our JSON? Tokens, latency, cost per segment? | Valid segment JSON; cost/segment logged | Files API `file_id` upload; if video fails entirely, send 3 keyframes as images (image understanding) |
| 0.2 | SAM faces | lead | Request shape with `"face"` on a 1 fps mp4; stream format; does the object ordinal stay on one person across frames at 1 fps? | Parser yields per-ordinal box lists; same person keeps one ordinal across ≥ 5 frames | 2 fps copy; or per-frame image calls + IoU tracker in Rust |
| 0.3 | Voice Transcribe | lead | WAV 16 kHz mono + `mode: DIARIZATION`: turns, speaker labels, timing quality | Turns with `speaker` and sane `startMs/endMs` | Without diarization: one speaker "Speaker 1" |
| 0.4 | PE → ONNX → `ort` | ml-infra | Export PE-Core-B16-224 image **and** text towers; embedding dim; tokenizer handling; load + run both in Rust on CPU; latency per image | Cosine(text "a cup of coffee", coffee thumb) > cosine(text, unrelated thumb) | Python FastAPI sidecar serving the PyTorch model (adds a compose service) |
| 0.5 | sqlite-vec in sqlx | api | Load `sqlite-vec` into sqlx's bundled SQLite (`sqlite3_auto_extension`), create `vec0`, KNN query | KNN returns nearest ids | Store vectors as BLOB, brute-force cosine in Rust (fine for < 5,000 segments) |
| 0.6 | ffmpeg HEVC + rotation | api | iPhone-exported HEVC with rotation metadata → upright 720p H.264 proxy; `scdet` output parse | Proxy plays upright in Safari; cut list parsed | Fixed 7 s windows without scene detection |

## Scaffold tasks

| # | Task | Owner | Files |
| --- | --- | --- | --- |
| 0.7 | Repo: `git init`, `.gitignore`, `.env.example`, `Makefile` (`gates`, `dev`, `spike-*`), `docker-compose.yml` (api, caddy), `Caddyfile`, root README stub | lead | root |
| 0.8 | Terraform storage stack: S3 bucket (private, SSE-S3, BPA, CORS exposing `ETag`, lifecycle), IAM user or role policy scoped to `arn:…:bucket/users/*`. `terraform plan` shown, **apply only after owner yes** | ml-infra | `infra/modules/storage/`, `infra/stacks/storage/` |
| 0.9 | Rust workspace: `core`, `contracts`, `adapters`, `server` crates; `rust-toolchain.toml`; `clippy.toml` (core bans per `stack/rust.md`); Axum `/api/health`; `composition.rs` reading env once; `tracing` JSON logs | api | `api/` |
| 0.10 | Web: Vite + React + TS strict; `design/tokens.css` (light + dark, brand accent); app shell with bottom tab bar (Library, Search, Upload, Editor); PWA manifest + service worker (app-shell cache only); `services/api/` client | web | `web/` |
| 0.11 | `ml/` export script + `requirements.txt` pinned + `NOTICE` (Apache-2.0 for PE weights); output `api/models/pe/*.onnx` (git-ignored; fetched by `make models`) | ml-infra | `ml/` |
| 0.12 | Create public GitHub repo `denmarkamanodaya/meta-hackathon-nimbytes`, push `main` (owner approved 2026-10-27). Confirm no `.env` or sample media is tracked before the first push | lead | – |

## Unit tests (set up the harness now)

| Test | Covers |
| --- | --- |
| `testkit` crate skeleton with a fake `Clock` and `IdGenerator` | harness exists before Phase 1 needs it |
| `/api/health` handler via `oneshot` | server test wiring |
| Vitest config + one test for `services/api/client.ts` error mapping (`{ error: { code } }` → typed error) | web harness |
| Spike responses saved, scrubbed, into `api/tests/fixtures/{spark,sam,transcribe}/` | inputs for the Phase 2–3 parser tests |

## Acceptance checks

- [ ] `make gates` passes (fmt, clippy, `cargo test`, web lint + test + build, terraform fmt/validate).
- [ ] `docker compose up --build` → `https://localhost/` shows the shell; `/api/health` returns
      `{ "ok": true }`.
- [ ] Each spike 0.1–0.6 has a verdict line in `LEARNING.md` and `docs/meta-api.md` UNVERIFIED items
      are updated.
- [ ] S3 bucket exists (after owner yes); a presigned PUT from `curl` works and the response shows an
      `ETag`.
- [ ] Repo is public on GitHub; `git log` shows only event-dated commits; `git ls-files` has no
      secrets or media.

## Risks

- Spark video cost is unknown. If spike 0.1 shows > $0.01 per 7 s segment, lower snippet resolution
  / fps first, then consider one whole-clip call with our boundaries listed in the prompt.
- PE export is the riskiest spike. Time-box to 3 hours, then switch to the sidecar.
- Rust compile times inside Docker on the Mac: use `cargo chef` layer caching from day one.
