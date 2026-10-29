# nimbytes workflows (background jobs)

Saved 2026-10-29 at the owner's request, for future use (pitch, README, deck, onboarding).

There are 10 workflows. Each is a multi-step job run by the server's background worker and tracked in the `jobs` table. Each job stores its current step, so it picks up where it left off after a restart, and failed steps are retried.

| Workflow (job) | Feature | Steps |
|---|---|---|
| `ingest` | Every uploaded clip | probe → proxy → derivatives → segments → embed → similar (near-copy check; a copy stops here) → transcribe (Voice Transcribe) → describe (Muse Spark) → title → faces → index → ready |
| `agent` | Shorts editor | Muse Spark plans the cut and calls tools (search moments, get segment), drafts it, critiques its own cut and revises once. Each step streams live to the app |
| `render` | Shorts export | Remotion renders the cut, captions, hidden-face blur and covers |
| `guide` | iGuide | steps (Muse Spark) → frames (ffmpeg) → highlight (SAM 3.1 circles the control) → voice → ready |
| `read` | iRead | pages (PDF or photo to images) → read (Muse Spark: title, sender, date, text, summary) → voice → ready |
| `similar` | Near-copies (one pass over clips you already had) | re-embed → compare → link. It never hides an existing clip |
| `faces` | People & pets | Face tracks, crops and vectors per clip |
| `face_vectors` | Suggest matching faces | Perception Encoder proposes pairs, then Muse Spark confirms each |
| `title` | Clip names | Muse Spark names each clip |
| `hash` | Exact duplicates | A fingerprint (hash) per original, to catch identical copies |

**iRecall** (the Ask box) also runs a workflow, from the app itself:
1. Muse Spark turns the request into a plan.
2. It waits for Run.
3. It calls the right feature: search, upload, a short, an iGuide, add to project or iRead.
4. It ticks off each step as that feature's own job reports back.

## Where the code is
- Job kinds: `api/crates/core/src/domain/job.rs`, plus the CHECK in `api/migrations/0016_similar.sql`.
- Ingest steps: `api/crates/core/src/usecases/ingest/mod.rs`.
- Runner: `job_runner()` in `api/crates/server/src/composition/mod.rs`, routed by `ByKind` in `usecases/jobs.rs`.
- iRecall: `web/src/hooks/useAsk.ts` and `web/src/core/ask/`.

Voice note: read-aloud uses the device's own voice. The `voice` steps above make the MMS-TTS backup recording.
