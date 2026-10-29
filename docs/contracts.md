# Contracts

HTTP endpoints between `web/` and `api/`, plus the JSON shapes exchanged with Muse Spark. The Rust
types in `api/crates/contracts` are the one source; the TypeScript mirror is
`web/src/services/api/types.ts` (one file, nowhere else). Any change edits both in the same commit.

## Conventions

- Base path `/api`. JSON bodies. Session cookie `nb_session` (HttpOnly, Secure, SameSite=Lax).
- Errors: HTTP status + body `{ "error": { "code": "UPPER_SNAKE", "message": "…" } }`. Codes are the
  `ErrorCode` enum in `core` (re-exported by `contracts`) (for example `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_FAILED`,
  `UPLOAD_INCOMPLETE`, `MODEL_UNAVAILABLE`, `MEDIA_FAILED`, `RENDER_FAILED`).
- Live progress: Server-Sent Events (`text/event-stream`). No WebSocket.

## Endpoints

| Method + path | Request | Response | Phase |
| --- | --- | --- | --- |
| `POST /api/session` | `{ passcode }` | `{ user_id }` + cookie | 1 |
| `POST /api/uploads` | `{ filename, size_bytes, content_type }` | `{ upload_id, clip_id, part_size, parts: [{ n, url }] }` | 1 |
| `POST /api/uploads/{id}/parts` | `{ part_numbers: [n] }` (re-presign for resume) | `{ parts: [{ n, url }] }` | 1 |
| `POST /api/uploads/{id}/complete` | `{ parts: [{ n, etag }] }` | `{ clip_id, status: "uploaded" }` | 1 |
| `GET /api/clips` | – | `[{ clip_id, filename, duration_s, recorded_at, status, thumb_url, segment_count, people[] }]` | 4 |
| `GET /api/clips/{id}` | – | `{ clip, proxy_url, segments[], turns[], speakers[], tracks[] }` | 4 |
| `GET /api/clips/{id}/events` | – | SSE: `{ step, status }` per pipeline step | 2 |
| `GET /api/people?prefix=` | – | `[{ person_id, name }]` | 5 |
| `PUT /api/tracks/{id}` | `{ name? , hidden? }` | `{ track }` | 5 |
| `PUT /api/speakers/{id}` | `{ display_name }` | `{ speaker }` | 5 |
| `POST /api/search` | `{ query }` | `{ rewritten: { keywords, filters }, results: [{ segment_id, clip_id, start_s, end_s, thumb_url, reason?, score }] , reranked: bool }` | 5 |
| `POST /api/search/stream` | `{ query }` | SSE: `local`, then `ranked` or `error`, then `done` (see "Search stream (v1.1)") | v1.1 |
| `POST /api/shorts` | `{ prompt, segment_ids[], aspect: "4:5"\|"1:1", target_s }` | `{ short_id }` (agent job queued) | 7 |
| `GET /api/shorts/{id}` | – | `{ short, versions[], steps[] }` | 6 |
| `DELETE /api/shorts/{id}` | – | 204, empty body (see "Deleting a short (v1.1)") | v1.1 |
| `GET /api/shorts/{id}/events` | – | SSE: each `agent_steps` row as it is written | 7 |
| `PUT /api/shorts/{id}/timeline` | `{ timeline }` (user reorder/drop/trim) | `{ version }` | 6 |
| `POST /api/shorts/{id}/render` | `{ version_n }` | `{ job_id }` | 6 |
| `GET /api/shorts/{id}/download` | – | `{ url }` (presigned) | 6 |
| `GET /api/costs` | – | `{ total_usd, by_model: [...] }` (demo transparency) | 8 |

## Response shapes (agreed with web, 2026-10-27)

Field-for-field; empty lists are `[]`, never null or missing; booleans are JSON booleans; spans are
half-open `[start_s, end_s)` in clip seconds; `segments` and `turns` sorted by `start_s`.

