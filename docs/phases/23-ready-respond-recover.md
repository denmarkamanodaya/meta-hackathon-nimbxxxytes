# Phase 23: Ready, Respond, Recover. Study and implementation plan (review copy, no code)

Status: **building. Owner rulings 2026-10-28: mocks V23–V28 approved; English voice only.** Clips downloaded, spikes done. Backend and renderer first; UI after the owner approves the mocks (rule 11).

This is the public-good mode for the hackathon. It **replaces** Field Survey (Phase 21) and folds in the useful parts of Access (Phase 22). Both docs stay parked: their merge, revisit, coverage, spoken-output and Easy Read designs are reused here.

Deadlines: demoable Mon 2 Nov · demo video Tue 3 Nov · submission Thu 5 Nov 10:00 Perth.

---

## 1. Problem and pitch

- In typhoons, floods, bushfires and storms, **older people are the most likely to die**. Plans are generic, and nobody knows who has been checked.
- In the first 48 hours, responders work blind. Residents film everything on their phones, but those clips sit in a hundred camera rolls.

**Pitch:** *"nimbytes turns the footage a community already films into a safety system for its older people: a personal evacuation plan before the storm, one fused picture of what happened and who still needs a knock on the door during it, and proof of what's fixed after."*

| Stage | For | Output |
| --- | --- | --- |
| **Ready** (before) | An older resident and their family | A **personal evacuation plan** from one walkthrough of the home and route: exits, obstacles to clear now, the alternate if the main exit is blocked, what to grab, the route to the shelter. Spoken in their language (Piper) + picture cards + a printable page. Community roll-up: who needs physical help to evacuate, by area |
| **Respond** (during/after) | A community coordinator, volunteers | Contributions (clips) from many people become **fused incidents** with evidence and confidence. A **people-to-check list** ranked by urgency. A **dispatch list** per team. A **situation report** written by the coordinator agent every run |
| **Recover** (after) | Coordinator, council | Later footage marks incidents **resolved** with before/after proof; recovery progress by area |

**What it is not:** an emergency service or a replacement for one. It is decision support for community groups; every dispatch is human-approved. No health or medical wording anywhere: "needs help to evacuate", "check-in", never conditions.

## 2. Why it is intelligent (hackathon "agent" test)

1. **Fusion across contributors:** the same blocked road seen by 6 people becomes 1 incident. PE proposes matching sightings, and **Spark confirms each pair** (the proven face-matching pattern), with the evidence shown.
2. **Confidence:** the number of independent contributors and the recency. A single-source incident shows as "unconfirmed" and is never hidden.
3. **Prioritisation:** severity × people-at-risk nearby × time unchecked × confidence. A pure, explainable rule plus a Spark one-line reason.
4. **Coverage:** which areas nobody has filmed and which registered residents nobody has seen (the Field Survey coverage design).
5. **Planning (Ready):** reasons about a route for one person. It notices the steps, the gate and the clutter, and works out the alternate exit.
6. **Recover:** compares new sightings to open incidents (the revisit rule + a Spark before/after check).
7. **Coordinator agent:** Spark with tools (`list_incidents`, `list_unchecked`, `coverage`, `draft_dispatch`) writes the situation report and a draft dispatch. A human approves.

## 3. Meta models and tools per step

| Step | Model / tool |
| --- | --- |
| Understand each clip (segments, facts, speech) | Existing ingest: **Muse Spark** (video), **Voice Transcribe** (any language), **PE** vectors |
| Find hazards and objects (fallen tree, flood water, debris, damaged roof, power line, person) | **SAM 3.1** concepts on the 1 fps proxy (the Track B adapter) |
| Name, rate and describe a sighting | **Muse Spark** strict JSON (category, severity, note, action) |
| Evidence still with outline + privacy blur | **SAM** (outline, faces, plates) + the renderer (`EvidenceStill`) |
| Same incident? | **PE** proposes, **Muse Spark** confirms (image pair) |
| Situation report, dispatch, reasons | **Muse Spark** (tool loop, budgets) |
| Ready plan from a walkthrough | **Muse Spark** (route reasoning), **SAM** (doors, steps, gates, stairs), **Muse Image** (picture cards anchored on real frames) |
| Spoken plan and alerts | **Piper** (third-party, owner-approved), in the resident's language where a voice exists |
| Translation | **Muse Spark** |
| Ask the event | The existing search, scoped to the event |

