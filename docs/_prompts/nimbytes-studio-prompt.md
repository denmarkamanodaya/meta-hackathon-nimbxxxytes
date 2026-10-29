# Build Brief: nimbytes Production Studio (additive feature)

You are adding a **Production Studio** to the existing `nimbytes` repo: a guided workflow that takes a creator from **brief → shot list and storyboard → coverage → story cut → finish → publish**, using Meta's models at every step. The PWA, API, renderer, infra and (if present) the Mac app are shipped and tested. This is an **addition, not a redesign**. Everything that exists keeps working exactly as it does today.

Pitch line this feature must make true: *"An AI production studio for your glasses footage: plan it, shoot it, cut it, publish it."*

---

## 0. Hard rules (non-negotiable)

1. **Naming:** The product is `nimbytes`. Never mention any of my other products or earlier project names anywhere: code, comments, commits, branches, README, configs, UI.
2. **Coding standard:** Use `/dk-coding` for all code, plus the conventions already in this repo (section 2).
3. **No AI attribution:** No `Co-Authored-By` trailers, no "Generated with Claude Code", no AI mentions in commits, PR titles, PR descriptions or code comments.
4. **Speed first, no new tests:** Do not write new tests; I test manually. Do not delete or weaken existing tests.
5. **Don't break what's shipped:** Before each commit, the existing gates must still pass for what you touched: `cd api && cargo clippy --workspace --all-targets -- -D warnings`, `cd web && npm run lint && npm run build`, `cd render && npm run lint && npm run build`. Existing tests must keep compiling. In particular `render/fixtures/props.sample.json` and the Rust and Zod props schemas must stay compatible, so make new props fields **optional with defaults**.
6. **Additive only:** New code in new files, new routes, new tables. Existing files are touched only to register things (routes, modules, menu items) or to add optional fields. Do **not** alter existing tables or their CHECK constraints, existing routes or response shapes, the S3 key layout of existing objects, auth, ingest, search, or the agent loop's behaviour. If you believe something existing must change, **stop and ask**.
7. **Parallelism:** `/dk-agents` is allowed. Split backend, web and render work across agents where independent.
8. **New work only:** Fresh code in this repo; nothing copied from my other repositories.
9. **Ask first** before anything irreversible or costly: deploys, `terraform apply`, deleting data, force-pushing, bulk model calls over the whole library.
10. **Secrets:** Public repo. Never commit keys, passcodes or `.env` values.

---

## 1. Re-read the current code first (avoid drift)

The repo moves fast. Before writing anything, read the current `main` (this brief was written against the v1.0.0 snapshot):

- `README.md`, `Makefile`, `.env.example`, `docker-compose.yml`, `scripts/deploy.sh`
- `api/Cargo.toml` (exact pins, lints), `api/crates/{core,contracts,adapters,server}` (hexagonal layout), `api/migrations/*.sql`, `api/prompts/*` (prompt + strict JSON schema pairs), `api/config/prices.toml`
- `api/crates/core/src/keys.rs` (the only place S3 keys are built), `ports/understanding.rs` (`Reasoner`, `track_faces`, `embed_*`), `usecases/shorts/*` (agent loop), `domain/{timeline,render,critique,faces}.rs`
- `api/crates/adapters/src/meta/*` (Spark, SAM, Transcribe clients, prompt loading, fake API for tests), `sqlite/ledger.rs` (cost log)
- `api/crates/server/src/http/*` (router, `CurrentUser`, SSE in `events.rs` and `short_events.rs`), `progress.rs`
- `render/src/composition/*` (Remotion `NimbytesShort`, `schema.ts`), `render/src/render-service.ts`
- `web/src/app/router.tsx`, `web/src/components/AppShell.tsx`, `web/src/design/*` (Mist tokens and primitives), `web/src/pages/{ShortsPage,ShortPage,EditorPage}.tsx`, `web/src/hooks/useEditor.ts`, `web/src/services/api/*` (TS mirror of contracts), `web/src/services/share/*`, `web/src/components/SettingsSheet.tsx`
- If a `desktop/` (Mac) app exists, read it so the new endpoints don't clash with its routes, but leave it untouched. The Mac app's current design is the source of truth for anything desktop-related; ignore any older Mac plans.

