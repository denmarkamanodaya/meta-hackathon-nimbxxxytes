# Meta Model API — verified facts

The one source for every fact about the Meta Model API that this repo depends on. Read from
https://dev.meta.ai/docs/ on **2026-10-27**. Anything marked **UNVERIFIED** must be confirmed by a
Phase 0 spike before code relies on it; record the spike result in `LEARNING.md` and update this
file.

## Basics

| Fact | Value | Source page |
| --- | --- | --- |
| Base URL | `https://api.meta.ai/v1` | `/docs/` |
| Auth | `Authorization: Bearer $MODEL_API_KEY` | `/docs/authentication` |
| Protocols | Responses (`POST /v1/responses`), Chat Completions, Messages; OpenAI-compatible | `/docs/protocols` |
| Files | `POST /v1/files` with `purpose: "user_data"`; list / retrieve / delete | `/docs/file-handling` |
| Rate limits | Per team, not per key. `muse-spark-1.3`: 3,000 RPM, 4,000,000 TPM | `/docs/pricing-rate-limits` |

## Models used

| Model id | Used for | Price (2026-10-27) |
| --- | --- | --- |
| `muse-spark-1.3` (standard tier only) | segment JSON, query rewrite, rerank, edit planning, agent tool calls, critique, post caption | $1.25 / 1M input, $4.25 / 1M output, $0.15 / 1M cached input |
| `sam-3.1` | face detection + per-clip identity tracks; stretch: subject tracking for punch-in | video $0.20 / 1,000 frames (50-frame minimum per request); image $2.50 / 1,000 images |
| `muse-voice-transcribe-1.0` | timed transcript + speaker labels | $0.18 / hour of audio, metered per second |
| PE-Core-B16-224 (local, ONNX) | image + text embeddings | $0 (runs on our CPU) |

Never use: `muse-spark-1.3-contributor` (contributor tier lets Meta train on prompts; hard rule 8).

## Muse Spark — video input

- Video must be **mp4**.
- Pass it as an `input_video` content part with `video_url` (a public URL or a base64 data URL), or
  upload through the Files API and pass `{ "type": "input_file", "file_id": "file-…" }`. The docs
  recommend `file_id` for uploaded videos.
- Chat Completions uses a `video_url` content part.
- Example (Responses API):

```json
{
  "model": "muse-spark-1.3",
  "input": [{
    "type": "message", "role": "user",
    "content": [
      { "type": "input_text", "text": "Describe what happens in this video." },
      { "type": "input_video", "video_url": "https://<presigned-s3-url>" }
    ]
  }]
}
```

- **VERIFIED 2026-10-27:** base64 data-URL `input_video` works (inline limit 50 MB per docs). A 7 s
  360p snippet costs 744 input tokens. Default `reasoning.effort` is `high` (861 of 958 output tokens
  were reasoning) — set it low for bulk calls.
- **UNVERIFIED:** max duration, frame sampling rate, whether
  output can be time-grounded. The docs say nothing about any of these.
- Consequence for us: we never ask Spark for timestamps. We cut segments ourselves and send one short
  360p mp4 per segment, so every description is tied to known `start`/`end` values.
- **UNVERIFIED:** whether a presigned S3 GET URL is accepted as `video_url` (it is a public URL for
  its lifetime, so it should be). Fallback: Files API upload.

## Muse Spark — other capabilities we rely on

- Tool calling: supported, including parallel tool calls and streamed tool-call arguments
  (`/docs/tool-calling`).
- Structured output **VERIFIED 2026-10-27, enforced server-side**: Responses API
  `"text": {"format": {"type": "json_schema", "name": …, "schema": …, "strict": true}}`. Every object
  needs `additionalProperties: false` (else HTTP 400) and all properties in `required`; nullable via
  `"type": ["string", "null"]`. Strip `$schema`/`title` before sending. We still validate after.
- `reasoning.effort`: minimal | low | medium | high | xhigh | max (omitted = high). Ingest uses
  `low` (~$0.005, 7 s per 5 s segment); rewrite/rerank use `minimal` (~$0.002, 1.5–3 s).
- Send `"store": false` on every call (default true keeps the response server-side; private footage).
- Prompt caching is automatic for a repeated system prefix (497 cached tokens observed).
- Constrain model-chosen ids with a per-call `enum` on the id property (rerank, plan_edit).
- Prompt caching: `/docs/prompt-caching`. Keep the system prompt and schema as a stable prefix so the
  $0.15 cached rate applies.

## Muse Spark — image input (VERIFIED 2026-10-27)