```
ClipSummary { clip_id, filename, duration_s: number|null, recorded_at: ISO string|null,
  status: "uploading"|"uploaded"|"processing"|"ready"|"failed", thumb_url: string|null,
  segment_count: number, people: string[] }
ClipDetail  { clip: ClipSummary, proxy_url: string|null, segments: Segment[], turns: Turn[],
  speakers: Speaker[], tracks: Track[] }
Segment { segment_id, idx: int>=0, start_s, end_s, description: string|null, actions: string[],
  objects: string[], place: string|null, mood: string|null, quality: 0–10|null,
  hook_score: 0–10|null, thumb_url: string|null }
Turn    { turn_id, start_s, end_s, text, speaker_id: string|null }
Speaker { speaker_id, label (raw Transcribe letter, e.g. "A"), display_name: string|null }
Track   { track_id, crop_url: string|null, first_s, last_s, person_name: string|null, hidden: bool }
SSE /api/clips/{id}/events: unnamed events, data {"step": probe|proxy|derivatives|segments|
  transcribe|describe|faces|embed|index|ready, "status": running|done|failed}; cookie-authorised
  (EventSource withCredentials). Client closes after ready/done or any failed.
```

Search + people (agreed with web, 2026-10-27):

```
POST /api/search { query } → { rewritten: { keywords: string[], filters: SearchFilters },
  results: SearchResult[], reranked: bool }
SearchFilters { people: string[], speakers: string[], place: string|null, from: string|null,
  to: string|null, min_quality: 0–10|null }   // any field may be omitted = no filter
SearchResult { segment_id, clip_id, start_s, end_s, score: number, thumb_url: string|null,
  reason: string|null /* always present; null when rerank did not run */, clip_filename,
  recorded_at: string|null }
GET /api/people?prefix=<escaped> → [{ person_id, name }]
PUT /api/tracks/{id} { name?: string, hidden?: bool } (only the changed field) → Track
PUT /api/speakers/{id} { display_name } → Speaker      // names trimmed, never empty
Deep link: /clips/{clip_id}?t=<start_s>
```

Shorts (agreed with web, 2026-10-27):

```
POST /api/shorts { prompt, segment_ids[] (pick order), aspect: "4:5"|"1:1", target_s } → { short_id }
GET  /api/shorts/{id} → { short: { short_id, prompt, aspect, target_s,
       status: planning|rendering|critiquing|revising|ready|failed, best_version: int|null,
       render_url: string|null /* null while a final render runs */ },
     versions: [{ n>=1, timeline: Timeline, preview_url: string|null, critique: Critique|null,
       score_total: number|null }],
     steps: [AgentStep],
     segments: [{ segment_id, clip_id, start_s, end_s, thumb_url: string|null, description: string|null }] }
AgentStep { seq>=0, kind: plan|tool_call|tool_result|critique|revise|final, tool: string|null,
  version: int|null, summary, at: ISO }
SSE /api/shorts/{id}/events: unnamed events, data = one AgentStep; client closes after kind "final"
PUT  /api/shorts/{id}/timeline { timeline } → { version }   // manual edit: v2+ WITHOUT revision is valid here
POST /api/shorts/{id}/render { version_n } → { job_id }
GET  /api/shorts/{id}/download → { url }   // presign with response-content-disposition=attachment
```
Timeline clip `subject` may be null; `punch_in` defaults to 1. Revision change `note_index` may be
null only on manual edits.

Uploads: `POST /api/uploads` → `{ upload_id, clip_id, part_size, parts: [{ n, url }] }`;
presigned UploadPart URLs sign no Content-Type or extra headers; `/complete` body keeps ETag quotes
and answers `{ clip_id, status: "uploaded" }`. Wrong passcode and missing cookie → 401
`UNAUTHORIZED`; unknown upload → 404, another user's → 403. `/api/health` is public.

## Timeline JSON (agent ↔ renderer)

```json
{
  "aspect": "4:5",
  "target_seconds": 15,
  "clips": [
    { "segment_id": "s3", "in": 12.6, "out": 15.8, "subject": "the latte art",
      "punch_in": 1.0, "reason": "Strongest visual hook" }
  ],
  "captions": { "style": "phrase", "source": "transcript" },
  "post": { "caption": "Slow mornings", "hashtags": ["#pov"] },
  "rationale": "Open on the latte pour for the hook, then the street walk for pace.",
  "revision": {
    "from_version": 1,
    "changes": [
      { "action": "swap", "detail": "s7 → s9", "why": "Critique at 2.4 s: second shot repeats the first angle", "note_index": 0 },
      { "action": "trim", "detail": "s3 out 15.8 → 14.9", "why": "Critique: hook holds too long", "note_index": 1 }
    ]
  }
}
```

