# nimbytes

[![ci](https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/actions/workflows/ci.yml/badge.svg)](https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/actions/workflows/ci.yml)
[![RepoGrade](https://www.repo-grade.com/api/badge/denmarkamanodaya/meta-hackathon-nimbytes)](https://www.repo-grade.com/report/denmarkamanodaya/meta-hackathon-nimbytes)

**An AI-powered filesystem, built on Meta AI.** nimbytes keeps a family's whole video library in
the cloud at zero bytes on your device. It still plays like it's local, and Meta models understand
every clip, so you can search footage like text, and turn it into everyday help for people whose
eyesight or memory is fading.

> Built for the **Meta Global AI Developer Hackathon** (26 October – 4 November 2026).
> Theme: **Build for Your World** · Track: **Indie Developer** (solo).

**▶ Demo video (2:16):** [youtu.be/U1ZFNs1BktY](https://youtu.be/U1ZFNs1BktY): Eric's story, told with real
screen recordings: the zero-bytes filesystem, iRecall search, Memory Lane, iRead, iListen and iGuide.

**Run it yourself in three commands:** see [Run it](#run-it). You need Docker and your own Meta AI
API key. No cloud account, no bucket, nothing that only works on the author's machine.

**Try it live (optional):** https://3-104-132-162.sslip.io. The passcode is in the submission form.
The repo runs on its own without this server.

---

## The problem

Eric is 61 and lives on his own. His eyesight is fading, and names don't come as quickly as they
used to. His family films everything: birthdays, recipes, voicemails. Thousands of videos he can't
find, can't read and can't follow.

Storage also tripled in price in one year, because AI data centres buy the world's memory chips
first (TrendForce NAND contract prices, Jan–Sep 2026), so footage gets deleted or lost on a drive.

**nimbytes makes a family's own footage findable, readable and followable again.** It is an
everyday helper. It does not diagnose, treat or replace care.

---

## What it does

| Feature | What you see | How it works |
| --- | --- | --- |
| **Zero bytes on disk** | A 3.4 GB video shows as *Zero bytes on disk* in Finder, yet opens and jumps anywhere at once. Recordings, documents and photos live in the same drive | The Mac app mounts the library as a real `~/nimbytes` folder (a local NFS drive). Every file (videos, recordings, documents, photos) streams from Cloudflare R2 on demand through range reads, with a small smart cache that frees itself; any file can be kept offline |
| **Search like text** | Type or say "Find Kristoff making a speech", "kangaroo at a bus stop" or a line someone said, and land on the second | Every clip is split into moments; keyword search (Tantivy) and image-vector search (Perception Encoder + sqlite-vec) are fused, then Muse Spark rewrites the query and reranks with a reason |
| **By scene, by words, by who** | Search what happened, what was said, or who was there | Moment descriptions (Muse Spark), transcripts with speakers (Muse Voice Transcribe), faces of people and pets (SAM 3.1), named once by you |
| **Duplicates, found and scored** | "Looks like a copy: 99% the same", Remove this copy | Exact copies by content hash; near-copies (re-encoded, trimmed, exported again) by comparing Perception Encoder moment vectors, with a similarity score. Copies skip all paid AI steps |
| **iGuide: video explainers, automatically** | Film a task once (a recipe, the laundry, the TV remote) and get numbered spoken steps | Meta AI agents work in stages: Muse Spark finds the steps, picks step frames, SAM 3.1 traces the thing to touch, and each step is read aloud |
| **iRead: snap it, hear it** | Photograph a letter or bill; nimbytes summarises it and reads it aloud | Muse Spark reads the page and pulls out what it says and what to do next; read-aloud uses the device's own voice (MMS-TTS on our server as the fallback) for anyone who finds small print hard to see |
| **iListen: any language, your summary** | Drop in a recording or video in any language, even mixed (Mandarin and Japanese in one file), and get a summary in the language you choose, with a confidence score | Muse Voice Transcribe hears it in short windows so no language is dropped; Muse Spark names each line's language, translates and summarises; a second Muse Spark pass translates back, scores every line and fixes what fails, up to three versions; Muse Image draws a cover |
| **Photos in search** | Upload photos next to your videos; "flower backdrop with the number 60" finds the photo and the moment in the video | Muse Spark describes each photo and lists what is in it; Perception Encoder embeds it, so photos join the same keyword + vector search as video moments |
| **Memory Lane** | Ask iRecall "Show Eric his memories of his 60th birthday" and get a guided session: each moment plays full screen, a line is read aloud to him, then "Who is this?" reveals the names | Agents in stages: find who is in every moment (faces named by the family), write each line for the viewer (Muse Spark, with the face crops and frames), check every line against its picture and fix what isn't there, paint a cover (Muse Image) |
| **iRecall** | Ask in your own words, by typing or holding to talk | Muse Spark plans the request (search, make a short, make a guide, read a letter) and runs it with visible steps; Voice Transcribe turns speech into the request |
| **Agentic shorts** | A post-ready short from your moments | Muse Spark plans the edit, the Remotion renderer draws it, Muse Spark watches the draft and critiques it, then revises |
| **Covers and key art** | Cover images, storyboards, project art | Muse Image 1.0 |
| **Segments, Faces, People & pets** | Group videos, recordings, documents and photos into segments; name faces; hide bystanders | Opt-in face matching across your own clips: Perception Encoder proposes look-alikes, Muse Spark confirms, nothing is named until you say yes |

### Capabilities in detail

**Intelligent filesystem**
- Your library appears in Finder as `~/nimbytes`, with folders for the library, projects, shorts
  and exports. Files take **zero bytes on disk** until you open them; Finder's Get Info shows the
  real size (a 3.4 GB video) next to "Zero bytes on disk".
- Open any video and it plays in near real-time. Jumping anywhere in the timeline lands at once:
  the smart cache streams only the parts you watch and frees itself (the sidebar shows how much is
  on this Mac and when it frees). Any file can be marked "Make available offline".
- Every file type lives in the same drive: videos, photos, voice recordings and documents (PDFs,
  photos of letters). 250 GB of private, encrypted cloud storage per account.
- Upload straight from the gallery (files or folders), or drop a finished edit into `Exports/`
  and it appears in the library.

**Search, in your own words**
- One search box (iRecall) for everything; type or hold to talk.
- Search by **what you saw** ("show me all my footage of the wooden temple"), **what was said**
  ("who said 'sacrifices' at a birthday?", any language, including Filipino-English speech) or
  **who was there** ("all media from Kristoff"), photos and video moments together.
- Every result opens on the exact moment, with its time range and why it matched; "Refined by Muse
  Spark" shows when the AI reranked. When a request is unclear, Muse Spark asks "Did you mean…"
  (search for it, or make a short about it).

**Duplicates and near-copies**
- Exact copies are found by content; near-copies (trimmed, re-encoded, exported again) by comparing
  moments, with a similarity score ("99% the same as Live concert performance… this one looks
  trimmed"), the space each copy uses, and Remove this copy / Keep both. Copies skip all paid AI
  steps.

**iGuide: a step-by-step guide from any video**
- Attach a clip, ask for a guide in plain words ("how to properly season chicken breast"); Muse
  Spark plans it and shows the models it will use, then the agents run in stages with live
  progress: find the steps, frame each step, circle the thing to touch (SAM 3.1), backup voice.
- The finished guide lists numbered steps; each has its still with the SAM 3.1 outline, replays its
  moment of the clip, and is read aloud. Film any task once: a recipe, the laundry, the TV remote.

**iRead: send any document, hear what matters**
- Send a photo or PDF of a bill or letter; Muse Spark reads the page and answers your question
  ("How much do I owe, and when is it due?" → "Your amount due is $79.87. It is due on 27 April
  2022."), read aloud in the device's voice. Ask follow-up questions, or have the whole letter read.
- Built for anyone with fading or blurry vision; answers come only from the page.

**iListen: any recording, any language, your summary**
- Drop in a recording or a video in any language, even mixed. iListen shows who spoke and in which
  language ("日本語 Japanese 100%"), translates every line into yours (English or the original, side
  by side), writes a summary with key points, and reads it aloud.
- An agent reviews the translation before you see it: each line is translated back and compared,
  re-done if it fails (pass mark 90%), and the result is shown as "Checked 100%" or "Needs a human
  check". Muse Image paints a cover for each recording.

**Shorts, faces and more**
- Agentic shorts: Muse Spark plans the edit, the renderer draws it, Muse Spark watches the draft,
  critiques it and revises; open the cut in Final Cut Pro or DaVinci Resolve (FCPXML).
- Faces of people and pets, named once by you; opt-in matching across clips; bystanders can be
  hidden. Segments group any mix of files.

---

## Agents

Every feature that takes more than one model call runs as an agent loop with a check step, and the
UI shows each stage as it runs.

| Agent | Plan | Act | Check |
| --- | --- | --- | --- |
| **iRecall** | Muse Spark turns a typed or spoken request into an intent (search, Memory Lane, guide, short, read a letter) and shows the plan | Runs the matching pipeline with ticked progress | Asks "Did you mean…" when the request is unclear |
| **Memory Lane** | Picks the moments where the people asked for are on screen, spread across clips and time | Muse Spark writes one line per moment for the viewer, from the face crops and the frame | A second Muse Spark pass checks every line against its frame and rewrites or drops what isn't supported ("6 lines checked; every line held") |
| **iListen** | Splits the recording into short windows so no language is dropped | Voice Transcribe hears it; Muse Spark names each line's language, translates and summarises | Translates every line back, scores it and redoes what fails (pass mark 90%), up to three versions |
| **iGuide** | Muse Spark finds the steps in a task video | Picks a frame per step; SAM 3.1 traces the thing to touch | Each step is replayable against its moment of the clip |
| **Shorts** | Muse Spark plans the edit from your moments | The Remotion renderer draws a draft | Muse Spark watches the draft, critiques it and revises |

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
                              └──► Object storage: Cloudflare R2, Amazon S3, or a local
                                   S3-compatible store (presigned multipart + range reads)
```

### One codebase, two ways to run

| Piece | Live server ("Try it live") | Your machine (`make judge`) |
| --- | --- | --- |
| Computer | One AWS EC2 box (Sydney) | Your computer, in Docker |
| Video storage | Cloudflare R2 | SeaweedFS (S3-compatible, local, free) |
| Meta key | The author's | Yours |
| Address | HTTPS on the server's domain | http://localhost:8080 |
| Code | Same | Same |

One setting (`STORAGE_PROVIDER`: `r2`, `s3` or `local`) picks the store; `docker-compose.judge.yml`
sets it to `local` and starts these containers on your machine:

```
┌──────────────────────── your machine (Docker) ────────────────────────┐
│  Caddy (web server) ── the app at http://localhost:8080               │
│     ├──► API (Rust) ── jobs, search, Memory Lane, Perception Encoder   │
│     ├──► SeaweedFS ── your videos, letters and recordings             │
│     └──► Renderer (Remotion) ── shorts and covers                      │
└───────────────────────────────┬────────────────────────────────────────┘
                                ▼  the only outside call
                       Meta Model API (your key)
```

Media links are signed for `localhost:8080`, and Caddy passes the bucket path through to SeaweedFS,
so the browser and the renderer reach media on the app's own origin. Meta calls carry media as data
URLs, so nothing has to be reachable from the internet.

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
| Storage | Cloudflare R2 on the live server (private, encrypted, presigned multipart upload, range reads, zero egress fees); SeaweedFS (S3-compatible) in the judge stack; Amazon S3 also supported |
| Infra | Terraform (AWS Sydney: one Graviton t4g.large box + EBS), Docker Compose, Caddy (HTTPS); images built on the Mac (arm64) and shipped over SSH |
| Demo video | Remotion project in `video/`: real screen recordings of the app, voice-over generated locally (Kokoro-82M, British English) |
| Quality | CI on every push and pull request (GitHub Actions, the same gates as `make gates`). Rust: `cargo fmt`, `clippy -D warnings`, 1,064 unit, use-case and handler tests with in-memory fakes. Web: ESLint, Vitest (1,319 tests), a raw-colour gate that keeps every colour in the token file. Renderer: 112 tests. See [`tests/`](tests/README.md) |

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

### Source layout and tests

| Package | Source | Tests |
| --- | --- | --- |
| API (Rust) | `api/crates/{core,adapters,contracts,server}/src/` | beside the code, and `api/crates/testkit/tests/` |
| Web app | `web/src/` | `*.test.ts(x)` beside the code |
| Mac app | `desktop/src-tauri/src/`, UI from `web/src/` | `#[cfg(test)]` beside the code |
| Renderer | `render/src/` | `*.test.ts` beside the code |
| Demo video | `video/src/` | – |

`make test` runs every test suite; `tests/run-all.sh` runs the full gates (see
[`tests/README.md`](tests/README.md)), the same as CI on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Run it

The judge path runs the whole app on one machine (Windows, Linux or macOS) with Docker. Media is
kept in a local S3-compatible store (SeaweedFS), so no cloud account or bucket is needed. The only
outside service is the Meta Model API, with **your own key** (the repo is public, so none ships).

**You need:** Docker Desktop (or Docker Engine with Compose v2.24+), about 6 GB free disk and a Meta
AI API key. Nothing else: no Node, Python or Rust on your machine.

```bash
git clone https://github.com/denmarkamanodaya/meta-hackathon-nimbytes && cd meta-hackathon-nimbytes
cp .env.example .env    # fill in the 3 REQUIRED values (see below)
make judge              # downloads the search model once, builds the web app in Docker, starts it all
```

Then open **http://localhost:8080** (Chrome, Edge or Firefox) and sign in with your `DEMO_PASSCODE`.
`make judge-down` stops it; your library stays in Docker volumes and `./data`.

| `.env` value | What to put |
| --- | --- |
| `MODEL_API_KEY` | Your Meta AI API key |
| `DEMO_PASSCODE` | Any passcode you choose; you type it on the sign-in page |
| `SESSION_SECRET` | 32+ random bytes: `openssl rand -hex 32` |

Port 8080 taken? Set `NIMBYTES_PORT=8090` in `.env` and open that port instead.

The search model is Meta's **Perception Encoder**, already converted to ONNX and attached to the
[models-v1 release](https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases/tag/models-v1)
(650 MB, Apache-2.0, checked against its SHA-256). To convert it yourself from Meta's original
instead, run `make models` (needs [uv](https://docs.astral.sh/uv/); about 1.7 GB download); it also
exports the optional MMS-TTS backup voice.

<details>
<summary>Without <code>make</code> (Windows PowerShell)</summary>

```powershell
docker run --rm -v "${PWD}:/app" -v nimbytes-judge-render-modules:/app/render/node_modules `
  -v nimbytes-judge-web-modules:/app/web/node_modules -w /app node:22-bookworm-slim `
  sh -c "cd render && npm ci && cd ../web && npm ci && npm run build"
docker compose -f docker-compose.yml -f docker-compose.judge.yml up -d --build
```

First download `perception-encoder.tar.gz` from the models-v1 release and unpack it so the files sit
in `api/models/pe/`.
</details>

**One minute, no keys:** `cd web && npm ci && npm run dev:mock` runs the app on an in-browser mock
API (Node 22) at http://localhost:5175, so you can click through every screen without the stack.

### Reproduce the demo

Upload a few family videos, a photo of a letter or bill, and a voice recording, then:

- **iRecall search:** "who said 'happy birthday'?", "people laughing on a sofa".
- **Faces:** open Faces and name the people found; then ask iRecall "Show *name* their memories of
  the birthday" for a **Memory Lane** session.
- **iRead:** open the letter and ask "How much do I owe, and when is it due?".
- **iListen:** open the recording; pick the summary language.
- **iGuide:** attach a cooking video and ask "make a guide for this".

### Other ways to run it

- **Development:** `cd web && npm run dev` (port 5173, proxies `/api` to the stack); `make test`
  runs every test suite, `make gates` runs what CI runs.
- **Production (the live server):** `docker-compose.yml` alone, with Cloudflare R2
  (`STORAGE_PROVIDER=r2`) or Amazon S3 and HTTPS through Caddy; deployed by `scripts/deploy.sh`.
- **nimbytes for Mac (macOS only, optional):** the zero-bytes `~/nimbytes` drive. Download the DMG
  from [Releases](https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases), or build
  it with `make desktop-dev` (Tauri; see `desktop/README.md`). It signs in to a server with HTTPS.

```
~/nimbytes/
  Library/     every clip, zero bytes until you play it
  Projects/    FCPXML of AI-made shorts, media already linked
  Shorts/      final rendered shorts
  Exports/     drop a finished edit here; it uploads and appears in your library
```

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
| v2.4.0 – v2.5.0 | 30 Oct | iListen (any language, even mixed, summarised in yours, with a checked translation score), photos in search and the Gallery, Muse Image covers for recordings |
| **v3.0.0 (stable)** | 30 Oct | Recordings, documents and photos are files in the drive with Where and Segment like videos; Projects renamed Segments; an Accessibility group (iGuide, iRead, iListen) |

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
| Perception Encoder PE-Core-B16-224 weights | Apache-2.0 (see `ml/NOTICE`); the ONNX conversion is redistributed in the models-v1 release with the licence and notices | Search and near-copy vectors |
| MMS-TTS `facebook/mms-tts-eng` | CC-BY-NC 4.0 | Read-aloud fallback |
| `@meta-sam/parser` 0.1.0 | SAM License | Decodes SAM 3.1 masks in the renderer |
| ffmpeg, poppler | LGPL / GPL | Media probing, proxies, PDF pages |
| SeaweedFS | Apache-2.0 | Local media store in the judge stack |
| Remotion | Remotion License (free for individuals) | Shorts renderer and the demo video |
| Pexels sample footage (recipe guide in the demo) | Pexels License | Shown with an on-screen credit; no endorsement implied |
| LibriVox recordings: Lu Xun, *The True Story of Ah Q* (Mandarin); Ogawa Mimei, *Akai Rosoku to Ningyo* (Japanese) | Public domain | iListen sample recordings and tests |

Open-source crates and npm packages are listed in `api/Cargo.lock`, `web/package-lock.json`,
`render/package-lock.json` and `desktop/src-tauri/Cargo.lock`.

---

## Licence

nimbytes' own code and docs are released under the [MIT Licence](LICENSE). Meta models, model
weights, sample footage and other third-party pieces keep their own licences (see Third-party).
Build notes, plans and the prompts used during the event are in [`docs/`](docs/README.md).