- Source: https://dev.meta.ai/docs/image-understanding. Responses API content part
  `{ "type": "input_image", "image_url": "<public URL or base64 data: URL>" }` (a plain string, not an
  object; Chat Completions wraps it as `image_url: {url}`). Or `file_id` from the Files API.
- Limits: 50 MB per inline image, 1 GiB via Files API, max 50 images per request (more = HTTP 400);
  jpeg/png/gif/webp/x-icon; an undecodable image = HTTP 400. No `detail` field documented.
- Image tokens scale with resolution (docs: ~1,300–1,500 tokens at ~1280 px). No per-image price:
  billed as input tokens.
- **Live call 2026-10-27** (`face_match`): two 256×256 JPEG dog crops as base64 data URLs, system +
  user text from `api/prompts/face_match.md`, strict `face_match` schema, effort minimal,
  `store: false`. Answer `{"same": true, "confidence": 1.0, "kind": "pet", ...}` (correct: the two
  crops are the duplicated dog clip). Usage 447 input / 156 output (106 reasoning) tokens →
  **$0.0012 per pair**. Response saved in `data/spikes/face_match.json`.
- Note: its reason mentioned the blanket behind the dog although the prompt says to ignore the
  background; watch for background-driven "same" on the demo clips when calibrating.

## SAM 3.1 — video segmentation

- `POST /v1/responses`, `"model": "sam-3.1"`.
- Input: one `input_text` part with a short noun phrase for one concept (`"face"`), plus one
  `input_video` part (`video_url` or `file_id`). Box and point prompts are an alternative to the
  noun phrase, never combined with it.
- Formats: MP4 or MOV with H.264, H.265 or MPEG-4 video. Not VP9 / WebM. Non-faststart MP4 is
  remuxed on upload.
- Limits: up to **15,000 frames** (~10 min) per request; up to **16 tracked objects per frame**.
- **No fps or frame-sampling option.** SAM reads every frame and bills every frame. Consequence: we
  send a **1 fps re-encode** of the proxy, so a 1-minute clip costs 60 frames ≈ $0.012.
- Streaming recommended (`"stream": true`). Each frame arrives as a `response.output_text.delta`
  event. Each line starts with a frame marker, then one record per object: object ordinal, box, mask
  token. Example start of frame 0 with a match:
  `<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>` followed by a mask token.
- Concept prompts return lines in ascending frame order. Box/point prompts may return frames out of
  order; always read the frame marker.
- `metadata.include_confidence: "true"` adds a confidence per box and mask.
- `metadata.propagation_direction`: `both` (default), `forward`, `backward`. Fewer frames tracked
  costs less.
- **VERIFIED 2026-10-27:** line format `<{frame}f>{ordinal}<|box;x1=;y1=;x2=;y2=;w=;h=;c=|><|mask;x=;y=;c=;data=W,H,~…|>`,
  one line per detection, only frames with detections; `usage.video_frames_processed` reports billed
  frames (50 minimum). Same person kept ordinal 0 across consecutive frames (one sample only).

## SAM 3.1, Phase 20 Track B spikes (VERIFIED 2026-10-28, ~$0.05)

Sources: https://dev.meta.ai/docs/sam/segmenting, /docs/sam/reading-segmentation, and the official
parser `@meta-sam/parser@0.1.0` (npm, SAM License).

Prompts (the `input_text` part; never combined with a noun phrase):
- Point: `<Nf>ID<|point;x=..;y=..;w=..;h=..|>`.
  - A negative point is `-<|point;...|>`.
  - `w`/`h` are the displayed media size after rotation. Coordinates are integer media pixels from the top-left.
- Box: `<Nf>ID<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>`. `x2`/`y2` are inclusive.
- Several objects are joined with `,`. The same ID on a later frame re-prompts that object. At most 16 prompted objects.

Images:
- `{"type":"input_image","image_url":"data:image/jpeg;base64,..."}`. The only frame is `<0f>`.
- Billed per image: `usage.images_processed`, $2.50 per 1,000.

Metadata:
- `propagation_direction`: both | forward | backward.
- `include_confidence`: "true".
- `mask_encoding`: lossless (`~`, the default) | one_bit (`!`). Box and point prompts always return one_bit.

Masks:
- `data=H,W,<enc>payload` is **height first**. The H×W raster covers the record's **box** (top-left at x1,y1), not the frame.
- The payload is base85 with a custom alphabet, then an adaptive binary range coder. `decodeMaskToRaster`, `decodeMaskToRLE` and `decodeMaskToSVGPath` in the official parser decode it.

Measured:

