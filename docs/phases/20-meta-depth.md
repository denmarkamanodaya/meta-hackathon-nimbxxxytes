# Phase 20: Meta depth, Muse Image first, then SAM 3.1 (rev 3)

Status: **rev 3 approved 2026-10-28. Track A mocks V14–V17 approved; building.** Spikes S-A1..3 passed ($0.04, facts in `docs/meta-api.md`).

Owner rulings, 2026-10-28:
- Scope is SAM 3.1 and Muse Image only. Dropped: Muse Wonder, Meta AI Connectors, OAuth, MCP, the assistant API and voice Ask.
- **Muse Image goes first, as a self-contained track that can close quickly.** SAM 3.1 features wait for the owner's pick (Track B).

Rules: unit tests in the same commit; wire-format tests on every new Meta request body; local commits only; mock first for every visual change; `STATUS.md` after each step; `docs/meta-api.md` after each spike.

Deadlines: demo-ready Mon 2 Nov · video Tue 3 Nov · submission Thu 5 Nov 10:00 Perth.

---

## Track A: Muse Image (no SAM dependency)

### What Muse Image does today

| Use | How | Where |
| --- | --- | --- |
| Storyboards | One sketch per planned shot (pencil + teal wash), a generation or a brand-anchored edit | `usecases/productions/plan.rs` `draw_missing_boards`, `api/prompts/storyboard.md` |
| Covers | An edit anchored on a real hook frame (+ logo + style refs). 3 fixed variations per platform (centred, close detail, dramatic angle); "more covers" up to 9; the model draws no text | `usecases/exports/run.rs:204`, `more_covers`, `api/prompts/cover.md` |

Price $0.01 per image, about 15 s each, 150 RPM. The edit endpoint takes anchor images but no mask.

### Gaps worth closing

1. **Covers carry no title.** The prompt forbids text, because models misspell words. Real covers need a title.
2. **The owner can't steer a cover.** The 3 styles are fixed; the only control is "more of the same".
3. **Storyboards never meet the footage.** Once a shot is covered, its board stays a sketch of an imagined scene.
4. **Projects and productions have no artwork.** Tiles show a plain colour or a first frame.

### Features (in build order)

| # | Feature | What the owner gets | How | Cost |
| --- | --- | --- | --- | --- |
| A1 | **Cover titles** | Each cover gets a short, bold title in the brand font: crisp, never misspelt | The model keeps drawing no text. We lay the title (post caption hook, editable) over the image in the brand font with Remotion `renderStill` (already in `@remotion/renderer`, no new dependency). Title on/off and position top/bottom | $0 |
| A2 | **Redraw with words** | On any cover: type "golden hour", "make it moodier", "comic style" → a new cover from that one | Muse Image edit anchored on the chosen cover (+ the original frame for fidelity), plus the owner's instruction. Adds to the platform's cover set (same 9 cap) | $0.01 each |
| A3 | **Cover style picker** | Pick a look before drawing: Bright · Close detail · Dramatic · Illustrated · Brand scene | Named style presets replace the fixed `n mod 3` rule in `cover.md`, so "more covers" takes a style | $0.01 each |
| A4 | **Storyboards from your footage** | When a shot gets matched footage, its board is redrawn from the real frame in the same sketch style: the board looks like what you actually filmed | `check_coverage` match → edit anchored on the matched segment's hook frame with the storyboard prompt. The old board is kept as "planned" | $0.01 per covered shot |
| A5 | **Project and production art** | A key-art tile for each project and production, drawn from its best moments | An edit anchored on up to 4 hook frames (S-A1 confirms the anchor limit), with no text; regenerate on demand | $0.01 each |

Stretch (only if A1–A5 close early): **A6 Title card** = A5's art as a 1.5 s opening card in the short, with the title laid over it by the composition.

### Steps

#### [ ] A0 Spikes (≤ 1 h, ≈ $0.10)

| Spike | Question | Fixture |
| --- | --- | --- |
| S-A1 | How many anchor images an edit takes, and whether 4 frames give a coherent key-art image | `image/edit_multi_anchor_response.json` |
| S-A2 | Does an edit chained on a generated cover follow a short instruction and stay faithful? | `image/edit_instruction_response.json` |
| S-A3 | Does a board redrawn from a real frame keep the sketch style? | numbers + 1 image |

