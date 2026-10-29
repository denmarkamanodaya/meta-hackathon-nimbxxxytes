# nimbytes

**An AI-powered filesystem, built on Meta AI.** nimbytes keeps your whole video library in the
cloud at zero bytes on your device. It still plays like it's local, and Meta models understand
every clip, so you can search footage like text. It also turns what you film into everyday help: an
**accessibility helper for everyday independence**.

> Built for the **Meta Global AI Developer Hackathon** (26 October – 4 November 2026).
> Theme: **Build for Your World** · Track: **Indie Developer** (solo).

---

## The problem

| Human · Memory | AI · Storage |
| --- | --- |
| **57 million** people live with dementia, and there is no cure yet. Memory care is still done by hand, with photo albums, videos and life-story books families make themselves, and about five hours of unpaid care a day. | Storage tripled in price in one year, because AI data centres buy the world's memory chips first. So the footage that holds our memories gets deleted or lost on a drive. |

*Sources: WHO Dementia fact sheet (Oct 2026); Cochrane review "Reminiscence therapy for dementia"
(2018); TrendForce NAND contract prices, Jan–Sep 2026 (2.9–3.3× compounded).*

**What if your footage could remember for you, and show you how?**

nimbytes is an accessibility and helper tool. It does not diagnose, treat or replace care.

---

## What it does

| Feature | What you see | How it works |
| --- | --- | --- |
| **Zero bytes on disk** | A 3.4 GB video shows as *Zero bytes on disk* in Finder, yet opens and jumps anywhere at once | The Mac app mounts the library as a real `~/nimbytes` folder (a local NFS drive). Files stream from Cloudflare R2 on demand through range reads, with a small smart cache that frees itself |
| **Search like text** | Type or say "Find Kristoff making a speech", "kangaroo at a bus stop" or a line someone said, and land on the second | Every clip is split into moments; keyword search (Tantivy) and image-vector search (Perception Encoder + sqlite-vec) are fused, then Muse Spark rewrites the query and reranks with a reason |
| **By scene, by words, by who** | Search what happened, what was said, or who was there | Moment descriptions (Muse Spark), transcripts with speakers (Muse Voice Transcribe), faces of people and pets (SAM 3.1), named once by you |
| **Duplicates, found and scored** | "Looks like a copy: 99% the same", Remove this copy | Exact copies by content hash; near-copies (re-encoded, trimmed, exported again) by comparing Perception Encoder moment vectors, with a similarity score. Copies skip all paid AI steps |
| **iGuide: video explainers, automatically** | Film a task once (a recipe, the laundry, the TV remote) and get numbered spoken steps | Meta AI agents work in stages: Muse Spark finds the steps, picks step frames, SAM 3.1 traces the thing to touch, and each step is read aloud |
| **iRead: snap it, hear it** | Photograph a letter or bill; nimbytes summarises it and reads it aloud | Muse Spark reads the page and pulls out what it says and what to do next; read-aloud uses the device's own voice (MMS-TTS on our server as the fallback) for anyone who finds small print hard to see |
| **iRecall** | Ask in your own words, by typing or holding to talk | Muse Spark plans the request (search, make a short, make a guide, read a letter) and runs it with visible steps; Voice Transcribe turns speech into the request |
| **Agentic shorts** | A post-ready short from your moments | Muse Spark plans the edit, the Remotion renderer draws it, Muse Spark watches the draft and critiques it, then revises |
| **Covers and key art** | Cover images, storyboards, project art | Muse Image 1.0 |
| **Projects, Faces, People & pets** | Group clips, name faces, hide bystanders | Opt-in face matching across your own clips: Perception Encoder proposes look-alikes, Muse Spark confirms, nothing is named until you say yes |

---

## Meta models: six, every one doing real work

