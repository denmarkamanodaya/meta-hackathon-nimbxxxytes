# CLAUDE.md

Guide for agents working in this repo. This file is the single home of the repo's rules. Package
`CLAUDE.md` files and the docs point here; they never restate a rule.

## What this is

**nimbytes** — intelligent storage for Ray-Ban Meta glasses footage, built for the Meta Global AI
Developer Hackathon (event window **2026-10-26 to 2026-11-04**). Users upload POV clips from their
phone to S3. Meta models understand every clip (scene descriptions, objects, transcript, speakers,
faces). Users search their library in natural language down to the second, name the people the
system detected, and use an agentic editor that cuts selected moments into a post-ready short and
critiques its own cut before showing it.

Pitch: *"Your glasses capture everything, your phone can't keep it all. We store it, understand
it, and turn any moment into a post."*

Name: `nimbytes` = nimbus (cloud) + bytes (smart storage tiering). Use only this name.

## Hard rules (non-negotiable)

1. **Naming.** Never mention any other product or earlier project of the owner anywhere: code,
   comments, commit messages, branch names, README, docs, configs or UI.
2. **New work only.** Never copy code, assets or docs from another repo. Never open another repo for
   reference. Everything here is written during the event (hackathon rule; see
   `docs/hackathon-rules.md`).
3. **No AI attribution.** No `Co-Authored-By` trailers, no "Generated with" lines, no AI mentions in
   commits, PR titles, PR bodies or code comments.
4. **Speed first, fast tests only.** Write unit tests for every pure rule, parser, use case and
   handler you add, in the same commit (see "Testing" below). **Never** write or run long end-to-end
   suites (browser automation, full pipeline runs against live services, anything taking minutes);
   the owner does end-to-end checks by hand. Keep code clean; skip polish the demo does not show.
5. **Ask before anything costly or irreversible:** `terraform apply` / `destroy`, creating or
   deleting AWS resources, deleting data, force-pushing. One yes covers one action. Everything else:
   just do it.
6. **Secrets stay out of the repo.** The repo is public. Real values live only in `.env` (ignored).
   `.env.example` holds names and safe defaults.
7. **Commit small and often** straight to `main`, **locally only. Never `git push`** until the owner
   has reviewed the code in VS Code and says to push (owner ruling 2026-10-27, later the same day).
   Remote: `github.com/denmarkamanodaya/meta-hackathon-nimbxxxytes` (public). Commit timestamps still
   show the work was done during the event. Conventional Commit prefixes (`feat:`, `fix:`, `chore:`).
   **`docs/` is published** (owner ruling 2026-10-30, replacing the 2026-10-27 "README only"
   rule), including scrubbed snapshots of the agent notes in `docs/_agent/` and the build prompts
   in `docs/_prompts/`. The live root `CLAUDE.md`, `STATUS.md`, `LEARNING.md`, `MEMORY.md` and the
   package `CLAUDE.md` files stay git-ignored. Before publishing anything under `docs/`, scrub it:
   no other product names, no AWS account id, emails, instance or rule ids, home IPs, bucket names,
   passcodes or `/Users/<name>` paths. Spike outputs (frames, raw masks) stay ignored.
8. **Meta models first, and only Meta models, for AI** (one owner exception, 2026-10-29: read-aloud uses the device's own voice, the Web Speech API, because MMS-TTS sounded robotic; MMS stays as the fallback). Every AI call uses a Meta model (Muse Spark,
   SAM 3.1, Muse Voice Transcribe, Perception Encoder). When a feature can use a Meta model, it does
   (owner ruling 2026-10-27: "utilize Meta's AI / model as our main priority"). Example: face
   matching uses PE to propose pairs and Muse Spark to confirm each one. Muse Spark always runs on
   the standard tier (`muse-spark-1.3`), never a `-contributor` id. Every call goes through the one
   `MetaClient`, which caches it and logs its cost.
9. **Vanilla CSS + design tokens.** No Tailwind, no CSS-in-JS. Every colour, space and radius comes
   from `web/src/design/tokens.css`. Accent is the nimbytes brand accent defined there, nowhere else.
