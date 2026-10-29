# Phase 28: iGuide rename + iRead (read my letter to me) — plan

## Context
- v2.2.0 is live (Ask box). Owner wants two things next, built in dev first:
  1. **Rename Guides to iGuide** ("intelligent guide" / "I will guide you"). Copy only.
  2. **iRead**, for older people with poor eyesight:
     - Upload a document (a photo of a letter, or a PDF).
     - In the Ask box, add it and ask ("summarise this letter for me").
     - Muse Spark reads it and answers, and the answer is **read aloud** (MMS-TTS).
- Owner rulings (2026-10-29): **photos + PDF** (adds poppler to the api image); **Mac + a phone iRead page**.
- What the code has today (two Explore passes):
  - Uploads, clips and ingest are video-only end to end: `MediaExt` = mp4/mov/m4v (`core/domain/media.rs:7`); the Mac picker filters Video (`desktop commands/folder.rs:54`); the PWA picker is `accept='video/*'`. There is no photo, PDF or OCR path.
  - Spark takes images: `{"type":"input_image","image_url":"data:image/jpeg;base64,…"}` (used in `meta/label.rs:48`, `face_match.rs:36`), ≤ 50 images per request, jpeg/png/gif/webp. There is no PDF input (docs/meta-api.md:78-83).
  - Narrator port `Narrator::speak(text) → 16 kHz WAV` (`core/ports/guides.rs:93`), `OnnxNarrator` (one pass per call, no length cap). It is cached by `narration_hash` (`domain/guide.rs:419`) plus a key in R2 (`usecases/guides/mod.rs:335 voice_step`).
  - Ask intents: kinds in `domain/intent.rs:30`, `settle` at :336, prompt `prompts/intent.md`, contracts `contracts/src/ask.rs`. The web side is `core/ask/plan.ts` (TAG, planRows), `jobs.ts` (doneLine), `hooks/useAsk.ts` (run map; a missing kind silently does nothing) and `AskPlanCard`.
  - Audio player: `services/media/step-audio.ts` `createStepAudio` (exposed as `useServices().stepAudio`).
  - The Ask box is Mac-only; the phone has `pages/SearchPage.tsx`.
- Latest migration is 0014; the next is **0015**.

