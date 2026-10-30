# Data model

The one source for table shapes, S3 keys and index fields. Code implements these in:
SQLite → `api/migrations/`, S3 keys → `api/crates/core/src/keys.rs` (the only place that builds a
key string), Tantivy schema → `api/crates/adapters/src/search/schema.rs`.

## S3 layout

Private bucket, SSE-S3, Block Public Access on, presigned URLs only, ownership checked on every
request.

```
users/{user_id}/
  originals/{clip_id}.{ext}          uploaded file, untouched
  proxies/{clip_id}_720p.mp4         720p constant-fps H.264 (rotation applied)
  proxies/{clip_id}_fps1.mp4         1 fps H.264, input for SAM
  snippets/{clip_id}/{segment_id}.mp4  360p per-segment clip, input for Spark
  thumbs/{clip_id}/{segment_id}.jpg  one per segment
  faces/{clip_id}/{track_id}.jpg     best crop per face track
  audio/{clip_id}.wav                16 kHz mono PCM, input for Voice Transcribe
  previews/{short_id}/v{n}.mp4       low-res agent previews
  renders/{short_id}.mp4             final short
  listens/{listen_id}/source.{ext}   iListen file as uploaded (mp3, m4a, wav, mp4, …)
  listens/{listen_id}/audio.wav      its 16 kHz mono PCM, for Voice Transcribe and playback
  listens/{listen_id}/voice_{hash}.wav  the English summary spoken (MMS-TTS)
  listens/{listen_id}/cover.jpg      Muse Image cover, 720 px, drawn once
  photos/{photo_id}/original.{ext}   photo as uploaded (jpg, png, webp)
  photos/{photo_id}/view.jpg         upright JPEG, long edge 2048 px
  photos/{photo_id}/thumb.jpg        upright JPEG, long edge 480 px
```

Bucket config (Terraform, `infra/`): CORS allows `PUT` from the app origin(s) and **exposes the
`ETag` header** (browser multipart needs it); lifecycle moves `originals/` to Intelligent-Tiering
after 0 days; aborts incomplete multipart uploads after 1 day; expires `previews/` after 7 days.

## SQLite tables

IDs are UUIDv7 text. Times on the media timeline are `REAL` seconds from clip start. Wall-clock
times are ISO-8601 UTC text. JSON columns are `TEXT` holding JSON.