10. **Coding standard = dk-coding lite** (see next section).
11. **Mock-first for UI.** A visual change starts as a mock on the design canvas
    (https://claude.ai/artifact/ChDqcftUKSR5yvrYBKQAS7, local copy `docs/design/mist/`). Build it only
    after the owner approves, then build exactly what was approved.
12. **Never open the live SQLite file from the Mac while the api container runs.** WAL locks and
    `-shm` don't work across the Docker Desktop file share, and doing it corrupted the DB on
    2026-10-27. Read live data through the API. For backups or host queries, `docker stop
    nimbytes-api-1` first.

## Coding standard: dk-coding lite

Owner's dk-coding conventions (`~/Projects/.claude/rules/`), trimmed for a 9-day build. Applies:

- **Hexagonal layout.** Pure core (domain types, ports, use cases) depends on nothing that does IO.
  Adapters are the only code that calls HTTP, S3, ffmpeg, SQLite, Tantivy or ONNX Runtime. One
  composition root per deployable reads env and wires adapters to ports. Rust mapping:
  `~/Projects/.claude/rules/stack/rust.md` (layer map, errors, clippy bans); package specifics in
  `api/CLAUDE.md`.
- **Typed errors.** One `AppError { code, message }`; codes are `UPPER_SNAKE` and live in one enum.
  No `unwrap`/`expect`/`panic!` outside startup in `main.rs`.
- **DRY, knowledge first.** One source per fact: S3 key builders in one module, error codes in one
  enum, env keys in the composition root, wire shapes in `api/crates/contracts` (TS types are
  generated from it or hand-mirrored in exactly one `web/src/services/api/types.ts`), design tokens
  in one CSS file, prompts in `api/prompts/`.
- **Thin driving adapters.** Axum handlers parse, call one use case, shape the response. React
  components call hooks; hooks call service modules; only service modules call `fetch`.

Does **not** apply here (owner rulings 2026-10-27): end-to-end suites, port contract suites run
against real services, coverage/mutation thresholds, `v<N>` versioned units and pointer files, CI
(there is no GitHub Actions), `cargo deny` in CI (run once before submit instead).

## Testing

Owner ruling 2026-10-27 (revised): unit tests yes, long end-to-end tests no.

| Test | Where | Allowed |
| --- | --- | --- |
| Pure rules (segmenting, RRF, phrase captions, timeline clamp, face filtering, cost maths, S3 keys) | `#[cfg(test)] mod tests` in the same file | ✅ required |
| Parsers on recorded fixtures (SAM stream, Transcribe response, Spark JSON + schema validation, ffprobe JSON, `scdet` output) | adapter crate, fixtures in `api/tests/fixtures/` | ✅ required |
| Use cases with in-memory fakes of the ports (ingest resume, search fallbacks, agent budget stop, ownership checks) | `core` tests; fakes in `api/crates/testkit` (dev-dependency only) | ✅ required |
| Handlers via `tower::ServiceExt::oneshot` with fakes (status codes, error body, `FORBIDDEN` on another user's id) | `server` tests | ✅ required |
| SQLite adapter against an in-memory / temp-file DB | `adapters` tests | ✅ |
| Web pure logic (multipart part planning, resume state, timeline edit ops, formatters) and hooks with a mocked service | `*.test.ts` beside the file, Vitest | ✅ required |
| Live Meta API, real S3, real ffmpeg on long media, browser automation, full pipeline runs | – | ❌ never in the suite; spikes and the owner's manual checks cover these |

Rules:
- Tests are fast and offline: no network, no AWS, no model calls. The whole Rust suite stays under
  60 s and the web suite under 20 s on the Mac; if a test is slow, make it smaller, don't skip it.
- Fixtures are small recorded responses captured during spikes (secrets and personal data removed),
  or tiny generated media (≤ 2 s, generated by `ffmpeg -f lavfi` in a test helper) when an ffmpeg
  argument builder needs a real file.
- Assert the outgoing request shape (body, headers, multipart parts) for every Meta call, not only
  the parsed result (`~/Projects/CLAUDE.md` rule 9: seams break, not pieces).
- Mutation-check each new guard once by hand: reintroduce the bug, watch the test fail.
- No suppression to get green: no `#[ignore]`, no `.skip`, no loosened assertions.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vite + React + TypeScript, vanilla CSS tokens, installable PWA, mobile-first |
| API | Rust: Axum + Tokio |
| Jobs | Tokio worker pool over a `jobs` table in SQLite (status, step, attempts) |
| DB | SQLite via `sqlx` (WAL) + `sqlite-vec` for vectors |
| Search | Tantivy BM25 + sqlite-vec, reciprocal rank fusion, Muse Spark rerank |
| Media (ingest) | ffmpeg / ffprobe via `tokio::process` |
| Rendering | Remotion composition (`render/`), rendered by a Node renderer container on the box; previewed in the PWA with `@remotion/player` (same composition) |
| Storage | Amazon S3, presigned multipart upload, `ap-southeast-2` |
| AI | Meta Model API `https://api.meta.ai/v1` (key `MODEL_API_KEY`); facts in `docs/meta-api.md` |
| Local DL | Perception Encoder PE-Core-B16-224 → ONNX (offline Python) → `ort` on CPU |
| Infra | Terraform: S3 bucket + IAM now; one EC2 t4g.large (Graviton arm64, 2 vCPU, 8 GB) box + EBS at deploy time |
| Deploy | `docker compose` locally; arm64 image built on the Mac, shipped with `docker save | ssh docker load`; Caddy for HTTPS. No ECR, no GitHub Actions |

## Layout

```
api/        Rust workspace (crates: core, adapters, contracts, server)   → api/CLAUDE.md
web/        Vite + React PWA                                             → web/CLAUDE.md
ml/         Python: Perception Encoder → ONNX export (offline only)      → ml/CLAUDE.md
render/     Node + Remotion: the short composition + renderer service    → render/CLAUDE.md
infra/      Terraform                                                    → infra/CLAUDE.md
scripts/    deploy + local helpers
docs/       plan, architecture, contracts, Meta API facts                → docs/README.md
STATUS.md   phase board, owner inputs, open questions (update after every phase)
LEARNING.md spike results and gotchas (append when something surprises you)
MEMORY.md   dated decision log (append every owner ruling)
```

## Commands

```bash
# local stack (api + renderer + caddy); the SSO profile is mounted, run `aws sso login --profile nimbytes` first
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
cd web && npm run build            # Caddy serves web/dist directly, so a web build is live at https://localhost
cd web && npm run dev              # :5173, proxies /api to the local stack through Caddy
cd web && npm run dev:mock         # :5175 in-browser mock API, no server or AWS needed
cloudflared tunnel --url https://localhost:443 --no-tls-verify --http-host-header localhost --origin-server-name localhost   # phone link (random *.trycloudflare.com)
make gates-render                  # render/ lint + tests + tsc
make gates                         # every gate below
cd api && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings
cd api && cargo test --workspace   # unit tests, offline, < 60 s
cd web && npm test                 # vitest run, < 20 s
cd web && npm run build            # tsc --noEmit + vite build
cd infra/stacks/storage && terraform fmt -check && terraform validate
```

## Gates ("done" means these ran and passed, output shown)

`cargo fmt --all --check` · `cargo clippy --workspace --all-targets -- -D warnings` ·
`cargo test --workspace` · in `web/`: `npm run lint`, `npm test` (Vitest run), `npm run build` ·
`terraform fmt -check -recursive` + `terraform validate` in each stack.
Then drive the real app for the phase's acceptance checks and report two lists: **ran** and
**traced, not executed**.

## Working loop

1. Read `STATUS.md` → current phase → `docs/phases/<NN>-*.md`.
2. Do the phase's tasks, each with its unit tests in the same commit; commit small.
3. When the phase's acceptance checks pass: tick them in the phase doc, update `STATUS.md`, append
   surprises to `LEARNING.md` and rulings to `MEMORY.md`, then give the owner a 3–5 line status
   (what works, how to run it locally, what's next).
4. Stop and ask only when blocked or when hard rule 5 applies.

## Releases

- `v1.0.0` (2026-10-27) holds the Mist redesign, the logo, duplicates, People & pets and opt-in
  face matching. The owner approved that push, tag and release.
- `v1.0.1` (2026-10-27) holds nimbytes for Mac (the DMG is a release asset, never in git), the sync API and the PWA download link.
- `v1.0.2` (2026-10-27) moves storage from S3 to Cloudflare R2 and adds instant search, delete and the simpler Mac Sync page, with Mac app 1.0.2 (DMG sha256 75761726…202c7e).
- `v1.0.3` (2026-10-27) "smart cache fix": the zero-bytes Mac drive, the smart cache, upload and mount fixes, Mac-made proxies, the face fixes, the Midnight theme and the Library as search; Mac 1.0.3.
- `v1.0.4` (2026-10-27) "Base Studio": Production Studio (plan, storyboards, coverage, story cut, privacy blur, brand kit, publish) and redesign 15.0–15.4; Mac 1.0.4 (DMG sha256 644d796d…e111); migration 0009 on live.
- `v2.0.0` (2026-10-28) "nimbytes UI/UX enhancements": redesign v2 for the Mac (Night, compact, three columns, Gallery grid/list, right column, Projects, full player, Faces, Settings window), the renames (Gallery, Faces, Speech, Brand) and the 250 GB per-account storage cap; Mac 2.0.0 (DMG sha256 8f9c5896…9319); migrations 0010 and 0011 on live.
- `v2.0.1` (2026-10-28): compact Short, Production and Productions pages with Delete production; Upload straight from the Gallery (file/folder picker, upload tiles and cancel); render concurrency fix, Feed failure, Publish Try again, full-picture covers. Mac 2.0.1 (DMG sha256 bf9cf0e8…3e3c).
- `v2.0.2` (2026-10-28): universal Mac search bar (⌘K, grouped results, the Gallery header field removed), compact Shorts list and New production, and shorts list rows with caption and production. Mac 2.0.2 (DMG sha256 7bacd3f2…66f2).
- `v2.0.3` (2026-10-28) "Muse Image Integration": cover titles (baked by the renderer `/still`), cover styles, Redraw with words, storyboards from footage, key art for projects and productions, Use as cover, and Rename production; migration 0012 on live; Mac 2.0.3 (DMG sha256 ea664c8b…0f40).
- `v2.0.5` (2026-10-29) "reliable Mac uploads": the Mac app uploads at most 2 files at a time (a 19-file pick had split the home uplink across ~76 parts until each timed out after 600 s); also carries the SAM `store:false` and `WORKERS` fixes. Mac 2.0.5 (DMG sha256 c07f8cb3…41ee).
- `v2.1.0` (2026-10-29) "Guides": MyWay guides (steps from a task video, SAM-circled control, MMS-TTS voice, replay, edit, rename), multi-clip shorts, Productions removed (tables kept), Features nav, UI polish; migration 0014 on live; deploy now ships the MMS-TTS files; Mac 2.1.0 (DMG sha256 21fbd6d2…9c2b).
- `v2.2.0` (2026-10-29) "stable build": the Ask box (type or hold to talk; Muse Spark plans search, upload, make a short, make a guide, add to project; Run with ticked progress and a "2 working" queue; Voice Transcribe), parallel storage deletes (short delete timeout), UI refinements; Mac 2.2.0 with mic usage text + audio-input entitlement (DMG sha256 6805be0a…fbb3).
- `v2.2.1` (2026-10-29) "iRead, near-copies, clearer voice": iRead (photo/PDF letters read by Muse Spark, Read it to me, ask by text or voice, poppler in the api image, upload through PUT /api/documents/{id}/source), Guides renamed iGuide and the Ask box iRecall, read-aloud in the device voice (MMS-TTS backup with speakable text), near-copies and same moments (migration 0016, backfill links only), migrations 0015+0016 on live; Mac 2.2.1 (DMG sha256 749c073b…ad31).
- Later releases follow the same pattern. Commit locally and push only when the owner says so.
  Tag `vX.Y.Z` on `main`, then `gh release create`. Release notes list user-visible changes only,
  with no AI attribution and no private doc paths.