## 4. Data model (migration `0014_rrr.sql`)

| Table | Holds |
| --- | --- |
| `events` | id, user, title ("Storm, Victoria Park, 30 Oct"), kind (storm, flood, fire, other), areas JSON (the streets/blocks list = sections), status, created |
| `contributions` | event, clip, contributor label, area (picked at upload, else inferred), filmed_at |
| `sightings` | contribution, segment, category, severity 1–5, note, action, t_s, box, evidence_key, crop_key, area, incident_id |
| `sighting_vectors` | vec0 1024-d (PE on the evidence crop) |
| `incidents` | event, category, area, severity (max), confidence (distinct contributors), status open / assigned / resolved / dismissed, first_seen, last_seen, best_sighting, reason |
| `incident_links` | sighting pairs with the Spark verdict (same / different / unsure) and the reason, so a merge can be explained and undone |
| `residents` | registered older residents (opt-in): name, area, address note, language, needs JSON (`help_to_evacuate`, `stairs_hard`, `no_car`, `lives_alone`), contact, consent_at |
| `resident_checks` | event, resident, status unchecked / seen_ok / needs_help / no_answer, evidence (contribution + t_s), by, at |
| `plans` | resident, walkthrough clips, plan JSON (exits, obstacles, alternate, grab list, route steps), language, audio_key, cards_key, page_key, version |
| `dispatches` | event, team label, tasks JSON, status draft / approved, created |