| Role | Model | Used for | Where it runs |
| --- | --- | --- | --- |
| The brain | **Muse Spark 1.3** (`muse-spark-1.3`) | Moment descriptions and titles, query rewrite and rerank, letter reading, guide steps, edit planning and critique, iRecall intents, face-match confirmation | Meta API |
| The eyes | **SAM 3.1** | Faces of people and pets, cut-outs, the traced control in each guide step | Meta API |
| The memory | **Perception Encoder** (PE-Core-B16-224, ONNX) | Image and text vectors for search, near-copy detection, look-alike faces | Our server (local ONNX via `ort`) |
| The ears | **Muse Voice Transcribe 1.0** (`muse-voice-transcribe-1.0`) | Transcripts with speaker turns; spoken requests | Meta API |
| The artist | **Muse Image 1.0** (`muse-image-1.0`) | Covers, storyboards, key art, redraw on request | Meta API |
| The voice | **MMS-TTS** (`facebook/mms-tts-eng`, ONNX) | Read-aloud fallback for guides and letters | Our server |

Every Meta call goes through one `MetaClient` that caches answers and logs the cost of each call.
Calls are made with storage off, so footage is never kept or used for training.

---

## Architecture

```
 iPhone / browser (PWA)        nimbytes for Mac (Tauri 2)
        │                            │  ~/nimbytes  (local NFS drive, smart cache)
        └──────────── HTTPS ─────────┤
                                      ▼
                  Caddy ──► API (Rust · Axum · Tokio)
                              │  SQLite (WAL) + sqlite-vec · Tantivy
                              │  job workers: ingest → moments → describe → transcribe
                              │               → faces → vectors → near-copies → guides
                              ├──► Meta Model API (Muse Spark, SAM 3.1, Voice Transcribe, Muse Image)
                              ├──► Perception Encoder + MMS-TTS (ONNX, on the box)
                              ├──► Renderer (Node · Remotion) for shorts, covers, stills
                              └──► Cloudflare R2 (private bucket, presigned multipart + range reads)
```

- **Hexagonal core:** domain types, ports and use cases in `api/crates/core` depend on nothing that
  does IO. Adapters (`api/crates/adapters`) are the only code that calls HTTP, R2, ffmpeg, SQLite,
  Tantivy or ONNX. One composition root wires them (`api/crates/server`).
- **Typed errors:** one `AppError { code, message }` with `UPPER_SNAKE` codes.
- **Prompts live in files:** `api/prompts/*.md`, each with a JSON schema that every Muse Spark
  answer is validated against.

---

## Technology

| Layer | Technology |
| --- | --- |
| Web app | Installable PWA: React 19.3, Vite 8.3, TypeScript 6.0, React Router 8.5, vanilla CSS design tokens (no CSS framework), Vitest 5 |
| Mac app | Tauri 2.12 (Rust + the same web app), local NFS drive (`nfsserve`), macOS Keychain session, tray, autostart, notifications; signed with a Developer ID |
| API | Rust: Axum 0.8, Tokio 1.54, sqlx 0.9 on SQLite (WAL), sqlite-vec 0.1, Tantivy 0.27, `ort` 2.0 (ONNX Runtime), reqwest 0.13, aws-sdk-s3 (R2), ffmpeg/ffprobe, poppler (PDF pages) |
| Rendering | Node + Remotion 4.0: one composition shared by the in-app preview player and the server renderer |
| AI | Meta Model API (Muse Spark 1.3, SAM 3.1, Muse Voice Transcribe 1.0, Muse Image 1.0); Perception Encoder and MMS-TTS exported to ONNX (`ml/`, Python, offline) |
| Storage | Cloudflare R2 (Oceania): private, encrypted, presigned multipart upload, range reads, zero egress fees for streaming |
| Infra | Terraform (AWS Sydney: one Graviton t4g.large box + EBS), Docker Compose, Caddy (HTTPS); images built on the Mac (arm64) and shipped over SSH |
| Demo video | Remotion project in `video/`: real screen recordings of the app, voice-over generated locally (Kokoro-82M, British English) |
| Quality | Rust: `cargo fmt`, `clippy -D warnings`, unit and handler tests with in-memory fakes. Web: ESLint, Vitest (1,200+ tests), a raw-colour gate that keeps every colour in the token file |

---

## Repository

```
api/        Rust workspace: core (domain, ports, use cases), adapters, contracts, server, testkit
web/        PWA and the Mac app's web layer (one codebase, two builds)
desktop/    Tauri 2 Mac app (drive, sync, Keychain, tray)
render/     Node + Remotion renderer service
ml/         Perception Encoder and MMS-TTS → ONNX export (offline Python)
infra/      Terraform stacks (storage, app)
scripts/    deploy and helpers
video/      the demo video, as a Remotion project (media not in the repo)
```

