# Build Brief: Phase 20 — Meta depth (SAM 3.1, Muse Wonder, Meta AI Connectors + glasses)

nimbytes is built and released (v2.0.2: PWA, API, renderer, Mac app, Production Studio). This phase goes **deeper on Meta's models** and **brings the Ray-Ban Meta glasses into the product** through Meta AI Connectors. It is additive. Nothing shipped is redesigned.

Goal sentence the demo must prove: *"Your glasses see everything. nimbytes remembers it, answers you hands-free through Meta AI, and turns any moment into a post."*

---

## 0. Rules

- `CLAUDE.md` is the rule book. Read it, then `STATUS.md`, `LEARNING.md` "Top lessons", the newest `MEMORY.md` rows, `docs/meta-api.md`, `docs/hackathon-rules.md` and `docs/contracts.md` before any code. Every hard rule applies, in particular:
  - naming
  - new work only
  - no AI attribution
  - fast unit tests only for pure rules, parsers, use cases and handlers, and no e2e
  - ask before costly or irreversible actions
  - local commits only, never `git push`
  - only `README.md` is published among the markdown files
  - Meta models only for AI
  - vanilla CSS + tokens
  - **mock-first for any visual change**
  - never open the live SQLite file
- **UI order:** build backend and API first. For every new or changed screen, prepare a mock on the design canvas and **stop for owner approval** before building it (rule 11).
- **Hackathon guard:** generic "basic RAG apps" are banned. The Ask feature must read as an **agent with tools and actions** (find, recap, make a short, track an object) that works **hands-free from the glasses**, not as chat over documents. Name it accordingly in UI and README.
- Write this plan to `docs/phases/20-meta-depth.md` first. Update `docs/meta-api.md` with every spike result, and `STATUS.md` at the end of each step.
- Days left: submission is due **Thu 5 Nov 10:00 Perth time**, and the demo video is recorded **Tue 3 Nov**. Everything below must be demoable by **Mon 2 Nov**.

---

## 1. Spikes first (one session, ≤ 3 h, about $1 total; record results in `docs/meta-api.md`)

| Spike | Question | Done when |
| --- | --- | --- |
| S1 · SAM point/box prompts | Request shape for a point or box prompt on a given frame; `propagation_direction`; output for one object | One tracked object across a 10 s 1 fps clip, fixture saved |
| S2 · SAM masks | Decode the `<|mask;x=;y=;c=;data=W,H,~…|>` token into a binary mask (the format is unverified; document it) | A mask PNG overlays its box correctly on one frame |
| S3 · SAM at shot fps | Tracking a short range at 10–15 fps: request size, latency, billed frames | Measured cost and latency for a 6 s shot |
| S4 · Muse Wonder | Exact model id on the API (expected `muse-wonder-1.0`; confirm), tool calling with our tool schema, parallel tool calls, whether it accepts `input_video` or images, latency per turn | One 3-tool run recorded as a fixture, with cost |
| S5 · Connector shape | What the Connectors onboarding needs (OpenAPI 3.x vs MCP, OAuth details). If access isn't granted yet, design for both from the public page: "REST API (OpenAPI/Swagger)", "MCP dev tools", "OAuth account linking" | A short note in `docs/meta-api.md` |

Use the existing `MetaClient` for every call: cached, cost-logged, standard tier.

---

## 2. SAM 3.1: from "faces only" to the visual backbone

Today SAM runs once per clip with the concept `"face"` on a 1 fps proxy (boxes stored in `face_boxes`, masks ignored). Add:

| # | Feature | How | Cost guard |
| --- | --- | --- | --- |
| 2.1 | **Subject-aware 9:16 reframe** for exports | For each shot with a `subject` (timeline already has it), run SAM with that noun phrase on the shot range only (S3 fps) → subject box per frame → smoothed crop path (EMA + dead zone + max pan speed, pure function with unit tests) → new optional props `crop_path` per clip in the Remotion composition (cover crop as fallback). Applies to `9:16` exports, optionally to previews | Shot range only, cached by (clip, range, phrase); ≤ 20 shots per export |
| 2.2 | **Tap to track ("Find this")** | On a clip frame, the user taps an object → point prompt (S1) → SAM tracks it through the clip → best crop → PE image embedding → KNN over segment vectors **and** stored face/object crops → "Seen in 7 other clips" with moments. Stores an `object_tracks` row for the clip | 1 fps proxy; one SAM call per tap |
| 2.3 | **Mask-accurate privacy blur** | Replace box blur with mask-shaped blur for hidden tracks: at render time, re-track hidden faces on the shot range at shot fps, seeded with the stored 1 fps box (box prompt, forward propagation), and use the masks (S2). Fallback: today's box blur | Only shots that contain hidden tracks |
| 2.4 | **Privacy pack concepts** | Finish setting "Also blur screens and number plates": SAM concepts `"screen"` and `"license plate"` on shot ranges at render time | Off by default; shot ranges only |
| 2.5 | **Subject cutout covers** | Best hook frame → SAM mask of the subject → transparent PNG → passed to Muse Image as the anchored subject, so covers show the real person, not a lookalike | One SAM image call ($0.0025) per cover set |
| 2.6 | Stretch: **subject effects** | Spotlight, background blur and text-behind-subject from masks in the composition (the Production Studio stretch item) | Only if 2.1–2.5 are done |