- `rationale` (required, ≤ 200 chars): the agent's overall reasoning for this cut, shown to the user.
- `revision` is `null` on v1 (strict schemas cannot omit keys) and required on v2+. Every change
  names the critique note it answers via `note_index` (0-based into the previous critique's `notes`);
  the server rejects an out-of-range index.
  `action` is one of `add`, `remove`, `swap`, `trim`, `reorder`, `retime_captions`.
- `in` / `out` are seconds on the **clip** timeline and must fall inside the segment's
  `[start_s, end_s]`; the server clamps them and records the clamp in `agent_steps`.
- `punch_in` ≥ 1.0 (1.0 = no zoom). Without a tracked subject the crop is centred.
- `captions.style` is `"phrase"` (owner ruling: no word-level timestamps exist) or `"none"`.

## Segment facts JSON (Spark → describe step)

```json
{
  "segment_id": "…", "start": 0.0, "end": 7.5,
  "description": "one or two sentences, concrete, present tense",
  "actions": ["pouring milk"], "objects": ["latte", "cup"],
  "place": "cafe counter", "mood": "calm",
  "quality": 7, "hook_score": 8
}
```

`segment_id`, `start`, `end` are echoed from our request, never invented by the model. `quality`
and `hook_score` are integers 0–10. Schema file: `api/prompts/segment_facts.schema.json`.

## Critique JSON (Spark → agent)

```json
{
  "version": 1,
  "scores": { "hook": 6, "pacing": 5, "continuity": 7, "captions": 8, "length": 9 },
  "total": 35,
  "notes": [ { "at": 2.4, "issue": "Second shot repeats the first angle", "fix": "Swap s7 for s9" } ],
  "verdict": "revise"
}
```

`verdict` is `"accept"` or `"revise"`. Schema file: `api/prompts/critique.schema.json`.
- `GET /api/costs` → `{ total_usd, by_model: [{ model, calls, cost_usd }] }`; `POST /api/session/logout` → 204, clears `nb_session` (agreed with web 2026-10-27).

## Renderer (Rust ↔ render/, agreed 2026-10-27)

Composition props (Zod in `render/src/composition/schema.ts`; Rust builds them; shared fixture
`render/fixtures/props.sample.json`):

```
{ aspect: "4:5"|"1:1", fps: 30,
  clips: [{ segment_id, src_url: string|null, in_s, out_s (> in_s), punch_in: 1–3, subject: string|null,
            captions: [{ start_s, end_s, text, words: [{ text, at_s }] }] }]   // min 1 clip
  post: { caption, hashtags[] }, end_card_s: 0–3,
  theme: { accent: "#rrggbb", font: string } }
```
- Caption times are in **source-clip seconds**; Rust emits the phrases of every turn overlapping the
  **segment** bounds (not just in/out), so trims in the editor keep their captions.
- `POST {RENDERER_URL}/render { props, quality: "preview"|"final", out_url }` → `{ duration_s, bytes }`;
  400 VALIDATION_FAILED, 500 RENDER_FAILED. Output sizes: preview 544×680 / 540×540, final
  1080×1350 / 1080×1080. One render at a time.
- `GET /api/shorts/{id}` → each version has `composition_props` (props with 1 h presigned proxy URLs).
- AgentStep `tool` values so far: `fit_timeline`, `render_preview`, `render_final` (Phase 7 adds `search_moments`, `get_segment`, `critique_preview`). `versions[].critique` is null until Phase 7.
- Media GET URLs are signed at the start of the UTC hour (X-Amz-Expires = TTL + 1 h) so URLs are stable within the hour; derived objects carry `Cache-Control: private, max-age=31536000, immutable`.
- Phase 7 (built 2026-10-27): `versions[].critique` = `{ version, scores: { hook, pacing, continuity, captions, length }, total (server re-sums), notes: [{ at, issue, fix }], verdict }`; `score_total` = its total. SSE `GET /api/shorts/{id}/events` replays all rows, then streams new AgentStep rows, ends after `kind: "final"`. Step tools: `render_preview`, `critique_preview`, `fit_timeline`, `plan_edit` (+ `search_moments`, `get_segment` once added).

## Redesign additions (2026-10-27)

Rust types: `api/crates/contracts` (`storage.rs`, `people.rs`, `shorts.rs`, `search.rs`, `clips.rs`).
All endpoints need the session cookie (401 without) and only ever show the caller's own data.

```
GET /api/storage → StorageSummary { cloud_bytes: u64, phone_bytes: u64 /* always 0 */,
  frequent_bytes: u64, resting_bytes: u64, clip_count: u32 }
  // bytes = originals' size_bytes of clips past `uploading`; an original is resting when
  // max(created_at, last_viewed_at) is 30 days or more ago (S3 Intelligent-Tiering's
  // Infrequent Access threshold). GET /api/clips/{id} sets last_viewed_at (owner only).

ClipSummary gains title: String
  // written by the ingest step "title" (after "describe"); until then the file name without
  // its extension. Clip SSE steps are now: probe, proxy, derivatives, segments, transcribe,
  // describe, title, faces, embed, index, ready.

SearchResponse gains took_ms: u64, cached: bool, cost_usd: f64
  // cached = every rewrite/rerank call of this search was a model-cache hit (false when none ran);
  // cost_usd = their spend (0 when cached)
SearchResult gains clip_title: String, faces: FaceRef[]
FaceRef { name: string, crop_url: string|null }
  // named, visible tracks seen in the segment; one per person (biggest face), max 3

GET /api/people/overview → PeopleOverview {
  people: PersonCard[] /* clip_count desc, then name */,
  unnamed: UnnamedTrack[] /* newest clip first, then by first appearance */,
  hidden: HiddenTrack[] /* hidden = true, named or not; newest clip first */,
  hidden_count: u32 /* = hidden.length */ }
PersonCard { person_id, name, clip_count: u32 /* clips with a visible track */, crop_url: string|null }
UnnamedTrack { track_id, clip_id, clip_title: string, recorded_at: string|null,
  on_screen_s: number /* last_s - first_s + 1 at 1 fps */, crop_url: string|null }
HiddenTrack { track_id, clip_id, clip_title: string, recorded_at: string|null, crop_url: string|null }
  // naming, hiding and unhiding ({"hidden": false}) stay PUT /api/tracks/{id};
  // GET /api/people stays the autocomplete

GET /api/shorts → ShortListItem[] newest first
ShortListItem { short_id, prompt, aspect: "4:5"|"1:1", target_s, status /* as ShortSummary */,
  created_at: ISO, version_count: u32, best_score: number|null, thumb_url: string|null }
  // best_score = critique total of best_version, else the highest total; thumb = first shot of
  // the best version, else of the latest; null with no version yet
```

## Duplicates and face matching (2026-10-27)

Both workstreams are built: A (duplicates) and B (opt-in face match suggestions).

```text
ClipStatus gains "duplicate"
ClipSummary gains duplicate_of: string|null   // the original clip id; set only when status is "duplicate"
  // a duplicate still lists in GET /api/clips and opens in GET /api/clips/{id} (badge + banner);
  // it is left out of search, the People overview, GET /api/storage and the planner's moment lookups

POST /api/uploads/check {filename: string, size_bytes: u64} → 200 {duplicate_of: {clip_id, title} | null}
  // same user, same filename AND size; a failed clip or a duplicate never matches; oldest match wins.
  // POST so the file name never sits in a URL. 400 VALIDATION_FAILED on a bad body, 401 without a session.

DELETE /api/clips/{id} → 204 (empty body)
  // 404 NOT_FOUND / 403 FORBIDDEN as GET /api/clips/{id}. Allowed for any clip the user owns.
  // Order: Tantivy docs + segment vectors, then S3 objects, then rows (a failure part-way leaves the
  // row, so the delete can be retried). S3 keys deleted, exactly:
  //   originals/{clip}.{ext}, proxies/{clip}_720p.mp4, proxies/{clip}_fps1.mp4, audio/{clip}.wav,
  //   per segment: snippets/{clip}/{segment}.mp4 + thumbs/{clip}/{segment}.jpg,
  //   per face track: faces/{clip}/{track}.jpg      (all under users/{user}/)
  // Short previews/renders belong to shorts and stay. Rows: the upload row, then the clip (segments,
  // transcript, speakers, face tracks cascade).
```

Rules (server):

- The probe step hashes the local original (streaming SHA-256, lower-case hex, `clips.content_sha256`)
  before probing. A clip of the same user with the same hash, not failed and not itself a duplicate,
  makes the NEWER of the two (`created_at`, then id) a duplicate (`duplicate_of` = the older). When the
  copy is the clip being ingested, the ingest stops there: no probe, no proxies, no model call; the
  remaining steps are no-ops and the scratch directory is freed. When the copy is an already-ready
  clip, its Tantivy docs and segment vectors are removed; its rows stay until the owner removes it.
- Worker start queues a `hash` job (new job kind) for every READY clip without a hash. Clips still
  ingesting are skipped: the hash job shares their scratch directory and would remove it.
- Migration 0006 rebuilds `clips` (status CHECK gains 'duplicate'; columns content_sha256,
  duplicate_of; index clips_by_hash) and `jobs` (kind CHECK gains 'hash' and 'face_vectors'). It runs
  with foreign keys off, outside sqlx's transaction (`-- no-transaction`, its own BEGIN/COMMIT): a plain
  DROP TABLE clips with foreign keys on would cascade-delete every segment, transcript and face track.

Face matching (workstream B):

```text
GET /api/settings → 200 {face_matching: bool}          // false until the user turns it on
PUT /api/settings {face_matching: bool} → 200 {face_matching: bool}
  // on: queues the user's face_vectors job (embed new crops, then let Spark check close pairs)
  // off: deletes every face vector and Spark verdict of the user in the same transaction
  // 400 VALIDATION_FAILED on a bad body (deny_unknown_fields), 401 without a session

UnnamedTrack gains group_id: string|null, suggested: {person_id, name, similarity}|null
  // both null while face_matching is off (and group_id null for a face linked to no other
  // unnamed face). group_id = the smallest track id of the group (stable across reloads).
  // Every member of a group gets the group's best suggestion. similarity = Spark's confidence 0–1.

POST /api/tracks/name {track_ids: string[] /* 1–100 */, name: string} → 204 (empty body)
  // all tracks must exist and be the user's, checked before anything changes:
  // 404 NOT_FOUND / 403 FORBIDDEN for the first that is not, nothing named. 400 VALIDATION_FAILED for
  // 0 or > 100 ids or a bad name (1–60 chars after trim). One transaction: finds or creates the
  // person by name (case-insensitive) and links every track; then re-indexes their segments.
```

Rules (server):

- Job `face_vectors` (subject = user id), steps `embed` then `match`; both no-ops while the switch
  is off. Queued by switching on, and by the ingest `ready` step for owners who are on.
- `embed`: every visible track with a crop, outside duplicate clips, without a vector: crop from S3
  to `DATA_DIR/work/users/{user}/`, Perception Encoder `embed_image`, stored in `face_vectors`
  (vec0, FLOAT[1024] cosine, partitioned by user_id).
- `match`: for each vector, its 8 nearest (same user); pairs with cosine ≥ PROPOSE_MIN 0.70 not yet
  judged go to Muse Spark (`face_match` prompt, both crops as `input_image`, minimal effort,
  store:false, cached and cost-logged with purpose `face_match`), most similar first, at most 100
  pairs per run (≈ $0.0012 each). Verdicts land in `face_matches`.
- A link exists only for `same = true` with confidence ≥ CONFIRM_MIN 0.7, between two tracks
  that are both visible and outside duplicate clips. PROPOSE_MIN and CONFIRM_MIN are uncalibrated
  first guesses.
- Vectors and verdicts are written only while the switch is on (checked in the write's
  transaction). Hiding a track, re-ingesting its clip, marking its clip a duplicate, or deleting
  the clip deletes its vectors and verdicts. Unhiding does not re-embed until the next run.
- Migration 0007: `users.face_matching INTEGER NOT NULL DEFAULT 0`, `face_vectors` (vec0), and
  `face_matches(track_a < track_b, user_id, same, confidence, kind 'person'|'pet')` with FK cascades
  to face_tracks.

## Desktop bridge (Phase 10, 2026-10-27)

The Mac app's web layer (`web/`, built with `--mode desktop`) calls the Rust core with Tauri `invoke`.
These names and shapes are the contract between the `desktop` and `web` teammates; the Rust side
owns them (serde structs in `desktop/src-tauri/src/commands/`). Every command uses `#[tauri::command(rename_all = "snake_case")]` with flat params, so JS arg keys are spelled exactly as below.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `server_get` | – | `{ url: string \| null }` | read-only: the build's fixed server (release: build-time `NIMBYTES_SERVER_URL`; dev: `https://localhost`). Never asked, never saved (owner ruling 2026-10-27). `server_set` was removed |
| `api_request` | `{ method, path, body?: string, content_type?: string }` | `{ status: number, body: string, content_type: string \| null }` | `path` starts with `/api/`. Rust sends `Cookie: nb_session=<keychain value>`. A response with a `Set-Cookie: nb_session=…` is stored in the Keychain; a 204 to `POST /api/session/logout` clears it |
| `api_stream` | `{ path, method?: "GET" \| "POST", body?: string, content_type?: string, on_event: Channel<{ event: string \| null, data: string }> }` | `{ stream_id: string }` | SSE (`/api/clips/{id}/events`, `/api/shorts/{id}/events`); ends with a final `{event:"__end"}` |
| `api_stream_cancel` | `{ stream_id }` | `null` | |
| `media_lookup` | `{ kind: "proxy" \| "original" \| "render", id: string }` | `{ path: string \| null }` | absolute path when the file is fully synced; the web side wraps it with `convertFileSrc` |
| `sync_status` | – | `SyncStatus` | also pushed as the event `sync://status` |
| `sync_now` | – | `null` | |
| `set_offline` | `{ clip_id, offline: boolean }` | `null` | pin or unpin the original |
| `set_cache_budget` | `{ gb: number }` | `null` | auto-original LRU budget |
| `open_in_nle` | `{ short_id }` | `{ fcpxml_path: string, opened_with: "final-cut" \| "finder" }` | writes the FCPXML, then opens it |
| `reveal` | `{ kind: "folder" \| "fcpxml" \| "render" \| "original", id?: string }` | `null` | reveal in Finder |
| `sign_out` | – | `null` | clears the Keychain session |

`SyncStatus`:

```
{ folder: string, last_sync_at: string|null, state: "idle"|"syncing"|"offline"|"signed_out"|"error",
  error: string|null,
  counts: { clips: number, shorts: number, originals_offline: number },
  cache: { budget_gb: number, auto_bytes: number },
  transfers: [{ id: string, kind: "proxy"|"original"|"render"|"export",
                name: string, done_bytes: number, total_bytes: number, direction: "down"|"up" }],
  exports: [{ name: string, state: "waiting"|"uploading"|"duplicate"|"uploaded"|"failed", error: string|null }] }
```

Sync API (`api` teammate): `GET /api/sync/manifest` and `POST /api/sync/clips/{id}/original`, with
shapes exactly as in the brief `~/Downloads/nimbytes-mac-prompt.md` §3.1–3.2. Rust types live in
`api/crates/contracts/src/sync.rs`, and the desktop core imports them.

Bridge conventions (verified in the desktop spikes, 2026-10-27):
- Failed commands reject with `{code, message}`. Codes: SERVER_NOT_SET, BAD_SERVER_URL, BAD_PATH,
  NOT_SIGNED_IN, NETWORK, BAD_STATUS, BAD_RESPONSE, KEYCHAIN, IO, SIZE_MISMATCH, NOT_FOUND,
  UNKNOWN_STREAM.
- Every HTTP status, 401 included, is data from `api_request`. Only transport problems reject.
- `api_stream` ends with `{event:"__end", data:""}` on a normal close, or carries the error text. Rust
  never reconnects; the web side reopens the stream.
- The asset protocol scope is the chosen sync folder.

Bridge additions (2026-10-27, after web 10.4):
- `SyncStatus.pinned_clip_ids: string[]`: clips whose original is pinned offline. The web switch reads it.
- `folder_get` → `{ path: string }`: read-only, the build's fixed sync folder (release `~/nimbytes`, dev
  `~/nimbytes-dev`). `folder_choose` and `folder_set` were removed (owner ruling 2026-10-27: server and
  folder are static, never asked). Dev builds also keep their own app data
  (`Application Support/nimbytes-dev`) and Keychain item.