- A job kind `rrr` follows the 0008 jobs rebuild pattern, with a child-rows test (LEARNING #7).
- Categories and SAM concepts per event kind live in config `api/config/rrr_kinds.toml`, not code.

**Location** (GPS stays parked): `area` is chosen from the event's area list at upload, else inferred by Spark from visible street signs and the transcript (spike R5), else "unknown area" (shown honestly).

## 5. Pipelines

### 5.1 Respond: per contribution (job `rrr`, resumable steps)
1. `detect`: SAM concepts for the event kind on the 1 fps proxy → tracks, with the count dedupe from Field Survey F4.
2. `sightings`: Spark per segment, given the categories + detections in its range → strict JSON.
3. `evidence`: `frame_at` → SAM image (`face`, `license plate`) → EvidenceStill (outline + blur) → R2; crop → PE vector.
4. `people`: Spark + Faces match the segments against registered residents' areas. A resident seen at their door → `seen_ok` / `needs_help` with evidence. **Never a face-ID claim**: the coordinator confirms.
5. `fuse`: candidates are incidents with the same category and area plus PE ≥ τ1 (config) → Spark pair check → link or new incident. Pure confidence and priority update.
6. `done`. SSE events to the event page.

### 5.2 Respond: per event (after each contribution, debounced)
- **Coverage:** areas with no contribution in the last N hours; residents unchecked.
- **Priority** (pure): `score = severity_w × (1 + at_risk_nearby) × age_factor(unchecked hours) × confidence_w`. Top-N, with a reason string.
- **Coordinator agent** (Spark, tool loop, budget ≤ 8 calls / $0.05): situation report (≤ 120 words) + a draft dispatch (teams × ranked tasks). Shown as a draft; a human approves.

### 5.3 Ready: per resident
- Inputs:
  - 1–2 walkthrough clips (inside the home → front door → street, and the route to the shelter);
  - the resident's needs (checkboxes) and language.
- Steps:
  1. SAM concepts (door, stairs, step, gate, rug, clutter, ramp) with timestamps.
  2. Spark route reasoning to strict JSON: primary exit, alternate exit, obstacles to clear now (with the frame), the route steps with landmarks, the grab list (essentials: ID, phone, keys, charger, water, warm layer), and who to call.
  3. Muse Image picture cards anchored on the real frames (one per step).
  4. Piper audio of the plan in their language.
  5. A printable plan page (HTML print).
- **Community roll-up:** residents by area who need help to evacuate. It feeds Respond's priority before anything has happened.

### 5.4 Recover
- New contributions in an area with open incidents: same category + PE match → Spark before/after check ("tree no longer across the road") → `resolved` with both stills.
- A recovery progress bar per area.

## 6. API (new handler files, contracts, TS mirror)

`GET/POST /api/events` · `GET /api/events/{id}` (overview: incidents, people, coverage, latest sitrep) · `GET /api/events/{id}/stream` (SSE) · `POST /api/events/{id}/contributions` (clip ids + contributor + area) · `GET /api/incidents/{id}` (sightings, links + reasons, evidence) · `PUT /api/incidents/{id}` (status, severity, unmerge) · `GET/POST /api/residents` · `PUT /api/residents/{id}` · `PUT /api/events/{id}/checks/{resident}` · `POST /api/events/{id}/dispatch` (draft) · `PUT /api/dispatches/{id}` (approve) · `POST /api/residents/{id}/plan` (walkthrough clip ids) · `GET /api/plans/{id}` (plan + audio + cards + page URLs). Ownership on every route.

## 7. Screens (mock first on the redesign-v2 canvas, Mac + PWA compact)
1. **Events list** + New event (kind, title, areas list).
2. **Event board** (the hero): ranked incidents with evidence thumbs and confidence ("seen by 4"), a people-to-check list, a coverage strip by area, the latest situation report, a "Draft dispatch" button.
3. **Incident detail:** fused sightings side by side, each with its contributor, time and the Spark "same incident because…" reason; Unmerge / Resolve / Dismiss / severity.
4. **Dispatch draft:** teams × tasks, editable, Approve.
5. **Residents** register (consent checkbox) + resident page with the **Ready plan**: spoken plan player, picture cards, Print.
6. **Contribute** (PWA-first): upload clips into an event, pick the area, contributor name.

## 8. Testing with sample clips (owner lives solo)
- **Clip set**, shortlisted separately: 1–2 DVIDS events with 6–12 overlapping clips (each = a contributor) + 10–15 Pexels/Pixabay single scenes.
  - Licences recorded per clip; stored in git-ignored `data/samples/` and never committed.
  - Credited on screen and in the README "Third-party" section if used in the demo.
- **Answer sheet:** for each event, the owner (or I, from watching) writes the true incidents and which clips show each. Measured: incidents found / real, duplicates merged, wrong merges, false alarms, $/min, upload → board time.
- **Overlap padding:** long DVIDS b-roll is cut into overlapping pieces uploaded as separate contributors (known duplicates).
- **Fusion, priority and coverage** are proven by unit tests on hand-made sightings, without footage.
- **Ready** is tested on the owner's own home walkthrough (solo-friendly, about 10 min) + 1 Pexels doorway/path clip.
- **Recover:** a later clip of the same place (DVIDS often has before/after or day 1 / day 3 packages), or the same cleared spot on the owner's street.

## 8b. Footage licences and credits (owner ruling 2026-10-28)
- The rules and conditions are in `docs/hackathon-rules.md` "Licensed sample footage".
- The clips are in `data/samples/` (git-ignored) with `SOURCES.csv`; the shortlist is in `docs/phases/23-clip-shortlist.md`.
- Demo: an on-screen credit + the DVIDS no-endorsement line while sample footage plays; README "Third-party" lists every clip; faces and plates blurred.

## 9. Spikes first (Thu 29 AM, ≤ 2.5 h, ≤ $1)

| Spike | Question |
| --- | --- |
| R1 | SAM concepts on DVIDS clips: `fallen tree`, `flood water`, `debris`, `damaged roof`, `power line`, `person`. Which phrasing works at 1 fps |
| R2 | Spark pair check on 10 sighting pairs (5 same, 5 different): accuracy, cost |
| R3 | Piper on arm64 Docker: speed, quality, voice licences, **which languages exist** (Tagalog? Spanish? Chinese?) and the fallback when none exists (English + on-screen translation) |
| R4 | Spark Ready plan from the owner's walkthrough: is the route reasoning correct? |
| R5 | Area inference from street signs + transcript on DVIDS clips |

## 9b. Spike results (2026-10-28) and plan changes
- All 5 spikes ran (≈ $0.25); facts in `docs/meta-api.md` "Phase 23 spikes".
- **Fusion design change (from R2):** two levels.
  1. **Merge** only on a Spark "same" verdict (no false merges seen).
  2. **Related cluster:** same category + same area + time window are grouped as "probably the same", shown to the coordinator with a one-click Merge.
  - Sightings send 2–3 frames + the SAM crop to raise recall.
- **Concept list (from R1):** short nouns only; profile per event kind updated.
- **Language (from R3):** no Tagalog voice. A resident's plan is **spoken** in their language when Piper has it (58 languages), otherwise spoken in English with the plan **shown** in their language (Spark translation). The demo resident should speak a Piper language (owner decision), or keep Tagalog as on-screen text.
- **Ready prompt (from R4):** use the resident's name, never pronouns; describe places and objects, never bodies.
- **Area (from R5):** picked area first; Spark clue-reading as a fallback; "unknown area" when there are no clues.

## 9c. Build contract (one source for the api and render teammates)

Owner rulings 2026-10-28:
- Piper is the voice. No Tagalog voice is fine: the plan is spoken in English and shown translated.
- Two-level fusion.
- Licensed sample footage.

**Config** `api/config/rrr_kinds.toml`, compiled in and validated like `prices.toml`. Per event kind (`storm`, `flood`, `fire`, `other`):
- `concepts[]`: short nouns from R1;
- `categories[]`: `{id, label, severity_hint}`. Ids: `blocked_road`, `fallen_tree`, `flood_water`, `damaged_building`, `damaged_roof`, `damaged_vehicle`, `debris`, `downed_line`, `person_needs_help`, `other`.

**Migration `0014_rrr.sql`**
- The tables in §4.
- `sightings` keeps `frames_key` (2–3 JPEG frames for pair checks).
- `incidents` gains `cluster_id` (the related-cluster level).
- A jobs table rebuild adds kind `rrr` (the 0008 pattern), with a child-rows test.
- Upsert; never delete-and-reinsert.

**Contribution job `rrr`** (resumable steps, Studio-style SSE on the event):
1. `detect`: SAM concepts of the event kind on the clip's 1 fps proxy (the Track B adapter + cache); count dedupe.
2. `sightings`: Spark per segment (the segment video, as describe does) + the categories + SAM detections in range → strict JSON `{category, severity 1–5, note, action, t_s}`. The notes rule: describe places and objects, never people's bodies or health.
3. `evidence`, for each sighting:
   - `frame_at(t_s)`;
   - SAM **image** `face` and `license plate` → blur boxes;
   - the best SAM box/mask → renderer `/mask/path` → outline;
   - renderer `POST /evidence` → JPEG in R2;
   - 2–3 frames (t−1 s, t, t+1 s) stored for pair checks;
   - the PE vector of the crop.
4. `area`: the area picked at upload. Else Spark reads clues from 3 frames with an **enum of the event's areas + `unknown`** (R5 prompt) and accepts medium or high confidence. Else `unknown`.
5. `fuse`: pure candidate rule (same category, same area or either unknown, PE ≥ `pair_pe_min` from config).
   - Spark pair check (R2 prompt, the frames of both sightings) → `same`: link to the incident (confidence = distinct contributors);
   - `different`: new incident;
   - `unsure`, or no check because only category, area and a 2 h window match: new incident with the **same `cluster_id`** ("probably the same", one-click Merge).
   - Every verdict + reason goes in `incident_links`.
6. `recover`: an open incident in the same area and category, and the new sighting is **clear**? A Spark before/after check (old evidence + new frame → `resolved | still_there | unsure` + reason). `resolved` attaches the after-evidence.
7. `done` → triggers the event refresh.

**Event refresh** (debounced, Runs claim):
- coverage (areas with no contribution in the window; residents unchecked);
- pure `priority`: `severity_w[sev] × (1 + residents_at_risk_in_area) × age_factor(hours open) × confidence_w(contributors)` with a reason string; weights in config;
- **coordinator agent**: Spark tool loop (`list_incidents`, `list_people`, `coverage`, `draft_dispatch`), budget ≤ 8 calls / $0.05. Its outputs, a sitrep (≤ 120 words) + a draft dispatch `{teams:[{name, tasks:[{incident_id|resident_id, text}]}]}`, are stored as a **draft**. A person approves.

**Ready plan** `POST /api/residents/{id}/plan {clip_ids}`, background:
1. Sample 8–12 frames across the clips.
2. Spark plan (the R4 schema + prompt fixes: the resident's name, no pronouns, no body words).
3. When the resident's language is not English, Spark translates the plan text.
4. Narrator: spoken in the resident's language if a voice exists, else English.
5. Muse Image picture cards: one per route step (≤ 6), anchored on the referenced frame, the storyboard style.
6. The plan page is rendered by the web from the plan JSON (print CSS).
7. Store audio, cards and plan in R2 + `plans`.

**Renderer** (`render/`)
- `POST /evidence`: `EvidenceStill` props `{image_url, width, height, outline?:{path, frame_w, frame_h}, blur:[{x, y, w, h}] (0..1), label?}` → JPEG.
  - Blur reuses the FaceBlur approach.
  - The outline is a teal stroke.
  - Drift sample `render/fixtures/evidence_still.sample.json`.
- `POST /speak` `{text, voice, out_url}` → WAV PUT; reply `{duration_s}`. **Owner ruling: English voice only** (`en_US-ljspeech-medium`, public domain); other languages are shown as translated text. Piper runs inside the render image:
  - `python3` + `piper-tts` at an **exact pinned version**;
  - voices baked in at image build. Pick voices whose model-card dataset licence permits this use, record each in `render/NOTICE-voices.md`, and list them in the README "Third-party";
  - at least `en_US` plus 4 of `es`, `zh_CN`, `vi_VN`, `hi_IN`, `ar_JO`;
  - `GET /voices` lists them.
  - The queue is separate from renders (speech is fast).

**API** routes as in §6, plus `GET /api/voices`. Ownership on every route. Contracts in `contracts/src/rrr.rs`, TS mirror (the web teammate later).

**Tests:**
- pure rules (candidate filter, confidence, priority, coverage, cluster, the area enum mapping, the frame-time mapping);
- use cases with fakes (job steps resume; a wrong-owner `FORBIDDEN`; the agent budget stop);
- handlers via `oneshot`;
- wire-format tests on every Spark, SAM, renderer and narrator body;
- parsers on the R1–R5 fixtures (copy them from `docs/phases/23-spikes/` into `api/tests/fixtures/rrr/`).

## 9d. Performance pass: TOMORROW, 29 Oct (owner decision 2026-10-28 23:00)

Measured on the local Helene run (ledger `model_calls`, from a DB copy, after 13:30 UTC). The CPU is idle (< 1 %); the time goes to waiting on remote calls made one at a time.

| Purpose | Calls | Avg | Total |
| --- | --- | --- | --- |
| `rrr_detect` (SAM concepts) | 67 | **110 s** (max 364 s) | **99 min** |
| `rrr_evidence` (SAM image privacy) | 390 | 5.7 s | 36 min |
| `segment_facts` (ingest Spark) | 186 | 9.1 s | 27.5 min |
| `rrr_sightings` | 131 | 9.9 s | 16.5 min |
| `rrr_pair` | 7 | 27.9 s | 3.3 min |
| coordinator / area | 4 | 33–45 s | 2.4 min |

**Investigation (2026-10-28 23:10):** `docs/investigations/2026-10-28-latency.md` + raw CSVs. **44 of 74 SAM detect calls failed** (36 × HTTP 413 "request too large (~41 MB) … use the Files API or store=false", 8 × transport). Failed calls are 86 % of detect wait. The main cause is our request, not Meta's speed.

Plan (one teammate, about 2–3 h; then measure again with the saved script):
- **P0 SAM requests:** send `store:false` + upload large media via the Files API (`file_id`) instead of base64. This removes the 413s and retries; do it first.
- **P1 SAM detect:** use a 640 px 1 fps copy (the spike size; the pipeline sends the 1280 px proxy, 240 frames for 4 min), `mask_encoding one_bit`, concepts in **parallel**, and fewer frames for long clips. Target: 13 min → 1–2 min per 4-min clip.
- **P2 Bounded parallelism** (config `rrr.concurrency`, default 6) in sightings per moment, evidence per sighting and pair checks (the `buffered(n)` pattern from `spark.rs` / `image.rs`). Meta allows 3,000 RPM.
- **P3 Fewer privacy calls:** reuse the ingest face boxes for faces; SAM image only for `license plate` (and `screen`).
- **P4 Lighter pair check:** 1 frame per sighting instead of 3, effort minimal. Target: 28 s → about 8 s.
- **P5 Server:** t4g.xlarge + `WORKERS=4` for the demo recording and judging (ask before the resize; quote live prices first). Pre-process the demo events on the server so judges open a full board.
- **P6 Timing:** per-step duration logs + `scripts/latency-report` (the ledger query above, run on a copy of the DB, never the live file).
- Not doing: Modal. Our wait is Meta's hosted models, and Modal can't speed those up. Revisit only for self-hosted SAM weights after the hackathon.

Targets: a 4-min clip about 15 min → 2–3 min; a judge's 1-min phone clip → about 2–4 min to the board; the 12-clip event → about 10–15 min on xlarge. Cost the same or lower.

## 10. Phases and schedule

| Phase | Day | Deliver |
| --- | --- | --- |
| 23.0 Spikes + clip set | Thu 29 AM | R1–R5; download the approved clips; answer sheet |
| 23.1 Foundations | Thu 29 | Migration + jobs rebuild, kinds config, keys, contracts + TS mirror, Piper adapter (`Narrator` port) in the api image |
| 23.2 Respond pipeline | Fri 30 | The `rrr` job steps 1–4, EvidenceStill in the renderer |
| 23.3 Fusion + agent | Fri 30 – Sat 31 | Fuse, confidence, priority, coverage, coordinator sitrep + dispatch draft, SSE |
| 23.4 Mocks → approval | Fri 30 (parallel) | Screens 1–6. **Stop for approval** |
| 23.5 Ready | Sat 31 | Plan generator, picture cards, Piper audio, print page, community roll-up |
| 23.6 Recover | Sun 1 | Resolution rule + before/after check, recovery progress |
| 23.7 Build UI | Sat 31 – Sun 1 | The approved screens, Mac + PWA compact |
| 23.8 Test + close | Mon 2 | Run the clip set and score it; owner walkthrough; README "Ready, Respond, Recover" (models per step, third-party: Piper, clip credits, privacy); `STATUS.md` numbers |

**Cut order:** Recover → dispatch draft (keep the ranked list) → picture cards (keep the spoken plan + page) → area inference (keep picked areas).
**Never cut:** fused incidents with evidence and confidence, the people-to-check list, the Ready spoken plan.

## 11. Risks

| Risk | Resolution |
| --- | --- |
| SAM misses disaster textures (flood water, damage) | R1. Spark-only sightings stay valid without outlines |
| Wrong merges hide incidents | Pair checks with reasons, an Unmerge button, conservative thresholds; single-source incidents are never dropped |
| Overclaiming people's status | Status only from explicit evidence; "unconfirmed" by default; a human confirms; no face identification of residents beyond the opt-in Faces naming |
| Piper lacks a resident's language | English voice + on-screen translated text; listed honestly |
| Licences of sample clips | Only public domain or Pexels/Pixabay licence; recorded per clip; never committed |
| Banned categories | No health wording; it is a coordination agent, not an image analyzer |
| Scope | Teammates in parallel (api, render, web); the cut order above |

## 12. Owner decisions
1. Approve this as the public-good mode (parks Field Survey and Access).
2. Approve the clip shortlist before any download.
3. Piper is confirmed; the languages are decided after R3.
4. Mac + PWA (Contribute screen PWA-first).