#### [ ] A1 Backend (Thu 29 Oct)

- `cover.md` style presets (A3).
- `redraw_cover(export, cover_n, instruction)` use case + `POST /api/shorts/{id}/exports/{platform}/covers/{n}/redraw` (A2). The instruction is ≤ 120 chars and validated.
- Cover titles (A1):
  - Renderer `POST /still` with a `CoverStill` composition (image + title, brand tokens).
  - API stores both the plain and the titled cover.
  - Contracts gain `cover.title`, `cover.title_position`.
- `redraw_board_from_footage` in the coverage step (A4).
- Art (A5):
  - Migration `0012_art.sql` adds `projects.art_key` and `productions.art_key`.
  - Endpoints `POST /api/projects/{id}/art` and `POST /api/productions/{id}/art`.
- Tests:
  - Prompt fill per style.
  - Request bodies (anchors in order, instruction placement).
  - Ownership and the 9-cover cap.
  - The `CoverStill` props schema and drift sample.
  - Handlers via `oneshot`.

#### [ ] A2 Mocks → owner approval (Thu 29 Oct)

Boards on the redesign-v2 canvas, Mac first:
- Publish › cover strip with style chips, "Redraw with words" field and Title on/off.
- Production shot row showing "planned" vs "from your footage" boards.
- Project tile and production header art.

**Stop for approval.**

#### [ ] A3 Build the approved UI + close (Fri 30 Oct)

- Service modules → hooks → components.
- `dev:mock` fixtures.
- Vitest tests.
- Gates, then the owner's hand check.
- Commit, and update `STATUS.md`. Track A closes here.

Owner hand check:
1. A cover with a crisp title.
2. "Make it golden hour" gives a new faithful cover.
3. A covered shot shows its real-footage board.
4. A project shows art.
5. Costs shows the image spend.

---

### Track A wire contract (one source for the api, render and web teammates)

Owner defaults (approved with the mocks):
- The title is a separate short title (≤ 32 chars), prefilled from the caption.
- Key art is drawn automatically once, then redrawn only through New art.
- Footage storyboards are drawn automatically when a shot is covered.

**Exports** (`api/crates/contracts/src/exports.rs`, mirrored in `web/src/services/api/types.ts`)

New types:
- `CoverStyle` (snake_case): `bright | close_detail | dramatic | illustrated | brand_scene | redrawn | key_art`.
  The first five are pickable; `redrawn` and `key_art` are made by Redraw and Use as cover.
- `CoverTile { url, style: CoverStyle, instruction: Option<String> }`. `instruction` is set for `redrawn`.
- `CoverTitle { text (1..=32 chars), show: bool, position: "top" | "bottom" }`.
  - Default text: the caption cut to ≤ 32 chars at a word boundary, without hashtags (pure fn + tests).
  - Default `show` is true; default `position` is "bottom".

`ExportItem` changes:
- **Replace** `cover_urls: Vec<String>` with `covers: Vec<CoverTile>` (same order and index as `cover_pick`).
- Add `cover_title: CoverTitle`.
- Add `download_cover_url: Option<String>`: the picked cover as it will be published. It is titled when `show`, else the plain cover. It is null while the titled still is baking.

Request changes:
- `EditExportRequest` gains `cover_title: Option<CoverTitle>`. A change to the title or `cover_pick` re-bakes the titled still in the background.
- `POST /api/shorts/{id}/exports/{platform}/covers` gains an optional JSON body `MoreCoversRequest { style: Option<CoverStyle> }` (pickable styles only). With no body it behaves as today.
- New `POST /api/shorts/{id}/exports/{platform}/covers/{n}/redraw` with `RedrawCoverRequest { instruction }` (3..=120 chars). It makes one new cover from cover `n`:
  - The anchors are cover `n` plus the hook frame.
  - The new cover is appended with style `redrawn`.
  - It follows the same busy/events flow and response as `covers`.

Caps and errors:
- The 9-covers-per-platform cap applies to every way of adding a cover.
- At the cap: `VALIDATION_FAILED`.

