# Build Brief: nimbytes, POV Intelligent Storage + AI Editor (Meta Global AI Developer Hackathon)

## 0. Hard rules (non-negotiable)

1. **Naming:** Never mention any of my other products or earlier project names anywhere: code, comments, commit messages, branch names, README, docs, configs or UI. The app name is `nimbytes` (nimbus = cloud, bytes = smart cache); use only that.
2. **Coding standard:** Use my coding standard via `/dk-coding` for all code you write.
3. **No AI attribution:** Never add Claude or AI attribution anywhere: no `Co-Authored-By` trailers, no "Generated with Claude Code" lines, no AI mentions in commits, PR titles, PR descriptions or code comments.
4. **Speed first:** We have very limited time. Optimise for shipping a working demo. **Do not write or run tests**; I will test manually. Keep code clean but skip polish that doesn't affect the demo.
5. **Parallelism:** `/dk-agents` is allowed. Use multiple agents when work is independent (e.g. frontend vs. backend vs. ML export) to speed things up.
6. **New work only:** This is a fresh repo for a hackathon that requires new work. Do not copy code from any of my other repos. Commit small and often so the history shows the work was done during the event.
7. **Ask before anything costly or irreversible:** creating or destroying AWS resources (`terraform apply`/`destroy`), deleting data, or force-pushing. Everything else, just do it.

## 1. What we're building (one paragraph)

A mobile-first web app (PWA) plus Rust backend that acts as **intelligent storage for Ray-Ban Meta glasses footage**. Users upload POV clips from their phone gallery to S3. Meta's models automatically understand every clip (scene descriptions, objects, speech transcript, speakers, faces). Users search their library in natural language down to the exact moment, tag detected faces with names, and use an **agentic AI editor** that turns selected moments into a post-ready short (4:5 or 1:1, captions), critiquing and revising its own cut before showing it.

Pitch: *"Your glasses capture everything, your phone can't keep it all. We store it, understand it, and turn any moment into a post."*

## 2. Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vite + React + TypeScript, Tailwind, installable PWA, mobile-first |
| API | Rust: Axum + Tokio |
| Jobs | Tokio worker pool + job table in SQLite (status, step, retries) |
| DB | SQLite via `sqlx` (WAL), `sqlite-vec` extension for vectors |
| Search | Tantivy (full text) + sqlite-vec (vectors), reciprocal rank fusion, Spark rerank |
| Media | ffmpeg / ffprobe via `tokio::process` |
| Storage | Amazon S3 (`aws-sdk-s3`), presigned multipart upload, region `ap-southeast-1` |
| AI (all Meta) | Meta Model API, base URL `https://api.meta.ai/v1`, OpenAI-compatible, key in `MODEL_API_KEY` |
| Deep learning | Meta FAIR Perception Encoder PE-Core-B16-224 (Apache 2.0): PyTorch → ONNX export (offline Python script) → served in Rust with the `ort` crate on CPU |
| Infra | Terraform (S3 bucket, IAM, lifecycle rule to Intelligent-Tiering, ECR, App Runner or Lightsail) |
| Deploy | Local-first: `docker compose` for dev; build image locally → push to ECR → Terraform. **No GitHub Actions.** |

Key crates: `axum`, `tokio`, `reqwest`, `serde`/`serde_json`, `jsonschema`, `sqlx`, `tantivy`, `aws-sdk-s3`, `ort`, `tracing`, `uuid`, `thiserror`/`anyhow`.

## 3. Meta models and their jobs

| Model (API id) | Job |
| --- | --- |
| Muse Spark 1.3 (`muse-spark-1.3`, standard tier only, never the contributor tier) | Describe each video segment as strict JSON; query rewrite; search rerank with reasons; edit planning (timeline JSON); agent tool calling; critique previews; post caption + hashtags |
| SAM 3.1 (`sam-3-1`) | Face detection (prompt "face", ~1 fps) with per-clip identity tracks; key-object labels; (stretch) subject tracking for punch-in crops |
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`) | Timed transcript with speaker labels for speech search and captions |
| Perception Encoder (local, ONNX) | Image embeddings per segment thumbnail; text embeddings for queries; duplicate detection |

Read the Meta Model API docs (https://dev.meta.ai/docs/) for exact request shapes, especially Spark video input and SAM video requests. Log tokens/frames and cost for every model call into a `model_calls` table.

## 4. Repo layout (suggested)

```
/api            Rust workspace: axum server, workers, agent, search, media
/web            Vite + React PWA
/ml             Python: export Perception Encoder to ONNX (offline only)
/infra          Terraform
/scripts        make deploy, local helpers
docker-compose.yml
Makefile
README.md
```

## 5. S3 layout

```
users/{user_id}/
  originals/{clip_id}.{ext}
  proxies/{clip_id}_720p.mp4
  thumbs/{clip_id}/{segment_id}.jpg
  faces/{clip_id}/{track_id}.jpg
  audio/{clip_id}.m4a
  renders/{short_id}.mp4