New migration (next free number) for `object_tracks` and any mask cache. New adapter functions in `adapters/src/meta/sam.rs` (keep `CONCEPT` behaviour for ingest unchanged).

---

## 3. Muse Wonder: the producer and the long-horizon agent

Muse Wonder is Meta's most capable agentic model: 1M context, parallel tool calls, sub-agent delegation, $4 / $20 per M tokens. Use it **where long, multi-step planning pays**, with Spark as the cheap worker.

| # | Feature | How |
| --- | --- | --- |
| 3.1 | **Producer agent ("Make it for me")** | One instruction ("a 45 s recap of opening day for TikTok") → Wonder orchestrates **existing use cases as tools**: `search_moments`, `get_segment`, `plan_production` (shot list), `check_coverage`, `cut_story` (the existing Spark agent short), `set_finish` (blur, title), `export` (platform pack). It streams its plan as a checklist (SSE, same pattern as short events) and stops at a draft the owner approves before export |
| 3.2 | **Recaps** | `recap(period: day / week / custom, style)` → Wonder reads compact summaries of the period (clip titles, segment facts, people, speech snippets: build a summary builder that fits the context budget), picks the story and runs 3.1. It's triggerable from the PWA, the Mac app and the connector ("Hey Meta, make my week in Perth") |
| 3.3 | **Ask (hands-free assistant brain)** | Router (pure rule + unit tests): single-hop questions → Spark with search tools; multi-hop questions ("which café did I visit most this month and who was with me?") → Wonder with the same tools plus `people`, `speech`, `timeline_of_day`. The answer has a `spoken` line (≤ 25 words), up to 5 moments with deep links, and optional actions (`make_short`, `recap`) |
| 3.4 | Budgets | Per run caps in config: Wonder ≤ $1.00 and ≤ 20 tool calls and ≤ 300 s; Spark worker budgets unchanged; every step in the ledger and the costs screen |

Put orchestration in `core/src/usecases/producer/` (pure planner loop over a `Producer` port). The Wonder client goes in `adapters/src/meta/wonder.rs`, and prompts plus strict JSON schemas in `api/prompts/` (`producer.md`, `recap_summary.md`, `ask.md`, `ask_router` as a pure rule). No new `jobs` kinds: reuse the productions background-task pattern (status column, SSE, retry on restart).

---

## 4. Meta AI Connectors: the glasses come in through Meta AI

There's no native app needed. A connector registers our API with Meta AI, users link their nimbytes account via OAuth, and Meta AI on the glasses (and in the Meta AI app or web) calls our actions and speaks the answer. Access is a **developer preview** (application submitted by the owner; spots granted in waves). **Build so it works the day access arrives, and demo without it if it doesn't.**

### 4.1 Connector-ready API (`/api/assistant/*`, new handler file, contracts, TS mirror)

| Action | Input | Returns |
| --- | --- | --- |
| `ask` | `question`, optional `when` | `spoken`, `moments[]` (title, time, deep link, thumb), `suggested_actions[]` |
| `find_moments` | `query`, optional `when`, `person` | `spoken`, `moments[]` |
| `recap` | `period`, optional `style`, `platform` | `spoken` ("Started your week recap, ready in about 2 minutes"), `production_id`, link |
| `make_short` | `query` or `moment_ids`, `aspect`, `length_s` | `spoken`, `short_id`, link |
| `library_status` | none | `spoken` ("3 new clips are ready, 2 still processing"), counts, storage used |
| `whats_new` | optional `since` | `spoken` summary of new clips, people seen, shorts ready |

- Every response leads with **`spoken`**: plain, ≤ 25 words, no URLs, no emoji. It's what the glasses say aloud.
- **Deep links** open the PWA (and the Mac app when installed) at the clip second, production or short.
- Long work (recap, make_short) returns immediately with a status line. A follow-up `library_status` or `whats_new` reports completion.

### 4.2 Both onboarding shapes