| Test | Result | Frames billed | Latency |
| --- | --- | --- | --- |
| Point on a car at frame 0, forward, 16-frame 1 fps clip | Tracked frames 0–4, until the car left the frame; c ≈ 0.97–0.99 | 50 (minimum) | 5.6 s |
| Box prompt, same car | Same track | 50 | 6.2 s |
| `"license plate"` concept, one_bit | 4 plates over 11 frames, boxes as small as 6×8 px at 480×640 | 50 | 4.4 s |
| `"street sign"` on a 6 s range re-encoded at 12 fps | Tracked 59 of 72 frames, one stable id | 72 ($0.0144) | 8.0 s |
| Image `"dog"`, one_bit | Clean cutout; the decoded mask overlays the frame exactly | 1 image | 1.3 s |

- `stream:false` works. The text is in `output[].content[].text`.
- `usage` tokens are 0. Billing comes from `video_frames_processed` / `images_processed`.

## Muse Voice Transcribe — file transcription

- `POST https://api.meta.ai/v1/asr/transcribe`, `multipart/form-data` with two parts:
  - `request`: JSON settings (same as the realtime handshake minus `authorization`). Set
    `"mode": "DIARIZATION"` for speaker labels.
  - `audio`: the file.
- Audio format: **RIFF/WAVE, mono, 16-bit integer PCM, 16 kHz or 24 kHz.** M4A is not accepted.
- Limits: body > 32 MB → `413`; audio > 10 minutes → `400`. A 10-minute 16 kHz mono WAV is ~19 MB.
- Response (default JSON): `sessionId`, `transcript`, `audioDurationMs`, `turns[]`; each turn has
  `turnId`, `startMs`, `endMs`, `transcript`, `speaker` (`speaker` only in `DIARIZATION` mode;
  labels are per transcription, not across clips). **VERIFIED:** labels are letters `A`, `B`, ….
- **Turn-level timestamps only — no word-level timestamps.** Consequence: phrase-level captions
  (owner ruling 2026-10-27): split each turn into 3–5-word phrases and spread them across
  `startMs..endMs` in proportion to character count.
- Realtime streaming also exists (`wss://api.meta.ai/v1/asr/realtime`); not used.

## Muse Image (VERIFIED 2026-10-27, spike 14.0a, $0.02)

- Model `muse-image-1.0`. Price **$0.01 per generated image**, flat (not per token). Limit 150
  requests per minute per team.
- Generate: `POST /v1/images/generations` JSON
  `{model, prompt, n (1-10), size "WxH" (sets the aspect only), output_format png|jpeg|webp
  (default webp), response_format b64_json|url (default b64_json), reasoning_strength low|high}`.
- Edit / anchored: `POST /v1/images/edits` JSON with `images: [{image_url}]`. A `data:image/jpeg;base64,…`
  URL works. Same other fields.
- Response: `{created, data: [{b64_json | url, revised_prompt?}], output_format, usage{input_tokens,
  output_tokens}}`.
- Measured:
  - generate: 15.1 s, 1408x1760 PNG of 4 MB for `size 1080x1350`;
  - edit: 15.9 s, 1152x2048 JPEG of 0.9 MB for `size 1080x1920`.
  Store as JPEG or WebP, never PNG.
- Quality: the storyboard sketch prompt gave a clean pencil + teal wash frame. The edit kept the real
  scene faithfully, reframed it to 9:16 and added the requested band.

## Muse Image, Phase 20 spikes (VERIFIED 2026-10-28, $0.04)

- **Multi-anchor edit works.** 3 frames (dog, street, car) gave one coherent key-art picture: 18.0 s,
  1408×1760 for `size 1080x1350`; 4,535 input / 1,386 output tokens. 6 anchors also accepted (11.8 s).
  The anchor limit was not reached at 6. Fixture `image/edit_multi_anchor_response.json`.