**Productions** (`contracts/src/productions.rs`)
- `ProductionShot` gains `footage_board_url: Option<String>`, the storyboard redrawn from the covering moment's hook frame.
- New `POST /api/productions/{id}/shots/{shot_id}/board`: redraw that board from footage. Returns `StartedResponse`. A shot that is not covered gets `VALIDATION_FAILED`.
- The coverage run draws footage boards for covered shots that have none, or whose match segment changed. Step `footage_boards` carries `n/m`.
- `ProductionSummary` and `ProductionListItem` gain `art_url: Option<String>` and `art_drawing: bool`.
- New `POST /api/productions/{id}/art`: New art. Returns `StartedResponse`.
  - It runs automatically once, when planning finishes.
  - Anchors: up to 4 hook frames of covered shots, else up to 4 storyboards.
- New `POST /api/productions/{id}/art/cover`: Use as cover.
  - It appends the art as a `key_art` cover to every export of the production's story short.
  - With no art, or no exports: `VALIDATION_FAILED`.
  - A platform at the cap is skipped.

**Projects** (`contracts/src/projects.rs`)
- `Project` gains `art_url: Option<String>` and `art_drawing: bool`.
- The project page data gains `art_sources: Vec<ArtSource { clip_id, clip_title, title, start_s, thumb_url }>`: the moments the art was drawn from.
- New `POST /api/projects/{id}/art`: New art. Returns `StartedResponse`.
  - It runs automatically once, when the project first reaches 3 clips.
  - Anchors: the 4 highest `hook_score` segment frames across its clips.

**Storage**: migration `0012_muse_image.sql`
- `short_exports`:
  - `cover_info TEXT NOT NULL DEFAULT '[]'` holds `[{style, instruction}]`, aligned with `cover_keys`. A missing entry means a legacy cover; its style is `n mod 3`, mapped to bright / close_detail / dramatic.
  - `cover_title TEXT` (JSON).
  - `titled_cover_key TEXT`.