```

Private bucket, SSE encryption, Block Public Access, presigned URLs only, ownership checked on every request.

## 6. Ingest pipeline (one resumable job per clip)

1. Register clip (status `uploaded`), queue job.
2. `ffprobe` + `ffmpeg`: 720p constant-fps H.264 proxy + `.m4a` audio (handle iPhone HEVC and rotation).
3. Segments: `ffmpeg` `scdet` cut points; split long shots into 5–10 s windows; one thumbnail per segment.
4. Voice Transcribe → timed words + speaker labels, attached to segments.
5. Spark → strict JSON per segment: `segment_id, start, end, description, actions[], objects[], place, mood, quality, hook_score`. Validate against a JSON schema; retry once with the error; fallback to a short description.
6. SAM 3.1 faces → one track per person per clip, drop small faces, save one crop per track, link tracks to segments.
7. SAM 3.1 objects (light) → labels for search.
8. Perception Encoder image embedding per thumbnail (ONNX in Rust) → sqlite-vec; segment rows → SQLite; documents → Tantivy.
9. Status `ready`.

Cache every model response by input hash (also makes the demo replayable).

## 7. Search

Index fields: `description` (weighted), `actions`, `objects`, `place`, `mood`, `transcript`, `people` (user-named face tracks), `speakers` (user-named speaker labels), `recorded_at`, `quality`, `hook_score`, plus `image_embedding` in sqlite-vec.

Query flow: Spark rewrites the query into keywords + filters → Tantivy BM25 top 30 and PE text-embedding vector top 30 → reciprocal rank fusion → Spark reranks to top 10 with a one-line reason each → results jump to the exact second. If rerank fails, show the fused order.

## 8. People tags

"People in this clip" row of face crops. Tap a face → type a name (autocomplete from existing names) → name applied to every segment in that track → searchable. Speaker labels can be renamed the same way. A "hide" action for bystanders. Detection only: no face templates, no cross-clip matching.

## 9. Agentic editor

Timeline JSON contract:

```json
{
  "aspect": "4:5", "target_seconds": 15,
  "clips": [
    {"segment_id": "s3", "in": 12.6, "out": 15.8, "subject": "the latte art",
     "punch_in": 1.0, "reason": "Strongest visual hook"}
  ],
  "captions": {"style": "word-by-word", "source": "transcript"},
  "post": {"caption": "Slow mornings", "hashtags": ["#pov"]}
}
```

Agent loop (Spark 1.3 tool calling, orchestrated in Rust): plan → `render_preview` → `critique_preview` (Spark watches the preview and scores hook, pacing, continuity, captions, length with timestamped notes) → revise. Max 2 revisions, capped tool calls, keep the best version on timeout, log every step and cost.

Tools: `search_moments(query, filters)`, `get_segment(id)`, `render_preview(timeline)` (low-res from proxies), `critique_preview(preview, prompt)`, and stretch `track_subject(segment, subject)`.

UI: timeline cards with "why this shot", the critique trail (v1 → v2 → v3), reorder/drop/trim, then final render from originals: cut, crop, concat, burned-in word-by-word captions (ASS subtitles from transcript), H.264 MP4. Clamp in/out to segment bounds; fallback to centre crop if tracking fails.

## 10. Frontend screens (mobile-first)

1. Upload (gallery picker, multiple files, multipart progress, resumable parts, "keep this screen open" notice with Screen Wake Lock).
2. Library (clips → segments, thumbnails, tags, processing status).
3. Clip detail (segments, transcript, speakers, people row for naming).
4. Search (one box, results with reason, jump to moment, select moments).
5. Editor (prompt box, agent progress + critique trail, timeline cards, preview, export/download).

Simple single demo account or email magic link. Don't spend time on auth.

## 11. Build order (milestones)

| Day (Perth) | Deliver |
| --- | --- |
| Tue 27 | Spikes: Spark video input, SAM (objects + "face"), Voice Transcribe, PE → ONNX loaded with `ort` (fallback: Python FastAPI sidecar). Scaffold repos, docker compose, Terraform for S3 + IAM (ask before apply). |
| Wed 28 | Presigned multipart upload, proxy/audio, segments + thumbnails, transcripts with speakers |
| Thu 29 | Spark segment JSON, SAM face tracks + crops, PE embeddings, SQLite + Tantivy + sqlite-vec, library view |
| Fri 30 | Hybrid search end to end, search UI, people + speaker naming UI |
| Sat 31 | Timeline JSON, review cards, final render with captions + crop. **Full loop working.** |
| Sun 1 | Agent tools + plan → preview → critique |
| Mon 2 | Revise loop, guardrails, critique trail UI; stretch only if ahead: SAM punch-in, then a personal highlight ranker (small PyTorch MLP → ONNX) |
| Tue 3 | Deploy from the laptop (Docker → ECR → Terraform), demo-library caching, harden the happy path |
| Wed 4 | README (problem, architecture, Meta models used and where, setup, what was built during the event) |

Cut order if behind: personal ranker → punch-in → agent revisions (keep one critique pass) → vector leg of search. Never cut captions, search or people tags.

## 12. How to work

- Start now with Tue 27 spikes and scaffolding; report each spike result briefly (works / limits found / fallback chosen).
- Then proceed milestone by milestone without waiting for me unless blocked or a rule in section 0 says to ask.
- After each milestone, give me a 3–5 line status: what works, how to run it locally, what's next.
- Environment variables in `.env.example`: `MODEL_API_KEY`, `AWS_REGION=ap-southeast-1`, `S3_BUCKET`, `DATABASE_URL`, `PUBLIC_BASE_URL`.
- Keep secrets out of the repo. The repo will be public.