- **Redraw with words works.** Anchors = [the cover, the real frame] + an instruction ("golden hour
  light, cosier") kept composition, subject and place and changed the light: 18.6 s at 1080x1920.
  Fixture `image/edit_instruction_response.json`.
- **Storyboard from a real frame works.** The storyboard prompt + "draw exactly the scene in the
  attached frame" kept the pencil + teal wash style and the real subject (11.2 s).
- `revised_prompt` came back empty on every edit. Usage is tokens only; billing stays $0.01 flat per
  image.

## Perception Encoder (local)

- Model: PE-Core-B16-224, Meta FAIR, Apache-2.0. CLIP-style: image tower and text tower share one
  embedding space, so a text query can find an image.
- Export both towers to ONNX in `ml/` (offline), serve with the `ort` crate on CPU.
- **UNVERIFIED:** clean ONNX export of both towers, embedding width, tokenizer we must reimplement in
  Rust (or export as part of the graph). Spike 0.4 decides. Fallback: a small Python FastAPI sidecar
  running the PyTorch model.
- Repo must carry the Apache-2.0 notice for the model weights (`ml/NOTICE`).

## Cost logging

Every Meta call writes one `model_calls` row (schema in `docs/data-model.md`): model, purpose,
input hash, input/output tokens or frames or audio seconds, computed cost in USD, latency, cache hit.
The runtime source for prices is `api/config/prices.toml` (loaded by the composition root). The
table above records what the docs said on the read date; when a price changes, update the TOML and
this table in the same commit.

## Tool calling on Muse Spark (VERIFIED 2026-10-27)

- Tools in Responses function-tool format with strict schemas (`api/prompts/agent_tools.json`).
- Output items: `function_call` `{id, call_id, name, arguments (JSON string), status}` alongside
  `reasoning` items (with `encrypted_content`) and sometimes a `message` item.
- With `store: false`, send back the full input + every output item (reasoning included) +
  `{"type": "function_call_output", "call_id", "output"}`; this works.
- The strict `text.format` schema still applies to the final answer in the same call.

## Phase 23 spikes: Ready, Respond, Recover (2026-10-28, ≈ $0.25)

Inputs: licensed sample clips in `data/samples/` (DVIDS public domain, Pexels). Scripts and outputs are in `docs/phases/23-spikes/`.

**R1, SAM concepts on disaster footage** (1 fps proxies at 640 px, one_bit masks; 50–60 frames each, ~9 s per call):

| Concept | Clip | Result |
| --- | --- | --- |
| `fallen tree` | Helene debris (943308) | 3 frames on one window, 16 frames on another |
| `tree trunk` | same | 6 frames, 5 objects: finds downed trunks more often than `fallen tree` |
| `debris` | 943308 / 940064 | 13 frames / 11 frames with 16 objects |
| `pile of storm debris` | 943308 | **nothing**: long phrases fail; use short nouns |
| `damaged car` | 940064 | 8 frames, 1 track (the wrecked sedan) |
| `destroyed building` | 940064 | 5 frames |
| `damaged roof` / `roof` | Guam roof repair (887328) | 21 / 32 frames |
| `person` | 887328 | every frame, 8 people tracked |
| `flood water` / `water` | Pexels flooded path | every frame |
| `warning sign` | same | every frame |

Verdict: SAM works on disaster footage with short nouns. Profiles use `tree trunk` + `fallen tree`, `debris`, `damaged car`, `destroyed building`, `roof`, `flood water`, `person`, `warning sign`.

**R2, Spark same-incident check** (2 frames, strict JSON `same | different | unsure` + reason; $0.003–0.008, 3–12 s per pair):
- 10 pairs (5 same place, 5 different): **0 false "same"**. Different pairs: 4 different, 1 unsure.
- Same pairs: 1 "same" (the wrecked car, clear view), 2 "unsure" (blurred or close-up), 2 "different" (same site, very different framing).
- Verdict: high precision, low recall. Spark never merges wrongly, so a Spark "same" can merge directly. Recall must come from more evidence per sighting (2–3 frames, the SAM crop) and from **area grouping** (same category + same area = "probably related" cluster shown to the coordinator, not merged).

**R3, Piper TTS:**
- `pip install piper-tts` in `python:3.12-slim` arm64 Docker works.
- `en_US-amy-medium` (63 MB) speaks an 8.8 s plan line; the whole container run including install took 29 s.
- Voices: **178 voices in 58 languages, no Tagalog/Filipino.** Includes Chinese, Vietnamese, Hindi, Arabic, Spanish, Indonesian, Japanese and Korean.
- Each voice has its own dataset licence (amy: the MycroftAI mimic3-voices terms); check each voice's licence before it ships.

**R4, Ready plan from a walkthrough** (7 frames of Pexels door + path clips, strict JSON, $0.013, 13 s):
- Correct primary exit (the flat front door), obstacles with fixes, route steps with visible landmarks and frame refs, a grab list.
- It said "No second door is visible" instead of inventing one.
- Two prompt fixes needed:
  - it used a gendered pronoun: use the resident's name instead;
  - it used one body word ("hard on knees"): say "uneven steps" instead.

**R5, area from visible clues** ($0.004–0.007, 5 s):
- 940064 read a fallen street sign → "Riverside Dr beneath the highway overpass" (medium confidence).
- 941492 had no clues → "none" (honest, no guess).
- Verdict: area inference is viable as a fallback when the contributor did not pick an area.