| Table | Columns | Notes |
| --- | --- | --- |
| `users` | `id`, `email`, `created_at` | one demo row |
| `uploads` | `id`, `user_id`, `clip_id`, `s3_upload_id`, `key`, `size_bytes`, `part_size`, `status`, `created_at` | multipart bookkeeping for resume |
| `clips` | `id`, `user_id`, `filename`, `ext`, `size_bytes`, `duration_s`, `width`, `height`, `fps`, `rotation`, `codec`, `recorded_at`, `status` (`uploading`/`uploaded`/`processing`/`ready`/`failed`), `error_code`, `created_at` | `recorded_at` from container `creation_time`, else upload time |
| `segments` | `id`, `clip_id`, `idx`, `start_s`, `end_s`, `description`, `actions` (JSON), `objects` (JSON), `place`, `mood`, `quality` (0–10), `hook_score` (0–10), `facts_status` (`ok`/`fallback`) | one row per 5–10 s window |
| `transcript_turns` | `id`, `clip_id`, `turn_no`, `start_s`, `end_s`, `text`, `speaker_label` | raw from Voice Transcribe |
| `segment_turns` | `segment_id`, `turn_id` | overlap join |
| `speakers` | `id`, `clip_id`, `label`, `display_name` | per clip; renamable |
| `face_tracks` | `id`, `clip_id`, `ordinal`, `first_s`, `last_s`, `crop_key`, `max_area`, `person_id` (nullable), `hidden` (0/1) | one per SAM object ordinal |
| `track_segments` | `track_id`, `segment_id` | track appears in segment |
| `people` | `id`, `user_id`, `name` | unique `(user_id, name)`; autocomplete source |
| `segment_vectors` (sqlite-vec `vec0`) | `segment_id`, `embedding float[D]` | D from PE export (spike 0.4) |
| `jobs` | `id`, `kind` (`ingest`/`render`/`agent`), `subject_id`, `step`, `status` (`queued`/`running`/`done`/`failed`), `attempts`, `last_error`, `run_after`, `updated_at` | worker claims with `UPDATE … RETURNING` |
| `model_calls` | `id`, `at`, `model`, `purpose`, `input_hash`, `input_tokens`, `output_tokens`, `frames`, `audio_s`, `cost_usd`, `latency_ms`, `cache_hit`, `status`, `error` | cost log for every Meta call |
| `model_cache` | `input_hash` (PK), `model`, `response` (JSON), `created_at` | replayable demo |
| `shorts` | `id`, `user_id`, `prompt`, `aspect`, `target_s`, `status`, `best_version`, `render_key`, `created_at` | |
| `short_versions` | `id`, `short_id`, `n`, `timeline` (JSON), `preview_key`, `critique` (JSON), `score_total` | v1, v2, v3 |
| `listens` | `id`, `user_id`, `source` (`file`/`clip`), `clip_id` (nullable, set null when the clip is deleted), `source_name`, `content_type`, `ext`, `size_bytes`, `status` (`uploading`/`listening`/`ready`/`failed`), `step`, `version` (0–3), `target` (one of 12 codes), `title`, `summary`, `key_points` (JSON), `languages` (JSON `[{code, share}]`), `duration_ms` (≤ 2 h), `speakers`, `heard_by` (`clip`/`full`/`windows`), `confidence` (0–100), `passed` (0/1), `summary_audio_key`, `cover_key`, `error`, `created_at`, `updated_at` | iListen; migration 0017 |
| `listen_turns` | `listen_id`, `idx`, `start_ms`, `end_ms`, `speaker`, `text`, `lang`, `translation`, `score`, `issue`, `fixed_in` (1–3) | one per spoken line; the translation columns hold the kept version |
| `listen_versions` | `listen_id`, `version` (1–3), `draft` (JSON: title, turns, summary, key points), `checked` (JSON: line scores, summary score and issues, confidence, passed; null while checking) | every version of the check loop |
| `photos` | `id`, `user_id`, `filename`, `content_type` (`image/jpeg`/`image/png`/`image/webp`), `size_bytes` (≤ 40 MB), `last_modified`, `status` (`uploading`/`analysing`/`ready`/`failed`), `title`, `title_by_owner` (0/1), `description`, `things` (JSON), `place`, `mood`, `width`, `height`, `taken_at`, `camera`, `error`, `created_at`, `updated_at` | migration 0019 |
| `photo_vectors` (sqlite-vec `vec0`) | `segment_id` (the photo's search key `photo_{id}`), `user_id` (partition), `embedding float[1024]` cosine | same shape as `segment_vectors` |
| `listen_voices` | `listen_id`, `key` | every voice file, so delete removes them |
| `agent_steps` | `id`, `short_id`, `seq`, `kind` (`plan`/`tool_call`/`tool_result`/`critique`/`revise`/`final`), `tool`, `args` (JSON), `summary`, `cost_usd`, `at` | the critique trail |

## Tantivy document (one per segment, and one per photo)

A photo's document uses the same fields under the key `photo_{id}` (`clip_id` empty): title and
description in `description`, things in `objects`, `place`, `mood`, date taken in `recorded_at`.
No `kind` field: the key prefix tells a photo from a moment, so the existing index needs no
rebuild.

| Field | Type | Boost | Source |
| --- | --- | --- | --- |
| `segment_id`, `clip_id`, `user_id` | STRING, stored | – | ids |
| `description` | TEXT | 3.0 | Spark |
| `actions` | TEXT | 1.5 | Spark |
| `objects` | TEXT | 1.5 | Spark |
| `place` | TEXT | 1.2 | Spark |
| `mood` | TEXT | 1.0 | Spark |
| `transcript` | TEXT | 1.5 | turns overlapping the segment |
| `people` | TEXT | 2.0 | names of non-hidden tracks in the segment |
| `speakers` | TEXT | 1.0 | display names of speakers in the segment |
| `recorded_at` | DATE, fast | – | clip |
| `quality`, `hook_score` | F64, fast | – | Spark |

Re-index a segment whenever a person or speaker name changes for it.