- **OpenAPI 3.1** spec generated from the contracts (`schemars` is already a dependency), served at `GET /api/openapi.json`, plus a static copy in the repo for the onboarding form. Operation summaries are written for an assistant ("Find moments in the user's glasses footage").
- **MCP server** (streamable HTTP) at `/mcp`, exposing the same six actions as tools with the same schemas. Use the official Rust MCP SDK if it fits the pinned toolchain, else a small JSON-RPC handler. Exact version pin.

### 4.3 OAuth account linking (additive auth)

- A minimal OAuth 2.0 authorization-code + PKCE provider:
  - `GET /oauth/authorize`: a nimbytes sign-in page (the existing passcode) and a consent screen ("Meta AI wants to find moments, make recaps and shorts in your nimbytes library")
  - `POST /oauth/token`: signed, expiring access tokens and refresh tokens
  - `POST /oauth/revoke`
- Register redirect URIs from config (fill in Meta's when access is granted).
- `CurrentUser` accepts **either** the existing signed cookie **or** `Authorization: Bearer <token>` with the `assistant` scope, the one allowed touch to auth. Bearer tokens are only valid on `/api/assistant/*` and `/mcp`.
- Settings › **Connected apps**: lists linked Meta AI with last used time and **Disconnect** (revokes tokens). Mock first.

### 4.4 Demo paths

1. **Access granted:** register the connector (OpenAPI or MCP per Meta's onboarding), link the account, demo on the glasses: *"Hey Meta, ask nimbytes when I last saw my keys"* → spoken answer → open the moment on the phone. Fall back to the Meta AI app or web if the glasses surface lags.
2. **Not granted by Mon 2 Nov:** the same actions run in-app through an **"Ask nimbytes"** voice button (PWA and Mac). It records audio, transcribes it with **Muse Voice Transcribe**, calls `ask`, and shows and reads the `spoken` line, so the demo stays Meta end to end. Record the connector-ready API and the OAuth consent screen for the video, with "Meta AI Connectors developer preview: applied" on the slide.

### 4.5 Glasses capture

Ingest already handles Ray-Ban Meta MP4/HEVC. Add only:
- an "From glasses" filter. Detect by metadata where available (encoder or make tags, resolution and fps patterns of Ray-Ban Meta Gen 2), and document the rule.
- POV defaults: when a clip is from glasses, the editor's prompt mentions POV and the 2.1 reframe is on by default.

---

## 5. Order of work

| Day (Perth) | Deliver |
| --- | --- |
| Wed 28 Oct | Phase doc, spikes S1–S5, migration and contracts, OpenAPI generation, assistant handlers on Spark only (`find_moments`, `library_status`, `whats_new`) |
| Thu 29 Oct | OAuth provider + bearer in `CurrentUser`; MCP endpoint; Wonder adapter; `ask` with router; deploy to the judging box (**ask first**) so the public HTTPS URL is ready for onboarding |
| Fri 30 Oct | Producer agent (3.1) + recaps (3.2) with SSE; `recap` and `make_short` actions |
| Sat 31 Oct | SAM 2.1 reframe (crop path + composition) and 2.2 tap-to-track backend |
| Sun 1 Nov | Mocks for: Ask button, recap / producer checklist, Find this, Connected apps → **owner approval** → build |
| Mon 2 Nov | SAM 2.3 mask blur, 2.4 privacy concepts, 2.5 cutout covers; README "Meta models" and "Third-party" sections; `STATUS.md` |
| Tue 3 Nov | Demo video (owner); fixes only |

**Cut order if behind:** 2.6 → 2.4 → 2.3 (keep box blur) → 2.5 → MCP endpoint (keep OpenAPI) → Wonder multi-hop in `ask` (keep the Spark path). **Never cut:** assistant API + OAuth, `ask` with `spoken`, producer/recap with Wonder, 2.1 reframe, the Muse Voice Transcribe voice fallback.

---

## 6. Definition of done (owner checks by hand)

1. `GET /api/openapi.json` validates; `/mcp` lists the six tools; OAuth link, consent, token, bearer call and revoke all work against the judging server.
2. "Ask nimbytes" by voice answers a multi-hop question with a short spoken line and correct moments, and Wonder is visible in the costs screen.
3. "Make my week recap" produces a production and a draft story short, with the producer checklist streaming live.
4. A 9:16 export keeps the moving subject in frame. "Find this" on a mug finds it in other clips.
5. Hidden faces are blurred with mask-shaped blur. "Screens and number plates" blurs those too when on.
6. With connector access: the same question asked on the Ray-Ban Meta glasses returns the spoken answer.
7. Everything shipped still works; gates are green; nothing pushed.
