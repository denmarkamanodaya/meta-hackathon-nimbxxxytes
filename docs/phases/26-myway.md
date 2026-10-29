# Phase 26: MyWay, a visual guide to everyday independence (brief + plan, APPROVED 2026-10-29)

## Context
- Phase 25 My Words was reverted on 2026-10-29. The hiccups were device-bound: Apple eye tracking, and silent speech on the iPhone. The owner judged it "no awe-factor". Its work is parked on `parked/phase25`.
- The owner wants **MyWay** for the hackathon:
  - A helper records a short video of a familiar task (washing machine, TV remote, kettle).
  - nimbytes turns it into numbered steps: a real frame per step with the control highlighted, large text, a spoken instruction and a replayable clip.
- Base: `main` = c9de127 (v2.0.4 plus the SAM `store:false` and `WORKERS` fixes).
- Deadlines: demoable Mon 2 Nov, video Tue 3 Nov, submission Thu 5 Nov 10:00 Perth.
- Owner devices: MacBook Pro, Studio Display, iPhones. No iPad.

## Pros and cons

| Pros | Cons / risks | Mitigation |
| --- | --- | --- |
| A clear wow moment: a messy 2-min clip becomes a clean guide with **the real button circled** and spoken steps, in about a minute | "Video to steps" tools exist (Scribe, Tango, Guidde: mostly screen recordings), so it could read as generic | The awe is physical equipment from POV footage: the person's own machine, the control circled by SAM, the clip replayed per step. Pitch that |
| Runs server-side: the frames, highlights and narration audio are files, so no device settings can break it (the My Words lesson) | Step boundaries in POV footage (hands, motion blur) may be off | Spark sees the clip and the transcript; pure rules clamp and order the steps; the helper can edit a step |
| Reuses a lot: ingest, `frame_at`, SAM outline, renderer `/still`, Muse Image footage-board flow, the Mac `Exports/` drop | SAM may miss small buttons or labels | Fallback: no circle, just the frame. A circle is only drawn when SAM finds the named control |
| Meta models used meaningfully: Spark (steps), SAM 3.1 (highlight), Voice Transcribe (the helper's narration), Muse Image (optional illustration), MMS-TTS (voice) | Narration needs a TTS model. MMS-TTS weights are CC-BY-NC (fine for the hackathon). It has not been run on the box yet | Spike S2 on the box **and on the owner's iPhone in silent mode** before any code. Fallback: text plus the helper's own recorded voice from the clip |
| Accessibility, not medical: low ban risk ("health" and "education chatbots" are banned; this is neither) | A wrong step on a risky task could cause harm | Everyday tasks only. Spark labels the task `everyday` / `caution` / `not_supported` (medication, electrical, gas, driving), and `not_supported` makes no guide |
| Fits storage: every guide lives with its original recording and is reachable from the library and the Mac drive | Muse Image could draw a control that isn't there | The real photo is the primary image; an illustration is an optional style, off by default |
| Filmable solo: the owner's own washing machine or TV | Needs a good demo clip | The owner films 1–2 takes with spoken narration on day 1 |

## Decisions (recommendation first)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Input | One guide = one clip (≤ 5 min). Started by "Make a guide" on the clip page (PWA and Mac). Stretch: drop a file into `~/nimbytes/Guides/` and the guide appears by itself |
| D2 | Step image | The real frame at the step's key second, with a SAM outline ring around the named control, a big step number, and no text baked in |
| D3 | Narration | MMS-TTS audio per step (English), cached and played with `<audio>` (plays in silent mode). Fallback: the helper's own words from the clip |
| D4 | Replay | "Show me" loops `start_s`–`end_s` on the 720p proxy (reuse the MacPlayer loop) |
| D5 | Editing | The helper can edit a step's title and instruction; a change regenerates only that step's narration |
| D6 | Storage and run | Job kind `guide` (rebuild `jobs` the 0008 way, migration 0014), so a run survives a restart |
| D7 | Safety | `safety` per guide from Spark; `not_supported` shows "MyWay is for everyday tasks" and makes no steps |
| D8 | Voice (owner ruling 2026-10-29) | **MMS-TTS (Meta)** on our own infra. No Polly. Keeps "Meta models only" |
| D9 | QR guide link (owner: yes) | Opt-in per guide. "Share" copies the guide JSON and its stills and audio to R2 `public/guides/{token}/` (a random 128-bit token). A **Cloudflare Worker** on our zone serves a read-only, phone-first guide page from that prefix, with no login. "Stop sharing" deletes the prefix and the link dies. The app shows a QR code plus a printable QR sticker ("Scan me: how to use this machine"). Before sharing, a warning: "Check the photos: anyone with the link can see them" |
| D10 | Printable PDF (owner: yes) | The PDF is a print of the same public page (print CSS: 2 steps per A4 page, big photo, number, text). Made by **Cloudflare Browser Rendering** (`/pdf` endpoint) on the share URL, stored next to it in R2. Fallback: the browser's own Print → PDF on that page |
| D11 | GPU box (owner: yes, conditional) | SAM and Spark run on Meta's servers, so a GPU only speeds up **our local models** (PE, MMS-TTS). Measure in S2 first. Add an AWS **g5/g6 spot worker**, started only while a guide is processing and stopped afterwards, **only if** S2 shows CPU narration > 2 s per step or a guide takes > 3 min. Terraform behind an owner yes, with the live hourly price quoted first |

## Wire contract (snake_case JSON)

| Route | Body | Answer |
| --- | --- | --- |
| `POST /api/clips/{id}/guide` | – | `202 {guide_id, status:"running"}`; idempotent per clip |
| `GET /api/guides` | – | `[{id, clip_id, title, status, step_count, cover_url, created_at}]` |
| `GET /api/guides/{id}` | – | `{id, clip_id, title, status, safety, language, steps:[Step]}` |
| `PATCH /api/guides/{id}/steps/{n}` | `{title?, instruction?}` | `Step` |
| `DELETE /api/guides/{id}` | – | 204 (also stops sharing) |
| `POST /api/guides/{id}/share` | – | `{url, qr_svg, pdf_url\|null}`; idempotent; the PDF fills in shortly after |
| `DELETE /api/guides/{id}/share` | – | 204; deletes `public/guides/{token}/` |
| Worker `GET https://guide.<domain>/{token}` | – | Public read-only guide page (HTML + R2 assets); 404 once unshared |

`Step` = `{n, title, instruction, start_s, end_s, key_s, image_url, audio_url, highlight: {label}|null}`. Every key is always present (null when empty).

## Phases

| Phase | When | Deliver | Done when |
| --- | --- | --- | --- |
| **26.0 Notes + spikes** | Thu 29 | (a) Write ideas 1–3 (Point to Remember, Last Seen, Voice Book) to `STATUS.md` under "Ideas parked for later", plus `docs/ideas/2026-10-29-remember.md`. (b) The owner films a 1–2 min narrated task (washing machine or TV remote). (c) Spikes ≤ $1: **S1** Spark steps from the clip plus its transcript (new prompt, strict schema); **S2** MMS-TTS: export `facebook/mms-tts-eng` to ONNX in `ml/`, run on the box CPU, then play the WAV on the owner's iPhone **in silent mode**; **S3** SAM text prompt for the step's control on a step frame; **S4** (optional) Muse Image illustration of one step | S1 gives 4–10 correct steps; S2 audio under 1.5 s per sentence and plays on the iPhone; S3 circles the control on ≥ 50% of steps. **If S1 fails, stop and rethink**; if S2 fails, D3 fallback |
| **26.1 Brief + mocks** | Thu 29 – Fri 30 AM | `docs/phases/26-myway.md` (brief, this plan, results). Mocks on the redesign-v2 canvas: clip page "Make a guide", progress, guide overview, step view (phone), safety refusal, Mac Guides list. **Owner approval** | The owner says "obvious what it does" |
| **26.2 Backend** | Fri 30 | Migration 0014: `guides`, `guide_steps`, jobs kind `guide`. Domain `domain/guides.rs`: step rules (ordered, non-overlapping, clamped to the clip, 3–12 steps, title ≤ 6 words, instruction ≤ 18 words), safety enum. Prompt `api/prompts/guide_steps.md` + schema, purpose `GUIDE_STEPS`. Use cases: start, run (steps → frames → highlight → stills → narration), get/list/patch/delete with ownership. Keys `guide_frame`, `guide_still`, `guide_audio` in `keys.rs`. Contracts `contracts/src/guides.rs`; handlers `http/guides.rs` | Unit, handler (incl. `FORBIDDEN`) and wire tests for the Spark, SAM and TTS bodies; gates green |
| **26.3 Renderer + voice** | Fri 30 – Sat 31 | Renderer composition `StepStill` (frame, outline ring from SAM `/mask/path`, number badge) via `POST /still`. TTS adapter: ONNX MMS-TTS through `ort` (like PE), or a `/speak` route, whichever S2 favours, behind a `Narrator` port with a fake. Cache audio per (text, voice) | Wire tests; a real run on the owner's clip makes every step |
| **26.4 Web** | Sat 31 | PWA: "Make a guide" on the clip page, Guides list, guide overview, step view (big image, "Step 3 of 7", 32 px+ text, ▶ Hear, ↻ Show me loop, big Back/Next, swipe with tap fallback), edit step sheet, safety message. Mac: Guides in the sidebar. `dev:mock` fixtures | Lint/test/build green; the owner sees it on the phone over the tunnel |
| **26.5 Share: QR + public page** | Sat 31 (parallel teammate) | `infra/stacks/share/` Terraform: a Cloudflare Worker + route on our zone and an R2 binding (read-only, `public/guides/` only). Worker in `share/` (TypeScript, no framework): renders the guide from `guide.json`, with big type, ▶ audio, ↻ clip loop, and Next/Back. API: share/unshare use cases (copy to the public prefix, delete on unshare), token from `IdGenerator`, QR SVG generated server-side (one small crate; the owner approves the dependency). **`terraform apply` only with an owner yes** | Scan the QR on the iPhone: the guide opens with no login; unshare gives 404 |
| **26.6 Printable PDF** | Sat 31 – Sun 1 | Print CSS on the Worker page. After a share, a job calls Cloudflare Browser Rendering `/pdf` on the share URL and stores `guide.pdf` in the same prefix. The app shows "Download PDF" and "Print QR sticker" (an A6 PDF with the QR and title) | The PDF prints 2 steps per page with readable photos |
| **26.6b GPU worker (conditional)** | Sun 1, only if D11's trigger fires | `infra/stacks/gpu/`: g5/g6 spot instance running the same api image with `WORKER_ONLY=1` and ONNX CUDA, started by the api when a guide is queued and stopped when idle. Live price quoted, owner yes per apply | A guide takes under 60 s |
| **26.5c Mac drop (stretch)** | only if time | `~/nimbytes/Guides/` drop folder: reuse `ExportsService`, upload with a "make guide" flag | Drop a file, and a guide appears with no clicks |
| **26.7 Owner test + freeze** | Sun 1 | The owner runs 2 real tasks; fixes; **freeze** (no new features) | The success test below passes |
| **26.8 Pitch** | Mon 2 – Tue 3 | Deck: replace slides 7–9 (My Words) with MyWay (problem, before/after figure, live demo); README "MyWay" section; demo script; deploy only on the owner's word | Video recorded Tue |

**Team:** teammates in worktrees with the lead merging: `api-guides` (26.2–26.3), `web-guides` (26.4), and `share-guides` (26.5–26.6: Worker, Terraform, PDF). The lead runs the spikes and owns the seams.
**Cut order:** Mac drop → GPU worker → Muse Image illustration → PDF (keep browser Print) → step editing → SAM highlight (keep the plain frame) → MMS-TTS (use the helper's voice from the clip).
**Never cut:** steps from the video, a real frame per step, big text, Show me replay, the safety refusal, the QR link (the wow moment: scan the sticker on the machine and the guide opens).

**Demo (≈ 45 s):** (1) Drop a 2-min washing-machine clip. (2) About 60 s later: 6 steps, each with the dial circled and a spoken instruction. (3) Tap ↻ on step 3: it replays exactly that moment. (4) Tap Share and print the QR sticker. (5) Scan the sticker on the real machine with a second phone: the guide opens with no app and no login.

## Reuse (from exploration)
- Frames and clips: `MediaTool::frame_at`, `snippet`, `range_proxy` (`api/crates/core/src/ports/media.rs`).
- Spark: the `MetaClient::call` + `SparkReasoner::ask_spark` pattern; `SparkDescriber::body` sends video inline (`api/crates/adapters/src/meta/{mod,reasoner,spark}.rs`); prompt loading in `composition/productions.rs` (`Template`, `StrictSchema`).
- SAM: `find.rs` `outline_of`, `tracker.segment` with a text prompt, `MaskRenderer::mask_path`; `domain/sam.rs` `largest`, `to_px`.
- Stills: `Renderer::still` + `RemotionRenderer` (`adapters/src/render.rs`), `CoverStill.tsx` as the base for `StepStill`; `bake_titled_cover` (`usecases/exports/covers.rs`) as the presign-and-render pattern.
- Muse Image (optional): the `MuseImageMaker::draw_footage_board` flow (`adapters/src/meta/image.rs`, `footage_board.md`).
- Jobs: the 0008 rebuild pattern, `JobKind` in `domain/job.rs`, `ByKind` in `usecases/jobs.rs`, `job_runner()` in `composition/mod.rs`.
- Web: the `MacPlayer.tsx` range loop, `useVideoSeek`, `ClipDetailPage.tsx`; the upload flow `services/upload/*`.
- Mac: `desktop/src-tauri/src/services/exports.rs` (`ExportsService`, `is_export_candidate`).
- TTS ONNX pattern: `adapters/src/embed/mod.rs` (`OrtEmbedder::load`, blocking pool); export script pattern in `ml/`.

## Success test (owner judges)
1. A judge understands it in 5 seconds from one step screen.
2. From the owner's 2-min washing-machine clip: 4–10 steps, each matching what happens on screen, within about 90 s.
3. At least half the steps circle the right control; none circles a wrong one.
4. ▶ Hear speaks on the iPhone **in silent mode**; ↻ Show me loops the right seconds.
5. A medication or electrical clip gets the "everyday tasks only" message and no steps.
6. Scanning the printed QR on a second phone opens the guide with no login; after "Stop sharing" the link gives 404.
7. The PDF prints with readable photos, 2 steps per page.

## Owner yeses needed (one per action)
- `terraform apply` for `infra/stacks/share/` (Worker, route, R2 binding).
- Cloudflare Browser Rendering on the account (check the plan's limits and price first).
- The QR-code crate dependency.
- `terraform apply` for the GPU stack, only if D11 triggers, with the live price quoted.

## Verification
- Gates: `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace`; in `web/`: lint, test, build; render gates. Ran vs traced reported separately.
- Wire tests on the Spark, SAM, TTS and renderer `/still` bodies; handler tests for every route.
- Mutation checks: step clamping, the safety refusal, ownership, idempotent start.
- Live check on the local stack: back up the DB first (stop the api), apply 0014, run the owner's clip end to end, check the R2 objects and the step JSON through the API, then the owner tests on the iPhone over the tunnel.
- Rules: mock-first, unit tests only (no e2e), commit locally, no push without the owner's word, Meta models only (MMS-TTS is Meta).

## Spike results

- **S2 MMS-TTS (2026-10-29, Mac M-series CPU):** `ml/export_mms_tts.py` (commit eab0a2f). ONNX export at opset 17 works (114 MB, `ml/out/mms-tts-eng/`, git-ignored). A 3.6 s sentence: PyTorch 0.31 s, ONNX Runtime 0.26 s. Noise scales are set to 0 so the output is deterministic. Expect about 3–4× slower on the t4g.large, still about 1 s per step, so the D11 GPU trigger does not fire. Pending: the owner plays `/spike-tts.html` on the iPhone in silent mode. Licence: CC-BY-NC-4.0, noted in `ml/NOTICE`.

## Build contract additions (lead, 2026-10-29; mocks V33–V38 approved: "perfect go")

Owner approved the mocks plus decisions 1, 2, 3 and 5 (Sidebar MyWay › Guides; circle only when SAM finds the control; one phone page in the app and behind the QR link; no Muse Image). Domain (4) not answered yet, so the Worker ships on its **workers.dev** URL first and a custom domain is one variable later.

- **Guide status:** `queued | running | ready | failed | refused` (refused = safety `not_supported`). **`stage`** while running: `steps | frames | highlight | voice | ready` (V33 progress). `GuideSummary` and `Guide` both carry `status`, `stage` and `error` (null unless failed).
- **Spark answer** (`api/prompts/guide_steps.md` + `.schema.json`, strict): `{safety: "everyday"|"caution"|"not_supported", safety_reason: string, title: string (≤ 6 words), steps: [{title (≤ 6 words), instruction (≤ 18 words, imperative, one action), start_s, end_s, key_s, control (≤ 4 words, the thing to circle, or "")}]}`. Input: the clip's 360p video (≤ 5 min) + its transcript turns. Pure rules clamp it (core `domain/guides.rs`).
- **Step adds `clip_url`:** a per-step 720p MP4 of `start_s`–`end_s` (via `MediaTool::range_proxy` or `snippet`), used by ↻ Show me in the app and on the public page. Final `Step` = `{n, title, instruction, start_s, end_s, key_s, image_url, audio_url, clip_url, highlight: {label}|null}`; every key always present.
- **Step image:** a full frame at `key_s` (`frame_at`) → SAM 3.1 text prompt `control` on that image → largest box/mask → renderer `POST /still` with a new `StepStill` composition (frame, a yellow `#FFE58A` ring around the mask outline, no text). No match → the plain frame, `highlight: null`.
- **Voice:** MMS-TTS ONNX in `api/models/mms-tts-eng/` (model.onnx, vocab.json, tokenizer_config.json: `add_blank` true, `normalize` true (lowercase), char-level vocab, pad token id for blanks), env `TTS_MODEL_DIR=/models/mms-tts-eng`. A `Narrator` port: `speak(text) -> WAV bytes`, run on the blocking pool like `OrtEmbedder`, output 16 kHz mono 16-bit WAV. Cached by (text, voice) in blob storage.
- **Public share layout (R2):** `public/guides/{token}/guide.json` (`{title, steps:[{n,title,instruction,image,audio,clip}]}` with file names relative to the folder), `step-{n}.jpg`, `step-{n}.wav`, `step-{n}.mp4`, `guide.pdf`, `sticker.pdf`. Token = 22-char URL-safe random from `IdGenerator`. Share answer: `{url, qr_svg, pdf_url|null, sticker_url|null}`; `url = {SHARE_BASE_URL}/g/{token}` (env, workers.dev to start).
- **PDF:** after a share, a job calls Cloudflare Browser Rendering's `/pdf` on `{url}?print=1` (env `CF_ACCOUNT_ID`, `CF_BROWSER_TOKEN`; adapter behind a `PdfPrinter` port; missing env = no PDF, `pdf_url` null). The sticker is an A6 page the Worker serves at `/g/{token}/sticker?print=1`, printed the same way.
- **Share state (added during the build):** `GET /api/guides/{id}` carries `share: {url, qr_svg, pdf_url, sticker_url} | null`, and each `GET /api/guides` row carries `is_shared: bool`. The web POSTs share once, then polls GET guide while `pdf_url` or `sticker_url` is null.
- **QR file:** share also writes `public/guides/{token}/qr.svg`, which the Worker embeds on the print views (no QR library in the Worker). `share/` devDependencies are the same pinned versions as `render/` (approved by the lead).
- **Seam pins (confirmed during the build):** same R2 bucket as media; guide.json image/audio/clip are null when missing; `pdf_url = {SHARE_BASE_URL}/g/{token}/guide.pdf`, `sticker_url = …/sticker.pdf`; the HTML sticker route `/g/{token}/sticker` is separate from the file `sticker.pdf`; internal job kinds `guide` and `guide_pdf`; `/still` takes an optional `composition` key (absent = CoverStill).
- **Fields for the mocks (added during the build):** Guide.`safety_reason: string|null`; Guide and the list rows get `clip_title: string|null` and `clip_duration_s: number|null`; `error` is `string|null`. All always present.
- **Scope cut (owner, 2026-10-29):** "cancel the QR and the domain … nice to haves". The whole share track (public Worker, QR, sticker, PDF, Browser Rendering, Terraform) is dropped; teammate `share-guides` was stood down and nothing from its worktree is merged. MyWay = make a guide, view it (Mac + phone), Hear, Show me, Edit, Delete, safety refusal.
- **Demo footage (owner asked to download it):** `data/samples/myway/laundry-task.mp4` (73.9 s, 1080p30, no audio) = 5 Pexels clips of one Samsung front-loader joined: detergent drawer → softener → dial → dial + Start → clothes out. Sources and licence in `data/samples/myway/SOURCES.csv` (Pexels License).
- **S1 Spark steps PASSED (2026-10-29):** `docs/phases/26-spikes/s1_steps.py`, whole 360p clip inline, strict schema, effort low. Plain video: 10 steps in 16.9 s (19.4k input / 1.9k output tokens), times line up with the clip joins (dial 34.6–39.2 s inside the 31.7–42.0 s dial clip). With a burned-in timecode: 8 steps, coarser, and it missed the first dial clip. **Use the plain video.** Misses: the Start press in the 42–57 s clip, and the final "take clothes out" was read as "load the clothes" (the clip is ambiguous). Safety: everyday. Results in `docs/phases/26-spikes/s1_plain.json` / `s1_tc.json`.
