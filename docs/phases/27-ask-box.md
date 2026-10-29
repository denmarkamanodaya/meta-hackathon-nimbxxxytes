# Phase 27: Ask box

Owner approved the mocks on 2026-10-29 (canvas W3EF8HVDXBKnwAjcr96Vu3, row "Phase 27 · Ask box":
AskShell + V39–V45b). Build exactly those.

## Owner rulings (2026-10-29)
1. The box stays 96 px tall (two lines; the text scrolls inside).
2. The plan card sits above the box.
3. Running jobs: a small queue. While two or more run, a "2 working" pill sits above the box and opens the list.
4. Voice is hold to talk: press and hold the mic, speak, release.
5. Intents: Search, Upload, Make a short (from added clips, a project or a search), Make a guide (from an added clip), Add to project.
- Goal: the search box and voice control every shipped feature, driven by what the person asks for.

## Wire contract (snake_case JSON; the api owns it in `api/crates/contracts/src/ask.rs`)

### `POST /api/transcribe`
- Body: raw audio bytes. `Content-Type` is `audio/webm`, `audio/mp4`, `audio/ogg` or `audio/wav`, up to 10 MB.
- The server writes a temp file, then `MediaTool::extract_wav(src, Span{0, 60}, wav)`, then `Transcriber::transcribe(wav)`. It joins the turn texts with spaces and trims the result.
- Answer `200 {"text": "..."}`; the text may be `""` when nothing was said.
- Errors:
  - `VALIDATION_FAILED`: empty body, too large, or an unknown type.
  - `MODEL_UNAVAILABLE`: Transcribe failed.

### `POST /api/intents`
- Body: `{"text": "...", "clip_ids": ["..."]}`.
  - `text`: 1–500 characters after trimming.
  - `clip_ids`: 0–20 of the caller's own clips, the ones added to the box. Another user's clip gets `FORBIDDEN`.
- The server sends Muse Spark (prompt `api/prompts/intent.md` + `intent.schema.json`, strict schema, `store:false`):
  - the text;
  - the caller's projects (`id`, `name`, clip count);
  - the added clips (`id`, `title`, length);
  - how many clips the library holds.
- It validates the answer, then answers `200`:

```json
{
  "kind": "search | upload | make_short | make_guide | add_to_project | unclear",
  "title": "Thai trip sunsets",
  "query": "sunsets",
  "source": "attached | project | search | null",
  "project_id": "prj_… | null",
  "new_project_name": "Birthday | null",
  "clip_ids": ["clp_…"],
  "target_s": 30,
  "aspect": "4:5",
  "choices": [{"label": "Make a short from 60th Birthday + Grad", "text": "make a 30 second short from the 60th Birthday + Grad project"}]
}
```

Every key is always present (null or `[]` when empty). The server enforces these rules, as pure domain rules with unit tests:
- A `project_id` that is not one of the caller's projects becomes `null`.
- `clip_ids` keeps only ids that were sent in the body. Spark can never add a clip.
- `make_short`:
  - `source` is required: `attached` needs ≥ 1 clip, `project` needs `project_id`, `search` needs `query`.
  - Anything else becomes `unclear` with a choice.
  - `target_s` is clamped to 3–90 (default 30); `aspect` defaults to `4:5`.
- `make_guide` needs exactly one clip. With none it becomes `unclear`, with the choice label "Add the task video with +". With several, the first is kept.
- `add_to_project` needs clips plus either `project_id` or `new_project_name`.
- `search` needs `query` (default: the text).
- `unclear` has 1–3 choices; each `text` is a full request the box can send again.
- `title` is at most 60 characters.

Errors: `VALIDATION_FAILED`, `FORBIDDEN`, `MODEL_UNAVAILABLE`.

## How each intent runs (web, using existing services only)

| Kind | Steps shown (ticked from real signals) | Calls |
|---|---|---|
| search | (no card) | go to all results: `libraryQueryPath(query)` |
| upload | Choose files ✓ · Upload N files (the Gallery's upload tiles) | `usePickAndUpload().pick` |
| make_short | Find the moments · Plan the cut · Cut, caption, blur hidden faces · Review and fix | segments: attached or project clips then `shortPool(details)`, or search, top `SHORT_POOL_MAX` segment ids; then `createShort({segment_ids, prompt: text, target_s, aspect})`; progress from `useShort` (status plus `AgentSteps` kinds plan, tool_call, critique, final) |
| make_guide | Find the steps · Frame each step · Circle the controls · Voice each step | `startGuide(clip)`, then `useGuide(id)` stage (`stageRows`) |
| add_to_project | Make the project (if new) · Add N clips | existing project create + add-clips calls |
| unclear | the "Did you mean…" choices; picking one sends its `text` | – |

## Mac permissions (lead)
- `desktop/src-tauri/Info.plist`: `NSMicrophoneUsageDescription`.
- Entitlements: `com.apple.security.device.audio-input` (the app uses the hardened runtime).
- Spike: hold to talk in `make desktop-dev`. If the webview cannot record, typing still works and voice is cut.

## Cut order
Upload intent → add_to_project → unclear choices → voice. Never cut: type → plan card → Run → ticked progress, the 2-working queue, short and guide intents.