- `production_shots`: `footage_board_key TEXT`, `footage_board_segment TEXT`.
- `productions`: `art_key TEXT`, `art_auto INTEGER NOT NULL DEFAULT 0`.
- `projects`: `art_key TEXT`, `art_sources TEXT NOT NULL DEFAULT '[]'`, `art_auto INTEGER NOT NULL DEFAULT 0`.
- Add a test that child rows survive (LEARNING #7). Upsert; never delete-and-reinsert referenced rows.

**Prompts** (`api/prompts/`)
- `cover.md`: named style presets replace the `n mod 3` rule. Legacy numbers map onto the first three.
- New prompts: `cover_redraw.md`, `footage_board.md` (it reuses the storyboard sketch style from one place), `key_art.md`. No text in any image.
- `MetaClient` purposes: `cover_redraw`, `footage_board`, `key_art`.

**Renderer**: titled cover stills
- `POST /still` takes `{ props: CoverStillProps, out_url }`, where `CoverStillProps` is `{ image_url, width, height, title: { text, position }, theme: { accent, font } }`. It writes a JPEG to `out_url`.
- Composition `CoverStill`:
  - The title is the Brand font, uppercase, bold, with a soft shadow, laid over the picture.
  - The Zod schema plus `render/fixtures/cover_still.sample.json` form the drift pair with the Rust builder.
- API port: `Renderer::still(props, out)`. Stills queue behind renders; the UI previews the title in CSS meanwhile.

**Web** (approved boards V14–V17; build exactly what they show)
- V14: Mac Publish page (compact, right column).
- V15: `MacProductionPage` Planned / From your footage.
- V16: `MacProjectPage` key art banner + Drawn from.
- V17: `MacProductionsPage` art thumbs + right column (New art, Use as cover).
- The PWA Publish and Production screens get the same controls in their existing layout.
- Services → hooks → components; `dev:mock` fixtures follow this spec.

---

## Track B: SAM 3.1 (owner picks the features; starts after Track A)

### What SAM 3.1 is

Segment Anything Model 3.1 is Meta's model for **finding, outlining and following things in video**.
- **Input:** a video plus one of the following:
  - a short phrase ("dog", "face", "red car")
  - a point (tap) on a frame
  - a box on a frame
- **Output:** for every frame, each matching object's box, a pixel-accurate **mask** (its exact outline) and a steady **ID**, so the same dog stays "object 0" as it moves.
- **What it isn't:** it doesn't describe or name things (Muse Spark does that). It answers "where exactly is that thing, in every frame".
- **Price:** $0.20 per 1,000 frames, minimum 50 frames per request. There is no frame-rate option, so we choose the frame rate by re-encoding first.

### Its role in nimbytes today

- It runs once per clip at ingest with the phrase "face" on a 1 fps copy.
- That feeds Faces (face crops, people and pets) and the privacy blur (face boxes once a second, drawn as an ellipse).
- It returns masks too, but we throw them away. Point and box prompts are unused.

### What it can bring (options for the owner to pick)

Hackathon framing: each one turns "where is it" into an **editing action**, which keeps us clear of the banned "simple image analyzer".

| # | Feature | What the user sees | Demo value | Effort | Main risk |
| --- | --- | --- | --- | --- | --- |
| B1 | **Screens and number plates blur** | One toggle also blurs phone/laptop screens and plates in exports | Medium (privacy story) | **Low**: phrases "screen", "license plate" + today's box blur | Few screens or plates in the demo footage |
| B2 | **Keep subject in frame (9:16 reframe)** | Vertical exports follow the moving person or pet instead of a fixed centre crop | High (every post is 9:16) | Medium: tracking per shot + a smooth camera path in the renderer | Glasses footage is 3:4, so the effect is subtle unless the shot is zoomed |
| B3 | **Find this** | Tap a mug in a clip → "Seen in 7 other clips" with jump-to moments | **Highest wow** | Medium–high: point prompt + PE search | Point-prompt request shape is undocumented (spike); has a no-SAM fallback |
| B4 | **Mask-accurate face blur** | Blur follows the exact face outline instead of an oval | Medium | Medium: mask decode + outline path in the renderer | Mask format undocumented (spike) |
| B5 | **Cut-outs, stickers, real-person covers** | "Cut out" gives a transparent PNG/sticker. Covers put the real person in front of the title over a Muse Image background (joins Track A) | High (social-native) | Medium: needs masks (B4's decoder) | Same as B4 |
| B6 | **Subject effects in video** | Spotlight, background blur, text behind the subject | High | **High**: per-frame masks in the composition | Time |

Suggested pick for the time left: **B1 + B2 + B3**, with **B5** if the mask spike (B-S2) passes. B4 rides on B5's decoder if time allows; B6 is out.

### Track B spikes (run when the owner picks, ≈ $0.20)

- **B-S1:** point and box prompt request shape, `propagation_direction` (needed for B3).
- **B-S2:** decode the mask token `data=W,H,~…` (needed for B4, B5, B6).
- **B-S3:** cost and latency for a 6 s shot at 12 fps (needed for B2).
- **B-S4:** SAM on a single image (needed for B5).

Detailed steps for each picked feature are written once the owner chooses. The findings from rev 2 still hold (3:4 footage, masks turned into simple outlines, the cache, the 20-shot cap, glasses detection) and will be reused.

---

## Track B wire contract (approved 2026-10-28: B1, B2, B3, B5; mocks V18–V22)

Owner defaults (approved with the mocks):
- Find this also searches faces when face matching is on.
- Keep subject in frame is on for every 9:16 export, with a switch per short.
- The cutout cover background defaults to a Muse Image scene, with Blurred frame as the other choice.
- Dependency approved: `@meta-sam/parser` `0.1.0`, exact pin, **in `render/` only**. It is listed in the README "Third-party" section (SAM License).

SAM facts: `docs/meta-api.md` "SAM 3.1, Phase 20 Track B spikes". Spike script and raw responses: `docs/phases/20-samspike/` (`*.json` = full API responses, usable as fixtures).
- The mask raster covers the box, not the frame.
- `data=H,W` is height first.
- Point and box prompts always return `one_bit`.

**API: SAM adapter** (`adapters/src/meta/sam.rs`; the ingest face path stays byte-identical, pinned by a test)
- Prompt builders:
  - `concept(phrase)`
  - `point(frame, id, x, y, w, h)`
  - `boxed(frame, id, x1, y1, x2, y2, w, h)`
- Media: video data URL, or image data URL (`input_image`).
- Metadata: `propagation_direction`, `mask_encoding: one_bit`, `include_confidence`.
- Records: `{frame, id, box, mask: {encoding, width, height, payload}}`. The payload is kept opaque. The parser must accept `!` payloads and any frame order.
- Usage:
  - `video_frames_processed`: video, billed with the 50-frame minimum.
  - `images_processed`: SAM image, $2.50 per 1,000. Add `[sam_image]` to `prices.toml` and price it per model.
- Port `SubjectTracker` in core (separate from `FaceTracker`).
- `MediaTool::range_proxy(clip, in_s, out_s, fps)` and `MediaTool::frame_at(clip, t_s)` (JPEG at the full proxy size).
- `sam_cache`: the Meta cache already keys by body. Range proxies are cached on disk by (clip, in, out, fps).

**B1 Screens and number plates**
- `Settings` gains `blur_objects: bool` (default false). Stored in `users.blur_objects`.
- While building render props (`with_blur`), when the setting is on:
  - For each timeline clip, run SAM concepts `"screen"` and `"license plate"` on the shot range at 10 fps.
  - Add their boxes as extra entries in the existing `blur[]` (the same ellipse blur, padded).
- Cache per shot. Cap 20 shots.

**B2 Keep subject in frame**
- `short_finish.keep_subject INTEGER NOT NULL DEFAULT 1`. The `Finish` contract gains `keep_subject: bool`.
- New table `short_reframes(short_id, version_n, segment_id, subject, crop_path JSON, frames_tracked, frames_total, lost_s, updated_at)`. Upsert, never delete-and-reinsert.
- `POST /api/shorts/{id}/reframe` returns `StartedResponse`. It runs in the background (Runs claim, BroadcastProgress step `reframe` with `n/m`) over the best version's timeline clips that have a `subject` (cap 20):
  1. Make a range proxy at 12 fps.
  2. Run SAM `concept(subject)`.
  3. Pick the track: most frames, then largest mean area.
  4. Compute the pure `crop_path`.
- `GET /api/shorts/{id}/reframe` returns `ReframeResponse { status: idle|running|ready|failed, shots: [{segment_id, subject, frames_tracked, frames_total, lost_s}] }`.
- Pure `crop_path(boxes, frame, out_aspect)`:
  - It returns keyframes `[{t_s, cx, cy}]`: the crop centre, normalised 0..1, clamped so the crop stays inside the frame.
  - Smoothing: EMA, a dead zone, max pan speed, and hold-last when the subject is lost.
  - Tests: still, jitter, fast pan, lost, edges.
- Render props: `ShortClip.crop_path` (optional) is filled only when the aspect is 9:16, `keep_subject` is on and a reframe row exists.
  - Exports: the 9:16 export run triggers a reframe first if none is ready (it waits, then renders).
  - The Short page preview gets `crop_path` the same way.
- Changing a shot's subject reuses the existing timeline edit if it can carry `subject`; otherwise add a minimal one. Report which. A changed subject invalidates that shot's reframe row.

**B3 Find this**
- `POST /api/clips/{id}/find` with `{t_s, x, y}`, where `x`/`y` are 0..1 of the displayed frame. Synchronous, timeout 90 s.
  1. Make a 1 fps proxy of the clip (exists).
  2. SAM `point` at frame `round(t_s)` with `propagation_direction both`.
  3. The best frame is the largest box. Crop it from `frame_at`, then PE image embedding.
  4. Run KNN over `segment_vectors` ∪ `object_vectors` (∪ `face_vectors` only when face matching is on).
  5. Group by clip into moments. This clip comes first, with its in-view range from the track.
  6. Label: Muse Spark names the crop in 1–3 lowercase words (a new prompt + strict schema; reasoning low).
  7. Outline: the tapped frame's mask turns into an SVG path via the renderer `POST /mask/path`.
  8. Store an `object_tracks` row and its vector in `object_vectors`.
- Returns `FindResponse { label, in_view: {start_s, end_s}, outline: {path, frame_w, frame_h}, hits: [{clip_id, clip_title, recorded_at, segment_id, start_s, end_s, thumb_url, score}] }`, at most 12 hits.
- Fallback: when SAM finds nothing at the point, embed a tap-centred crop (25 % of the short side), with no outline.

**B5 Cut-outs and real-person covers**
- `POST /api/clips/{id}/cutout` with `{t_s, x, y}`:
  1. `frame_at`, then SAM **image** `point` (one_bit).
  2. Renderer `POST /cutout` makes `cutout.png` and `sticker.png` in R2.
  3. Label as for Find.
- Returns `CutoutResponse { label, png_url, sticker_url }`.
- `CoverStyle` gains `cutout`. `CoverTile` gains `background: Option<"scene"|"blur">` (set only for cutout).
- `MoreCoversRequest` gains `background: Option<"scene"|"blur">` (default scene) and makes one cutout cover:
  1. Take the hook frame.
  2. SAM image `concept(subject of the first timeline clip, else "person")`, choosing the largest mask.
  3. Background:
     - `scene`: a Muse Image edit anchored on the frame, "the same place without the main subject, room for a title";
     - `blur`: the frame itself.
  4. Renderer `/still` with the cutout layer.
  Same 9-cover cap and events.

**Renderer** (`render/`, the only place that decodes masks; dependency `@meta-sam/parser` `0.1.0`)
- `POST /mask/path` takes `{mask: {encoding, width, height, payload}, box: {x1, y1, x2, y2}}` and returns `{path}`.
  - `path` is an SVG path in frame pixels: `decodeMaskToSVGPath`, translated by (x1, y1).
  - 400 on a bad mask.
- `POST /cutout` takes `{image_url, frame: {w, h}, mask, box, sticker: bool, out_url}` and writes a transparent PNG cropped to the box (+12 px padding for the sticker).
  - A `Cutout` composition clips the image with `clip-path: path()`. The sticker adds a white outline (stacked drop-shadows).
  - `renderStill` with `imageFormat: 'png'` and a transparent background.
- `CoverStillProps` gains:
  - optional `background_blur: bool`, which blurs `image_url`;
  - optional `cutout: {image_url, frame: {w, h}, path, box: {x1, y1, x2, y2}}`, drawn **above the title**.
  - The subject is placed bottom-centre, scaled so its height ≈ 64 % of the cover (a pure placement fn + tests).
  - Update `cover_still.sample.json`; the API drift test reads it.
- `ShortClipSchema` gains optional `crop_path: [{t_s, cx, cy}]`.
  - It also gains `source_aspect: number` (upright width / height), required whenever `crop_path` is present (lead decision 2026-10-28).
  - `crop_path[].t_s` is in **source clip seconds**, like captions and blur boxes. From a range proxy, `t_s = in_s + f / fps`. The renderer holds the first and last keyframes outside their range.
  - `ClipLayer` uses it for the crop and the punch-in centre, interpolating between keyframes. Without it, the centred cover stays.
  - `blur.ts:coverRect` takes the same offset, so face and object blur stay aligned.
  - Update `props.sample.json` with one clip carrying `crop_path`.

**Web** (approved boards V18–V22; build exactly them)
- V18: the Mac player:
  - Controls: Find this toggle and Cut out.
  - Pick mode: a crosshair overlay that maps the click to 0..1 of the displayed video.
  - The tracking veil, the outline overlay (SVG path scaled from frame px), the label chip, an orange in-view band on the scrubber.
  - Right column: hits list, Make a short from these, Show all in the Gallery.
- V19: the Short page:
  - Centre crop / Follows subject preview (the Remotion Player with and without `crop_path`).
  - Rows: "What each shot follows" with the subject chip (edit) and the tracked status.
  - Finish column: the Keep subject in frame switch, the status line and the cost line.
  - Opening the page with keep_subject on and no reframe starts one.
- V20: Settings › Faces and privacy row: "Also blur screens and number plates" with a New badge and the preview card.
- V21: Publish: the Cutout chip, "Make a cutout cover", Background Brand scene / Blurred frame, "How it is made".
- V22: the Cut out dialog: checkerboard preview, Sticker switch (shows the sticker PNG), Copy, Download PNG. Cut out uses the same pick mode as Find this.
- The PWA gets Find this and Cut out on its clip player and the settings switch. V19 and V21 controls go in its existing Short / Publish screens.
- Mock API (`dev:mock`) fixtures for every new call.

## Schedule

| Day | Deliver |
| --- | --- |
| Thu 29 | A0 spikes · A1 backend · A2 mocks posted · owner picks Track B features |
| Fri 30 | A3 build + **Track A closed** · Track B spikes |
| Sat 31 – Mon 2 | Track B picked features (mocks → approval → build) · README "Meta models" · deploy (ask first) |