---

## Try it

- **Judging server:** https://3-104-132-162.sslip.io (iPhone: Share › Add to Home Screen).
- **Passcode:** provided to judges with the submission.
- **nimbytes for Mac:** download the DMG from [Releases](https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases) and drag nimbytes to Applications. It is signed but not notarized, so the first time, right-click it and choose Open. Sign in with the same passcode.

```
~/nimbytes/
  Library/     every clip, zero bytes until you play it
  Projects/    FCPXML of AI-made shorts, media already linked
  Shorts/      final rendered shorts
  Exports/     drop a finished edit here; it uploads and appears in your library
```

"Open in Final Cut Pro" writes the AI's cut as FCPXML 1.10, frame-accurate, with a marker on every
shot giving the AI's reason; the same file imports in DaVinci Resolve. Clips deleted in nimbytes go
to the macOS Trash, never a hard delete.

### Run it locally

```bash
cp .env.example .env            # fill in MODEL_API_KEY, R2 keys, DEMO_PASSCODE
make models                     # Perception Encoder + MMS-TTS ONNX files
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
cd web && npm install && npm run build        # served by Caddy at https://localhost
cd web && npm run dev:mock      # or: the app on an in-browser mock API, no keys needed
make gates                      # fmt, clippy, tests, lint, builds
```

The Mac app: `make desktop-dev` (see `desktop/README.md`).

---

## Built during the event

Everything here was written during the hackathon, starting from an empty repository on
**27 October 2026** (the first commit). About 340 small, dated commits on `main` show the build.

| Release | Date | What landed |
| --- | --- | --- |
| v1.0.0 | 27 Oct | Upload, understanding, natural-language search, people & pets, opt-in face matching, the agentic short editor |
| v1.0.1 – v1.0.4 | 27 Oct | nimbytes for Mac, the zero-bytes drive and smart cache, Cloudflare R2, instant search, Production Studio |
| v2.0.0 – v2.0.5 | 28–29 Oct | The Mac redesign (three columns, Gallery, Projects, Faces, Settings), universal search bar, Muse Image covers and key art, reliable uploads |
| v2.1.0 | 29 Oct | iGuide: spoken step-by-step guides from a task video, with SAM-circled controls |
| v2.2.0 – v2.2.2 | 29 Oct | iRecall (type or hold to talk), iRead (letters read and summarised), near-copies and same-moment detection, Gallery sorting and Add to project, text size, the PWA with the Mac layout |
| v2.3.0 (beta) | 30 Oct | The demo video, the new sign-in screen |

---

## Privacy

- Media sits in a private, encrypted bucket and is reached only through short-lived signed links
  after an ownership check.
- Faces are detected per clip. Matching across clips is opt-in, stays in your library and only
  suggests; turning it off deletes the face data. Bystanders can be hidden with one tap.
- Every Meta call is made with storage off, so footage is never kept or used for training.

---

## Third-party

| Item | Licence | Use |
| --- | --- | --- |
| Meta models (Muse Spark, SAM 3.1, Muse Voice Transcribe, Muse Image) | Meta Model API terms | All AI features |
| Perception Encoder PE-Core-B16-224 weights | Apache-2.0 (see `ml/NOTICE`) | Search and near-copy vectors |
| MMS-TTS `facebook/mms-tts-eng` | CC-BY-NC 4.0 | Read-aloud fallback |
| `@meta-sam/parser` 0.1.0 | SAM License | Decodes SAM 3.1 masks in the renderer |
| ffmpeg, poppler | LGPL / GPL | Media probing, proxies, PDF pages |
| Remotion | Remotion License (free for individuals) | Shorts renderer and the demo video |
| Pexels sample footage (recipe guide in the demo) | Pexels License | Shown with an on-screen credit; no endorsement implied |

Open-source crates and npm packages are listed in `api/Cargo.lock`, `web/package-lock.json`,
`render/package-lock.json` and `desktop/src-tauri/Cargo.lock`.

---

## Licence

nimbytes' own code and docs are released under the [MIT Licence](LICENSE). Meta models, model
weights, sample footage and other third-party pieces keep their own licences (see Third-party).
Build notes, plans and the prompts used during the event are in [`docs/`](docs/README.md).