## Design
**Documents are their own thing, not clips** (clips mean video ingest). A document is 1–10 page images (a photo, or the PDF's pages) plus the text Spark read from them, and it lives in the library like guides do.

Flow:
1. **Upload.**
   - `POST /api/documents` `{filename, content_type, size}` → `{document_id, upload_url}` (one presigned PUT, ≤ 20 MB, jpeg/png/webp/pdf).
   - Then `POST /api/documents/{id}/complete` queues a `read` job.
2. **Read job** (jobs kind `read`, migration 0015 rebuild the 0008 way):
   - PDF → `pdftoppm -r 150 -jpeg -l 10` (new `MediaTool::pdf_pages`, timeout from composition); an image is normalised to a JPEG ≤ 2000 px by ffmpeg.
   - Pages are stored under `users/{u}/documents/{doc}/page_{n}.jpg`.
   - **Muse Spark** (new prompt `api/prompts/document_read.md` + schema; store:false; strict) returns `{title, kind: letter|bill|form|notice|label|other, sender, date, text, summary}`.
   - `text` is the full reading-order text; `summary` is ≤ 60 words in plain words.
   - Status: `reading → ready | failed`.
3. **Ask** `POST /api/documents/{id}/ask` `{question}` → `{answer, audio_url}`.
   - Spark is called text-only with the document's stored text (cheap and fast). Prompt `document_answer.md`: plain, short sentences, ≤ 120 words, quotes amounts and dates exactly, says when the page does not say, never gives medical, legal or money advice (it says "ask someone you trust" instead).
   - The answer is spoken by the Narrator: split into sentences (pure rule), one `speak` per sentence, then the WAVs are joined (pure helper on the PCM).
   - The audio is cached in R2 by `narration_hash(VOICE, answer)` → `documents/{doc}/voice_{hash}.wav`.
4. **Read it all** `POST /api/documents/{id}/speak` `{part}`: the full text in parts of about 400 characters, each spoken on demand and cached; the client plays part n, then n+1.
5. **List / detail / rename / delete**: `GET /api/documents`, `GET/PATCH/DELETE /api/documents/{id}`. Delete removes the pages and voice objects (new `keys::document_objects`, using the parallel delete) and the rows.

**Ask box (Mac):**
- New intent kind **`read_document`** with `document_ids` and `question`.
- The intent prompt also receives the caller's documents (id, title, kind, date), so "read my electricity letter" works without "+".
- `settle`:
  - It needs exactly one owned document, else unclear with "Add the letter with +".
  - The question defaults to "Tell me what this says".
- "+" menu gains **"Add a document…"** (pick from iRead, or upload a photo or PDF). Document chips show a page thumbnail.
- Plan card steps:
  1. Read the page (Muse Spark; done instantly if already read).
  2. Answer your question (Muse Spark).
  3. Read it out loud (MMS-TTS).
- On done: the **answer card** shows the answer in large type (24 px), auto-plays the voice, and has Play / Stop / "Read the whole letter".

**iRead section** (copy as the owner names it):
- **Mac:** FEATURES gains **iRead** under iGuide and Shorts.
  - List: page thumb, title, kind, sender, date.
  - Detail: page image(s) with zoom, the text in large type, a question field + hold-to-talk, big Read aloud.
- **Phone:** the Features switch gains iRead.
  - The iRead page leads with one huge "Snap a letter" button (camera via `<input type="file" accept="image/*" capture="environment">`) and "Choose a PDF".
  - Then the detail page: a huge **"Read it to me"** (plays the summary), **hold to ask** (reuses `useVoiceNote` + transcribe), and the answer in large text.
  - Big touch targets (≥ 56 px), text ≥ 22 px.

**iGuide rename:** copy only. Routes, API, the `make_guide` kind, keys and identifiers stay.
- About 30 web strings: `core/guides.ts` GUIDE_COPY, `core/delete-copy.ts`, `core/ask/plan.ts` TAG, `jobs.ts`, `AskPlanCard`, the `MacAskBox` placeholder, `CreateSheet`, the hook toasts, `GuideStepPage`.
- 9 test files.
- API user-visible errors and `FALLBACK_TITLE` ("My iGuide").
- Naming rule: use iGuide everywhere a guide is named, for example "Make an iGuide", "Open iGuide", "3 iGuides", "Delete iGuide?".

## Phases
| # | Deliver | Done when |
|---|---|---|
| 28.0 | iGuide rename (lead, small): one commit, tests updated | gates green, no "Guides" left in the UI |
| 28.1 | **Mocks** on the redesign-v2 canvas: Mac iRead list + detail, the Ask box with a document chip + plan + answer card, phone snap → "Read it to me" → hold to ask. **Owner approval** | owner says yes |
| 28.2 | **Spike** (≤ $0.10): Spark reads 3 real samples (a phone photo of a letter, a 2-page PDF via pdftoppm, a bill) to text + summary; answer 3 questions; time MMS on a 120-word answer | the text is right, the answer is grounded, voice under 5 s |
| 28.3 | API (teammate `iread-api`): migration 0015, domain rules (sentence split, part split, WAV join, settle for read_document), prompts, ports (`DocumentStore`, `MediaTool::pdf_pages`, `DocumentReader` Spark), use cases, contracts, handlers, keys; poppler in `api/Dockerfile`; tests incl. wire tests and FORBIDDEN | gates green |
| 28.4 | Web (teammate `iread-web`): services, `core/iread/*`, hooks, Mac iRead pages + the Ask box kind + answer card, phone iRead pages, mock API | gates green; works in dev:mock |
| 28.5 | Mac app: the picker accepts jpg/png/webp/pdf for "Add a document…" (a separate filter from video), lead | gates green |
| 28.6 | Integrate on `test/iread`, rebuild the local stack, owner tests in the Mac dev app + phone over the tunnel | owner OK |

Cut order: Read it all → PDF > 3 pages → phone hold-to-ask (keep "Read it to me") → rename / zoom. Never cut: photo upload, Spark read, answer + read aloud, Ask box `read_document`, phone snap + "Read it to me".

## Risks and how they are handled
- **Ban list** (health and nutrition): iRead is accessibility (reading for low vision), not medical. The answer prompt refuses medical, legal and money advice, and a medicine label is read, never advised on.
- **Wrong reading:** the answer quotes the page; the page image is always one tap away; Spark is told to say "the page does not say" rather than guess.
- **Privacy:** letters are personal. They are stored like clips (private R2, presigned GET), Spark gets `store:false`, and Delete removes everything.
- **Voice length:** a sentence split keeps each MMS pass short; long text goes through "Read it all" in parts.

## Verification
- Gates: `cargo fmt/clippy/test`, web lint/test/build (+ build:desktop), desktop gates, render gates.
- Unit tests: sentence and part split, WAV join (header plus sample count), settle rules, ownership (FORBIDDEN), job steps with fakes. Wire tests: the Spark read body (input_image parts, store:false, schema), the answer body, and the pdftoppm args.
- Mutation-check: the ownership guard, the 10-page cap, the WAV join length.
- Live: local stack on `test/iread` with a DB backup first. The owner snaps a real letter on the iPhone over the tunnel, asks in the Mac Ask box, and hears the answer.
- Commits stay local; push, deploy or release only on the owner's word.

## 28.2 Spike results (2026-10-29, ~$0.05)
Samples (synthetic, in the scratchpad `28-spikes/samples`): a phone-like photo of a water bill (rotated, dimmed, noisy) and a 2-page council rates PDF (pdftoppm -r 150 -jpeg).

| Case | Read | Notes |
|---|---|---|
| Bill photo | 3.5 s; title, kind bill, sender, date right; summary has $142.60, 14 November 2026, 1300 555 019 | full text 85 words, every key figure exact |
| Rates PDF, 2 pages | 8.7 s; total $1,860.00, due 30 November 2026, BPAY 4455, concession phone | 1,222 words of text |

Answers (text-only Spark, 2–5 s each): grounded and exact ("You have 3 ways to pay…", "Pensioners may get a 50% concession. Call 08 9555 0100"); off-page questions get "The document does not say…" (pet fee, doctor).

Prompt fixes for the build:
- "summarise…" gave a long line-by-line list; the answer prompt must keep a summary to ≤ 60 words in a few sentences.
- "ask someone you trust" was added where no decision was asked ("how do I pay"); only add it for a real decision (should I, can I, is it safe).

Voice: MMS-TTS measured 0.26 s per sentence on the box CPU (Phase 26 S2), so a 120-word answer (~10 sentences) is about 2.6 s. Within the target.
Verdict: go.

## Owner approval (2026-10-29)
Mocks V46–V51 approved as drawn: iRead under Features on the phone (iGuide | Shorts | iRead); 24 px answer text; Read it to me plays the summary first; Mac keeps the page preview in the right column.

## Wire contract (snake_case; api owns it in `api/crates/contracts/src/documents.rs` + `ask.rs`)

Types:
- `DocKind` = "letter" | "bill" | "form" | "notice" | "label" | "other"
- `DocStatus` = "uploading" | "reading" | "ready" | "failed"
- `DocumentSummary` = `{id, title, kind, sender, date, status, page_count, thumb_url|null, created_at, error|null}` (`title` "" until read; `sender`/`date` may be "")
- `DocumentDetail` = DocumentSummary + `{summary, text, pages: [{n, image_url}], summary_audio_url|null}`

| Route | Body | Answer |
|---|---|---|
| `POST /api/documents` | `{filename, content_type, size_bytes}`; content_type one of image/jpeg, image/png, image/webp, application/pdf; size ≤ 20 MB | `201 {document_id, upload_url}` (presigned PUT, 15 min; the client PUTs the raw file with that content type) |
| `POST /api/documents/{id}/complete` | – | `202 {document_id, status:"reading"}`; queues job kind `read`; idempotent |
| `GET /api/documents` | – | `[DocumentSummary]`, newest first |
| `GET /api/documents/{id}` | – | `DocumentDetail` |
| `PATCH /api/documents/{id}` | `{title}` (1–60 chars, tidied like guide titles) | `DocumentDetail` |
| `DELETE /api/documents/{id}` | – | 204; removes rows + all objects |
| `POST /api/documents/{id}/ask` | `{question}` (1–500 chars) | `200 {question, answer, audio_url}`; 409 `NOT_READY` style error (use the existing code for "not ready", e.g. VALIDATION_FAILED with a clear message, if no such code exists) while reading |
| `POST /api/documents/{id}/speak` | `{part}` (0-based) | `200 {part, parts, text, audio_url}`; the full text split in parts of about 400 characters at sentence ends |

- `summary_audio_url`: the summary spoken after the read job finishes (part of the job, so "Read it to me" is instant).
- Errors: VALIDATION_FAILED (type, size, empty, bad part), NOT_FOUND, FORBIDDEN (another user's document), MODEL_UNAVAILABLE.
- Read job: PDF → `pdftoppm -r 150 -jpeg -l 10`; image → JPEG ≤ 2000 px (ffmpeg); pages stored at `users/{u}/documents/{doc}/page_{n}.jpg`; Spark `document_read` prompt + schema (spike wording, see above); then the summary voice. Status reading → ready | failed (error text kept).
- Ask: Spark `document_answer` prompt, text-only with the stored text. A summary request is ≤ 60 words; "ask someone you trust" only for a real decision. Voice: sentences → `Narrator::speak` each → joined WAV; cached `documents/{doc}/voice_{hash}.wav` with `narration_hash(VOICE, text)`.

### Ask box additions (`POST /api/intents`)
- Request gains `document_ids: [string]` (0–5, the caller's; else FORBIDDEN). Default `[]` so older clients still work.
- Spark context gains the caller's documents (id, title, kind, sender, date), newest 30.
- New kind `read_document`. Response gains `document_ids: [string]` (always present) and `question: string|null` (always present).
- settle: read_document needs exactly one document: the added one, or one Spark picked from the list (must be the caller's). None → unclear with the choice label "Add the letter with +" (text = the original request). `question` defaults to "Tell me what this says".

### Web runs read_document
Plan rows: Read the page (Muse Spark; done at once if status is ready, else poll the document until ready) · Answer your question (Muse Spark) · Read it out loud (MMS-TTS). Run = POST ask, then play `audio_url` through `useServices().stepAudio`. Done card = the answer card (V48).