- `pick_and_upload` → `{ queued: number }` opens the native file dialog (mp4/mov/m4v). The Rust upload
  engine (the same one as Exports) uploads, with progress in `SyncStatus.transfers` (`direction: "up"`).
  In desktop mode the web Upload page uses it, so no browser-to-S3 PUT happens from `tauri://` and no
  CORS change is needed.
- In desktop mode, the Remotion Player's composition clip URLs go through MediaResolver (S3 spike passed).
- **Final (2026-10-27):** `SyncStatus.clips: [{ clip_id, proxy: "synced"|"downloading"|"missing",
  original: "pinned"|"auto"|"none", original_on_disk: boolean, proxy_bytes: number }]`, plus
  `local_proxy_bytes`, `pinned_bytes`, `renders`, `projects` and `poll_s` (30), and
  `transfers[].clip_id: string | null` (null for renders). Desktop owns this shape. The web parser
  maps it to its core type.

## Search stream (v1.1)

Added 2026-10-27 (phase 11, workstream C). Additive: `POST /api/search` keeps its shape and
behaviour. Rust: `api/crates/server/src/http/search_stream.rs`; event names are
`nimbytes_contracts::search::stream_event`; the use case is `search_in_stages` in
`api/crates/core/src/usecases/search/`.

```
POST /api/search/stream { query }            // same body and session cookie as /api/search
  error before the first event → the usual non-2xx error envelope (400 VALIDATION_FAILED for an
  empty or > 300-character query, 401 without a session, store failures), no stream
  200 text/event-stream, frames always in this order:
    event: local    data: SearchResponse   // BM25 + PE fused on the raw query; no model call waited on
    event: ranked   data: SearchResponse   // byte-for-byte what POST /api/search answers
      or
    event: error    data: { error: { code, message } }   // ranked stage failed; local stands
    event: done     data: {}               // last frame; the server then closes the stream
```