Facts from the code to respect:
- `Aspect` is `4:5` (1080×1350) or `1:1` (1080×1080). Renders are 30 fps Remotion compositions fed by `ShortProps { aspect, fps, clips[], post, end_card_s, theme { accent, font } }`.
- Shorts are made by `POST /api/shorts { prompt, segment_ids (1–20), aspect, target_s (3–90) }`. The agent plans, previews, critiques and revises on its own and streams steps over SSE.
- Face tracks are per clip (`face_tracks`: `first_s`, `last_s`, `hidden`, `person_id`). Per-frame boxes come from SAM at 1 fps during ingest (`Detection { frame, ordinal, bbox, frame_w, frame_h }`) but are **not persisted** today. Model answers are cached by input hash, so replaying a step is free.
- `jobs.kind` is constrained to `ingest | render | agent`. **Do not alter that table.**
- Every model call is logged in the ledger with cost. Keep doing that for every new call.
- Design is "Mist": light only, tokens in `web/src/design/tokens.css`, Bricolage Grotesque (display) + Geist (body) + Geist Mono (numbers), accent `#0b6e85`, dark panel `#0d1b1e`, video caption accent `#FFE58A`, 4-tab bar with a centre upload button.

---

## 2. Scope

| Tier | Feature | Meta models |
| --- | --- | --- |
| **MVP** | Productions: brief → shot list in acts | Muse Spark 1.3 |
| **MVP** | Storyboard frame per shot | Muse Image |
| **MVP** | Coverage: match library moments to shots, list what's missing with how-to-film tips | Spark + existing hybrid search (Perception Encoder) |
| **MVP** | Story cut: make a short from the covered shots in act order through the **existing** agent, shown with an acts strip and director's notes | Spark (existing agent) |
| **MVP** | Privacy blur: faces marked hidden are blurred in previews and renders | SAM 3.1 (persisted boxes) |
| **MVP** | Brand kit: colours, title font, logo, style references → theme of renders and covers | — |
| **MVP** | Publish: platform pack (TikTok, Reels, Shorts at 9:16; Feed at the cut's aspect) with per-platform caption and hashtags, 3 brand-anchored covers, share or download | Spark, Muse Image |
| Stretch 1 | Opening title card (text over the first shot, brand font) | — |
| Stretch 2 | Speaker-coloured captions | Voice Transcribe (existing speakers) |
| Stretch 3 | "Try 3 hooks": alternative opening shots scored by the critique | Spark |
| Stretch 4 | Subject effects (spotlight or background blur) from SAM subject tracking | SAM 3.1 |

Cut order if behind: Stretch 4 → 3 → 2 → 1 → per-platform cover variants (one cover for all). **Never cut:** shot list, coverage, story cut, privacy blur, platform pack captions with 9:16 render.

Honest limits to design around: there's **no video generation and no text-to-speech** on Meta's API. Everything is cut from the user's own footage, and narration stays as captions.

---

## 3. The screens (mobile-first, Mist styling)

There are no mockups: this section is the screen spec. Match the look and patterns of the existing PWA screens (read `web/src/pages/*` and `web/src/design/*` first) and build them with the existing design primitives (`Button`, `Card`, `Chip`, `SegmentedControl`, `Sheet`, `ProgressBar`, `PageHeader`, `EmptyState`, `Skeleton`, `Icon`) and tokens; add primitives only if missing. Full-screen pages hide the tab bar like `/clips/:id` and `/editor`.

1. **Shorts tab → Productions** (`/shorts`, additive): a `SegmentedControl` at the top switches **Shorts | Productions** (default Shorts, remembered per session). The Productions list shows cards with a cover gradient or thumbnail, title, format chip (`Story · 60 s`), status chip (`Planning`, `Shooting`, `Cutting`, `Ready`, `Published`), "7 of 9 shots covered · 2 to film", a coverage `ProgressBar`, and red chips naming missing shots. Header button: **New production**.
2. **New production** (`/productions/new`): back button and title. Brief textarea (prefilled from presets: *Day in my life*, *Tutorial*, *Travel recap*); **Format** cards (*Story* 45–90 s: hook → story → payoff → outro; *Short* 10–30 s: one idea); aspect `4:5 | 1:1` with the note "9:16 versions are made at publish"; **Style** row showing the brand kit swatches with *Edit* (opens Brand kit); **Blur bystanders** switch (default on). Bottom bar: "Muse Spark plans the shots · Muse Image draws the storyboard" + **Plan my shots**.
3. **Shot list and coverage** (`/productions/:id`): a dark panel header "Coverage 7 / 9 shots" with a progress bar and "New clips are checked against this list as they upload." Shots grouped by act (mono uppercase labels: `ACT 1 · HOOK`). Each shot card has a numbered storyboard frame (Muse Image), title, a one-line direction, and status: **Covered** (green, with the matched moment's description and time, take count) or **Missing** (red, with a **How to film** button opening a sheet with tips). Live planning progress (SSE) while the shot list and frames are generated. Bottom bar: **Film missing** (opens Upload) and **Cut the story** (enabled when ≥ 60% of shots or ≥ 3 shots are covered).
4. **Story cut** (existing `/editor/:id`, additive): when the short belongs to a production, show an **acts strip** under the player (Hook / Story / Payoff / Outro, segments sized by duration, time ranges) and title the critique trail **Director's notes**: timestamped note cards; applied notes show "Applied in v2 · hook score 6 → 9". Keep all existing editor behaviour. Bottom bar adds **Finish** (to screen 5); Stretch 3 adds **Try 3 hooks**.
5. **Finish** (`/editor/:id/finish`): before/after frames showing the blur. Sections: **Privacy** (Blur bystanders switch with "3 hidden faces across 4 shots"); **Titles** (Opening title switch + text, Stretch 1; Speaker colours, Stretch 2); **Subject effect** (Spotlight / Blur background / None, Stretch 4; hide the section if not built). Bottom bar: **Render and publish**.
6. **Publish** (`/editor/:id/publish`): platform `SegmentedControl` **TikTok | Reels | Shorts | Feed 4:5**. Per platform: 3 cover variants (Muse Image) with selection tick and **Make 3 more**; caption textarea with character counter (platform limits: TikTok 2,200, Reels 2,200, Shorts title 100); hashtag chips (removable); a render row (`9:16 · 58 s · captions on`, render status, preview). Bottom bar: **Copy caption** + **Share video** (Web Share API via the existing share service; download fallback).
7. **Brand kit** (`Sheet`, from Settings and New production): colours (up to 3 swatches + add; first = accent), title font (`Bricolage` bold or `Geist` clean), logo upload (PNG/JPG ≤ 5 MB), style references (up to 4 images). **Save brand kit.**

Copy tone matches the app: short, plain, friendly. No emoji in the UI.

---

## 4. Backend design (additive)

### 4.1 New migration: `api/migrations/0008_productions.sql` (or the next free number)
New tables only:

```sql
CREATE TABLE brand_kits (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  colors TEXT NOT NULL,           -- JSON array of #rrggbb, 1–3, first is the accent
  title_font TEXT NOT NULL CHECK (title_font IN ('bricolage', 'geist')),
  logo_key TEXT,
  ref_keys TEXT NOT NULL DEFAULT '[]',  -- JSON array of S3 keys, ≤ 4
  updated_at TEXT NOT NULL
);

CREATE TABLE productions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('story', 'short')),
  aspect TEXT NOT NULL CHECK (aspect IN ('4:5', '1:1')),
  target_s REAL NOT NULL,
  blur_bystanders INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('planning', 'shooting', 'cutting', 'ready', 'published', 'failed')),
  short_id TEXT REFERENCES shorts (id) ON DELETE SET NULL,
  coverage_checked_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX productions_by_user ON productions (user_id, created_at);

CREATE TABLE production_shots (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions (id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  act TEXT NOT NULL CHECK (act IN ('hook', 'story', 'payoff', 'outro')),
  title TEXT NOT NULL,
  direction TEXT NOT NULL,       -- one line: how to film it
  tips TEXT NOT NULL,            -- JSON array of short tips
  query TEXT NOT NULL,           -- search phrase used for coverage
  duration_s REAL NOT NULL,
  board_key TEXT,                -- storyboard image
  matched_segment_id TEXT REFERENCES segments (id) ON DELETE SET NULL,
  match_reason TEXT,
  take_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (production_id, ord)
);

CREATE TABLE face_boxes (        -- persisted SAM boxes, for privacy blur
  track_id TEXT NOT NULL REFERENCES face_tracks (id) ON DELETE CASCADE,
  t_s REAL NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,  -- 0–1, relative to the upright frame
  PRIMARY KEY (track_id, t_s)
);

CREATE TABLE short_finish (
  short_id TEXT PRIMARY KEY REFERENCES shorts (id) ON DELETE CASCADE,
  blur_bystanders INTEGER NOT NULL DEFAULT 1,
  title_text TEXT,
  speaker_colors INTEGER NOT NULL DEFAULT 0,
  effect TEXT NOT NULL DEFAULT 'none' CHECK (effect IN ('none', 'spotlight', 'blur_bg'))
);

CREATE TABLE short_exports (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL REFERENCES shorts (id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'reels', 'shorts', 'feed')),
  aspect TEXT NOT NULL CHECK (aspect IN ('9:16', '4:5', '1:1')),
  version_n INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'ready', 'failed')),
  render_key TEXT,
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '[]',
  cover_keys TEXT NOT NULL DEFAULT '[]',
  cover_pick INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (short_id, platform)
);
```

### 4.2 S3 keys (add functions to `keys.rs`, existing ones unchanged)
- `users/{u}/brand/logo.{png|jpg}`, `users/{u}/brand/ref_{n}.{png|jpg}`
- `users/{u}/productions/{p}/boards/{shot}.png`
- `users/{u}/exports/{short}/{platform}.mp4`, `users/{u}/exports/{short}/{platform}_cover_{n}.png`

Add new object deletion to the existing clip/short cleanup only if it's a one-line addition; otherwise leave it and tell me.

### 4.3 Meta adapters (new files under `adapters/src/meta/`)
- **Muse Image** (`image.rs`): generate and reference-anchored generation. Read the docs at https://dev.meta.ai/docs/ and the cookbook (`05_muse_image`: generate, edit, anchored composition) for the exact request shape. Price $0.01 per image: add it to `config/prices.toml` and log every call in the ledger. Use cached answers by input hash like the other adapters.
- **Spark prompts** (new pairs in `api/prompts/`, same pattern as existing, strict JSON schema + validate-and-retry):
  - `shot_list.md` / `shot_list.schema.json`: input brief, format, target length, aspect, and a short summary of the user's library (top places, people names, actions; reuse existing catalogue data). Output a title and 5–12 shots, each `{act, title, direction, tips[], query, duration_s, board_prompt}`, acts in order, durations summing to roughly the target.
  - `coverage_match.md` / `coverage_match.schema.json`: input one shot + up to 8 candidate moments from the existing hybrid search (description, place, actions, people, quality, hook score). Output `{segment_id | null, reason, take_count}`. Null means not covered.
  - `platform_pack.md` / `platform_pack.schema.json`: input the final timeline's post text, production brief, people and places. Output, per platform, a caption within the limit and 3–8 hashtags. Optionally enable Spark's search-grounding tool for trending tags if the docs allow it in one tool definition; skip if not.
  - `story_brief.md`: the text passed as the existing short's `prompt` (see 4.5). It explains the acts and shot order to the existing planner without changing the planner.
- **SAM 3.1**: no new call for MVP. Privacy blur uses persisted boxes (4.6).

### 4.4 Productions use cases and endpoints (new `usecases/productions/*`, `http/productions.rs`, `contracts/src/productions.rs`, mirrored in `web/src/services/api/types.ts`)
| Route | Does |
| --- | --- |
| `GET /api/productions` | List, newest first, with coverage counts and missing shot titles |
| `POST /api/productions` | `{brief, format, aspect, target_s, blur_bystanders}` → creates it (`planning`), starts planning in the background, returns id |
| `GET /api/productions/{id}` | Production + shots (signed board URLs, matched moment thumb, description and time) |
| `GET /api/productions/{id}/events` | SSE: planning steps (`shot_list`, `boards n/m`, `coverage`), same style as `short_events` |
| `POST /api/productions/{id}/coverage` | Recheck coverage now |
| `POST /api/productions/{id}/cut` | Create the story short (4.5) and link it |
| `DELETE /api/productions/{id}` | Delete it and its board images |

**Background work without touching `jobs`:** run planning and coverage as server-side tokio tasks owned by the productions module. Track status in `productions.status` and `error`, broadcast progress through the existing `BroadcastProgress` pattern, and make every step idempotent and resumable (shots already stored are kept; boards already in S3 are skipped). On server start, any production stuck in `planning` gets `failed` with a **Retry** action (`POST /api/productions/{id}/coverage` or a new `/retry`). Limit concurrency (e.g. 4 board images in parallel).

**Coverage:** for each shot, run the existing search use case with the shot's `query` (owner-scoped, exclude duplicates), take the top 8, ask Spark `coverage_match`, and store the match. Run it automatically after planning, when the production page opens if any clip became ready after `coverage_checked_at` (check the catalogue), and on the recheck endpoint. Status becomes `shooting` while shots are missing and `cutting` once a short exists.

### 4.5 Story cut (reuse the existing agent unchanged)
`POST /api/productions/{id}/cut`:
- `segment_ids` = matched segments in act and shot order (skip uncovered shots; at most 20).
- `prompt` = rendered `story_brief.md`: the brief, the act structure, each shot's title and intended duration, and "keep the act order: hook → story → payoff → outro".
- `aspect` and `target_s` from the production; call the **existing** create-short use case. Store `short_id` on the production.
- The acts strip in the UI maps timeline shots back to production shots through `segment_id`.

### 4.6 Privacy blur
- **Persist boxes:** in the ingest face step, after tracks are built, also write `face_boxes` for each track (normalised 0–1 against the upright frame, 1 fps). Add this as an extra write in the existing step, the one allowed touch to ingest, and keep it idempotent.
- **Backfill:** a one-off command or admin-only endpoint that replays the cached SAM answers for existing clips and fills `face_boxes` (no new model spend because answers are cached; **ask before running it on the server**).
- **Render:** extend the props builder with an optional `blur: [{segment_id, boxes: [{t_s, x, y, w, h}]}]` only for tracks with `hidden = 1` when `short_finish.blur_bystanders` (default from the production, else on). In the Remotion composition, draw a blurred overlay over each box: linearly interpolate between 1 fps samples, pad boxes by 30%, map through the same cover-crop and `punch_in` transform the clip uses, and use `backdrop-filter: blur(24px)` or a blurred duplicate video clipped to an ellipse (pick whichever renders reliably in headless Chromium). Apply it to previews and final renders. Optional field → existing props and fixtures stay valid.

### 4.7 Brand kit
- `GET /api/brand`, `PUT /api/brand` (colours, title font, ref and logo keys), `POST /api/brand/uploads` → presigned PUT (`BlobStore::presign_put`) for logo or a reference, PNG or JPG ≤ 5 MB, owner-scoped keys.
- Map the kit to the existing render `Theme`: `accent` = first colour, `font` = the chosen stack. When no kit exists, use today's defaults unchanged.
- Covers and storyboard frames pass the logo and reference images to Muse Image as anchors when present.

### 4.8 Finish and publish
- `GET/PUT /api/shorts/{id}/finish`: `short_finish` row (defaults when missing).
- **9:16:** add an `Aspect` variant `"9:16"` (1080×1920) for **exports only**. The existing create-short and save-timeline paths must reject it with a validation error (the `shorts` table CHECK stays as is). Add `'9:16'` to the Zod aspect enum and composition dimensions. Keep the cover crop and the punch-in maths.
- `POST /api/shorts/{id}/exports` `{platforms: [...]}` → for each platform: render the best version (or the chosen `version_n`) at the platform's aspect through the existing renderer client (`feed` = the short's aspect), apply finish settings, generate the platform caption and hashtags (`platform_pack`, one call for all platforms), and 3 covers (Muse Image with a real frame from the strongest hook segment plus brand anchors). Track progress in `short_exports.status`; stream steps over the existing short events SSE or a new `/exports/events`.
- `GET /api/shorts/{id}/exports` (signed render and cover URLs), `PUT /api/shorts/{id}/exports/{platform}` (edited caption, hashtags, cover pick), `POST .../covers` (make 3 more).
- Renders use the existing renderer service and its concurrency limits. Don't raise memory limits.

### 4.9 Costs and budgets
- Log every new call (Spark, Muse Image) in the ledger so the existing costs screen shows it.
- Caps: ≤ 12 shots per production, ≤ 12 storyboard images per plan, ≤ 9 covers per platform per short. Coverage runs at most once a minute per production.

---

## 5. Web implementation notes
- Routes (additive in `router.tsx`, lazy): `/productions/new`, `/productions/:id`, `/editor/:id/finish`, `/editor/:id/publish`. Extend `isFullScreen` in `AppShell` for `/productions/` paths.
- `ShortsPage`: add the Shorts | Productions segmented control. Existing Shorts content unchanged.
- `ShortPage`: when the short has a production, show the acts strip and "Director's notes" heading, and add the **Finish** action. Otherwise identical to today.
- Settings sheet: add a **Brand kit** row opening the sheet.
- New hooks follow the existing pattern (`useProductions`, `useProduction` with SSE, `useBrandKit`, `useExports`), with the existing error toasts, skeletons, offline handling and optimistic patches where it fits.
- Keep the dev-only mock API mode working: add fixtures for productions, brand kit and exports so screens can be reviewed without the backend.
- Accessibility: real buttons and labels, 44 px targets, switch roles with `aria-checked`, tab roles on segmented controls, alt text on storyboard and cover images ("Storyboard: wide exterior, doors opening").

---

## 6. Order of work

| Phase | Deliver | Can run in parallel |
| --- | --- | --- |
| 1 | Migration, keys, contracts, Muse Image adapter, prompt pairs | Web: screens 1–3 and 7 against mock fixtures |
| 2 | Productions planning (shot list + boards) with SSE; coverage | Render: `9:16` composition + optional `blur` overlay |
| 3 | Story cut endpoint + acts strip and director's notes on the short page | Backend: face box persistence + backfill command |
| 4 | Brand kit end to end (theme + anchors) | Web: Finish screen |
| 5 | Exports: platform pack, 9:16 renders, covers, Publish screen with share | — |
| 6 | Stretch items in order, README section "Production Studio" (what it does, Meta models per step), `.env.example` additions if any | — |

After each phase, report in 3–5 lines: what works, how to try it locally (mock mode and real), anything I must do (deploy, backfill approval).

---

## 7. Definition of done (I'll verify manually)
1. From Shorts → Productions → New production, a brief produces a titled shot list in acts with a storyboard frame per shot, with live progress.
2. Coverage marks shots covered with the matched moment, lists missing shots with tips, and updates after I upload a new matching clip.
3. **Cut the story** produces a short through the existing agent; the short page shows the acts strip and director's notes; nothing else on that page regresses.
4. A face I hid in People is blurred in the preview and the final render; turning blur off removes it.
5. The brand kit changes the accent and font of renders and anchors new covers.
6. Publish produces 9:16 renders for TikTok, Reels and Shorts plus a Feed render, each with its own caption, hashtags and 3 covers; **Share video** opens the share sheet on a phone.
7. Every new model call appears in the costs screen.
8. Every existing flow still works: upload, ingest, search, people, the shorts editor, downloads, and the Mac app if present.