- `local`: `rewritten` = `{ keywords: the query's lower-cased words (max 8), filters: all empty or
  null }`; `reranked` = false; every `reason` = null; `took_ms` = time to this event; `cached` and
  `cost_usd` count the model calls finished so far (usually false and 0).
- `ranked`: the Spark rewrite starts together with the local stage and refines the keyword leg and
  filters; then Spark reranks. When rewrite or rerank fails or times out, `reranked` = false and the
  order is the fused order. That equals the local order when the rewrite failed too.
- `ranked` may hold other ids than `local` (filters drop hits, rewritten keywords add hits), so clients
  key results by `segment_id`. Thumbnail and crop URLs are presigned again in each event.
- Every `data` is one line of JSON. `done` carries `{}` because a standard SSE reader never dispatches
  an event with empty data.
- The search runs to the end even when the client disconnects, so the model cache still fills.
- Cache key (both endpoints): the rewrite and rerank calls see the query trimmed, lower-cased and with
  every run of whitespace collapsed to one space (`normalise_query`). So "Dog " and "dog" are one
  cached search. The vector leg still embeds the trimmed query as typed.

Bridge addition (v1.1, 2026-10-27): `api_stream` gains optional `method` ("GET" default | "POST"),
`body?: string` and `content_type?: string`, so the Mac app can open `POST /api/search/stream`.
Desktop implements it; web's invoke transport passes them through (snake_case as always).

## Deleting a short (v1.1)

Added 2026-10-27. Rust: `delete_short` in `api/crates/core/src/usecases/shorts/remove.rs`, handler
`shorts::remove`.

```
DELETE /api/shorts/{id} → 204 (empty body)
  // 404 NOT_FOUND for an unknown short, 403 FORBIDDEN for another user's (the same ownership check
  // as GET /api/shorts/{id} and DELETE /api/clips/{id}); 401 without a session. Nothing is removed
  // on 403/404. A second DELETE of the same id is 404.
  // Order: cancel the jobs, then the rows, then the S3 objects:
  //   1. the agent job (subject = short id) and the render job of every version
  //      (subject = "{short}:v{n}") are removed from the queue, so they are never claimed or retried;
  //   2. rows: agent_steps, short_versions, short_segments, then shorts (one transaction);
  //   3. S3 keys deleted, exactly: previews/{short}/v{n}.mp4 for every version n, then
  //      renders/{short}.mp4 (all under users/{user}/; S3 ignores keys that never existed).
  // The clips and moments it was cut from are never touched.
  // A job step already running when the delete lands cannot bring the short back: its next row
  // write fails (foreign keys) and ends the step, and a render that finishes afterwards deletes its
  // own upload. Last, its scratch directory on the box (work/shorts/{short}) is removed.
```

Deleting a clip that shorts were cut from (`DELETE /api/clips/{id}`, any owned clip, any status):
the shorts, their versions and step logs stay. Only that clip's picks (`short_segments` rows)
cascade away. `GET /api/shorts/{id}` still answers 200: its `segments[]` no longer lists the clip's
moments, and every shot on them has `src_url: null` in `composition_props`, which the composition
draws as its placeholder.
