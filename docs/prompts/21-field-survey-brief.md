# Build Brief: Phase 21 — Field Survey (public-good mode)

nimbytes turns footage into searchable, understood moments and post-ready shorts. This phase adds a second mode, **Field Survey**: the same engine pointed at public-good inspection work (councils, farms, emergency services, rangers). The output is **a findings report with evidence and work orders** instead of a short. Footage comes from a **phone** (glasses access is pending). A video is a video, so ingest is unchanged.

**Decision taken (owner, 2026-10-28): Option A.** The creator product stays the headline, and Field Survey is a second mode with its own demo segment. Don't rework the deck or the demo script beyond one added segment, unless the owner says so.

**Pitch line for this mode:** *"The same visual memory that edits your shorts can inspect a street, a paddock or a flood zone, and hand the council a prioritised work list with video proof."*

---

## 0. Rules

- `CLAUDE.md` is the rule book. Read it, then `STATUS.md`, `LEARNING.md` "Top lessons", the newest `MEMORY.md` rows, `docs/meta-api.md`, `docs/hackathon-rules.md`, `docs/contracts.md` and `docs/phases/20-meta-depth.md` (Track B is shipped: reuse it). All hard rules apply, in particular:
  - naming
  - new work only
  - no AI attribution
  - fast unit tests for pure rules, parsers, use cases and handlers; no e2e
  - ask before costly or irreversible actions
  - local commits only, never `git push`
  - only `README.md` is published
  - Meta models only for AI
  - vanilla CSS + tokens
  - **mock-first for every visual change** (stop for owner approval)
  - never open the live SQLite file
- **Additive only.** Ingest, search, people, blur, Production Studio, exports and the Mac app keep working as they are. New tables, files and routes; existing files are touched only to register things.
- **Hackathon guards:**
  - **"Simple image analyzers" are banned.** Field Survey must read as an **agent**: it plans a survey, tracks coverage, merges evidence across frames and visits, ranks by severity and writes work orders.
  - **Health/nutrition apps are banned.** No health or medical profiles, wording or examples.
- Write the plan to `docs/phases/21-field-survey.md` first. Record spike results in `docs/meta-api.md` and progress in `STATUS.md`.
- **Deadline:** submission Thu 5 Nov 10:00 Perth time; demo video Tue 3 Nov. Field Survey must be demoable by **Mon 2 Nov**.

---

## 1. Scenarios (built-in profiles)

Ship **3 profiles for the MVP**. The others are config-only additions if time allows.

| Profile | Users | SAM concepts (detect/count) | Spark finding categories | Privacy concepts |
| --- | --- | --- | --- | --- |
| **Road & footpath** (MVP) | Council inspectors | `pothole`, `crack`, `lifted paver` | pothole, crack, trip hazard, damaged kerb | face, license plate |
| **Dumping & litter** (MVP) | Council rangers | `rubbish pile`, `mattress`, `litter` | dumped item, litter, overflowing bin | face, license plate |
| **Storm & flood damage** (MVP) | Emergency services | `damaged roof`, `fallen tree`, `debris` | roof damage, fallen tree, water line, debris | face, license plate |
| Blocked drains | Works crews | `drain`, `leaves`, `rubbish` | blocked drain, partly blocked, clear | face |
| Crop & stock check | Farm officers | `cow`, `sheep`, `damaged leaf` | discoloured crop, pest sign, dry patch, stock count | face |
| Vegetation near power lines | Utilities, fire services | `tree branch`, `power line` | branch near line, heavy dry undergrowth | face, license plate |
| Accessibility audit | Councils, advocates | `ramp`, `steps`, `tactile paving` | missing ramp, broken tactile paving, blocked footpath, steps without rail | face |
| Wildlife & weeds | Rangers | `kangaroo`, `bird`, `weed` | animal count, invasive plant | face |
| Coastal erosion | Coastal councils | `dune`, `exposed roots` | erosion edge, exposed roots | face |

Profiles are **data**, not code: `api/config/survey_profiles.toml` (or a table seeded from it), each with `id`, `name`, `description`, `sam_concepts[]`, `privacy_concepts[]`, `categories[]` with default severity guidance, and `work_order_sla` per severity (e.g. 1 = 48 h, 2 = 7 days, 3 = 30 days).

---

## 2. Spikes first (≤ 2 h, ≤ $0.50; results in `docs/meta-api.md`)

| Spike | Question | Done when |
| --- | --- | --- |
| F1 · SAM concepts | Do the MVP concepts (`pothole`, `crack`, `rubbish pile`, `mattress`, `damaged roof`, `fallen tree`) return useful tracks on a 1 fps phone proxy? Which phrasing works best? | Per-concept verdict + best phrase, fixtures saved |
| F2 · Spark findings | One segment + profile → strict JSON findings: are severity and category stable across 3 runs? | Schema + prompt pass on 3 sample segments |
| F3 · GPS | Read location from iPhone (`com.apple.quicktime.location.ISO6709`) and Android (`location` / `com.android.capture.fps` tags) via `ffprobe` | Parser + fixtures for both phones; documented: location services must be on for the camera |
| F4 · Counting | Unique SAM track ordinals ≈ object count? Where does it double-count (track lost, then re-found)? | A dedupe rule with unit tests |

---

## 3. Data (new migration, next free number)

```sql
CREATE TABLE surveys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  profile_id TEXT NOT NULL,
  title TEXT NOT NULL,                 -- "Smith St footpaths, Oct 2026"
  area_note TEXT NOT NULL DEFAULT '',  -- "Smith St, both sides, 1–80"
  plan TEXT NOT NULL DEFAULT '[]',     -- JSON: planned sections (see 5.1)
  previous_survey_id TEXT REFERENCES surveys (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('collecting','analysing','ready','failed')),
  created_at TEXT NOT NULL
);

CREATE TABLE survey_clips (
  survey_id TEXT NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
  PRIMARY KEY (survey_id, clip_id)
);

CREATE TABLE clip_locations (           -- GPS from the video's metadata, when present
  clip_id TEXT PRIMARY KEY REFERENCES clips (id) ON DELETE CASCADE,
  lat REAL NOT NULL, lon REAL NOT NULL, alt REAL,
  source TEXT NOT NULL                  -- 'iso6709' | 'android'
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL REFERENCES clips (id) ON DELETE CASCADE,
  segment_id TEXT REFERENCES segments (id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),  -- 1 = most urgent
  note TEXT NOT NULL,                   -- one line, plain English
  action TEXT NOT NULL,                 -- recommended action
  t_s REAL NOT NULL,                    -- best frame, clip seconds
  count INTEGER NOT NULL DEFAULT 1,     -- for counting categories
  evidence_key TEXT,                    -- blurred, outlined evidence still
  box TEXT,                             -- JSON normalised box of the best frame
  lat REAL, lon REAL,
  merged_into TEXT REFERENCES findings (id) ON DELETE SET NULL,  -- dedupe across frames/clips
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved')),
  created_at TEXT NOT NULL
);
CREATE INDEX findings_by_survey ON findings (survey_id, severity);
```

S3/R2 keys (add to `keys.rs` only): `users/{u}/surveys/{s}/evidence/{finding}.jpg`, `users/{u}/surveys/{s}/report.pdf`, `users/{u}/surveys/{s}/findings.csv`.

---

## 4. Pipeline: a survey analysis job (no change to clip ingest)

Clips are ingested exactly as today. When a clip that belongs to a survey reaches `ready`, run a **survey analysis** job for that clip. Use a new `JobKind` the way `Title`, `Hash` and the face-matching kind were added: follow that migration pattern.

1. **Location:** parse GPS from the stored probe output (F3) into `clip_locations`. If none, fall back to the survey's `area_note`.
2. **SAM 3.1 detect and count:** run the profile's `sam_concepts` on the clip's 1 fps proxy (reuse the Track B subject adapter and its cache), giving tracks per concept: boxes, best frame per track, unique-object count after the F4 dedupe rule.
3. **Spark findings:** for each segment, send the segment (as describe does today) + the profile categories + the SAM detections in that segment's time range. The result is strict JSON `findings[]` `{category, severity, note, action, t_s, box_ref?}`. A new prompt pair is `api/prompts/survey_findings.md` + `.schema.json`. Validate and retry once, as the other prompts do.
4. **Evidence:** grab the best frame for each finding and draw the outline from the SAM box or mask. **Blur privacy concepts** using the Track B blur (faces, plates, screens). Upload the JPEG.
5. **Merge (pure rule + unit tests):** merge findings of the same category whose boxes overlap in the same segment, or that are within ~10 m GPS / ~5 s of each other across clips. Keep the highest severity and add counts. Mark the rest `merged_into`.
6. Log every SAM and Spark call through `MetaClient` (cached, cost-logged).

---

## 5. The agent parts (what makes it more than an image analyser)

### 5.1 Survey plan + coverage
- On **New survey**, the owner types the area ("Smith St, both footpaths, numbers 1–80") and picks a profile.
- **Spark** turns it into planned sections (`[{id, label: "North side 1–40"}, …]`) and stores them in `surveys.plan`.
- As clips arrive, Spark matches each clip's segments and location to sections. The survey page shows **covered / not yet filmed**, e.g. *"North side 40–80 not covered yet."* Reuse the Production Studio coverage pattern (status column, SSE, retry).

### 5.2 Report + work orders
- **Spark** writes a short **summary**: "14 findings, 3 urgent: two 40 cm potholes outside the school…"
- It also writes **work orders** grouped by severity, with SLA from the profile: *"Priority 1 · Pothole ~40 cm · outside 12 Smith St · repair within 48 h · evidence 0:42."*
- **Exports:** CSV of findings (one row per non-merged finding) and a PDF report (summary, table, evidence stills, links to the second in the clip). Render the PDF server-side without new heavy dependencies; reuse the renderer container (headless Chromium) if it's the simplest path.

### 5.3 Follow-up visit
- A **Revisit** creates a new survey linked by `previous_survey_id`.
- After analysis, a pure matching rule (same category + location within ~10 m) plus a **Spark** check on the two evidence stills marks old findings **resolved** ("mattress no longer there") or **still open**.
- The report gets a "Changes since last visit" section.

### 5.4 Ask the survey (search reuse)
The existing search, scoped to a survey's clips: *"potholes near the school"*, *"dumped items on Park Rd"*. Results land on the exact second.

---

## 6. API (new handler file, contracts, TS mirror)

| Route | Does |
| --- | --- |
| `GET /api/survey-profiles` | Profiles for the picker |
| `GET /api/surveys` · `POST /api/surveys` | List / create (`profile_id`, `title`, `area_note`) → plan generation starts |
| `GET /api/surveys/{id}` | Survey, plan with coverage, findings (signed evidence URLs), counts by severity, summary |
| `GET /api/surveys/{id}/events` | SSE: plan, per-clip analysis steps, coverage, report |
| `POST /api/surveys/{id}/clips` | Add existing clips; uploads from the survey page attach automatically |
| `PUT /api/findings/{id}` | Edit severity, note, status (dismiss / resolve) |
| `POST /api/surveys/{id}/report` | (Re)build summary, work orders, CSV and PDF; returns signed download URLs |
| `POST /api/surveys/{id}/revisit` | Create the follow-up survey |
| `DELETE /api/surveys/{id}` | Delete survey, findings and exports (not the clips) |

---

## 7. Screens (mock first, then build exactly what's approved)

Add **Surveys** where Productions lives (PWA and Mac), same compact patterns.

1. **Surveys list:** cards with profile icon, title, area, findings by severity (1–5 chips), coverage bar, last visit date.
2. **New survey:** profile picker (cards with one-line description), title, area text, "Upload footage" or "Add clips".
3. **Survey page:**
   - plan sections with covered / missing state
   - findings table (severity, category, place, time, evidence thumb) with filters
   - selecting a finding shows the evidence still and plays the clip at that second
   - actions: Dismiss, Resolve, Edit severity
4. **Report:** summary, work orders by priority, "Changes since last visit", **Download PDF** and **Download CSV**.
5. Optional, only if time allows: a simple map of findings (Leaflet + OpenStreetMap tiles, attribution shown), or a "grouped by street" list instead.

Wording is plain and professional, no emoji. Severity colours come from existing status tokens (problem / warning / success); never colour alone, always the number too.

---

## 8. Testing (owner does the field tests by hand; agents add unit tests only)

**Unit tests (same commit as the code):**
- GPS tag parsers (iPhone ISO6709, Android)
- F4 count dedupe
- finding merge rule
- severity → SLA mapping
- coverage matching rule
- revisit matching rule
- CSV writer
- profile config loader
- findings schema parser

**Owner field test plan** (phone, location services on for the camera). Before filming, write the ground truth on paper:

| Test | Film | Check |
| --- | --- | --- |
| Road & footpath | Walk ~200 m of your street: cracks, potholes, a parked car, people passing | Found vs real count; plates and faces blurred in evidence; GPS shown |
| Dumping & litter | A bin area or rubbish pile; film again after it's cleared | Found on visit 1; "resolved" on the revisit |
| Storm & flood stand-in | Fallen branches, debris after wind, a damaged fence | Categories and severities sensible; work orders readable |
| Coverage | Film only half the planned area | "Not covered yet" names the right section |
| Counting stand-in | Your pets or a group of birds as "stock" | Count correct ±1 |

Record in `STATUS.md`: findings found / real, false alarms, cost per minute of footage, time from upload to report. These are the numbers for the pitch slide.

---

## 9. Order of work

| Day (Perth) | Deliver |
| --- | --- |
| Thu 29 Oct | Phase doc, spikes F1–F4, migration, profiles config, contracts + TS mirror |
| Fri 30 Oct | Analysis job (location, SAM detect/count, Spark findings, evidence with blur, merge); survey API + SSE |
| Sat 31 Oct | Plan + coverage, report + work orders, CSV; **mocks for the 4 screens → owner approval** |
| Sun 1 Nov | Build approved screens (PWA + Mac), PDF export, revisit |
| Mon 2 Nov | Owner field tests, fixes, README "Field Survey" section (what it does, Meta models per step, privacy), STATUS numbers |
| Tue 3 Nov | Demo video (owner): one Field Survey segment |

**Cut order if behind:** map → revisit → PDF (keep CSV + on-screen report) → profiles beyond the 3 MVP ones → coverage (keep findings + report). **Never cut:** SAM detection with evidence and privacy blur, Spark findings with severity, merge, the report with work orders, CSV.

---

## 10. Definition of done

1. Create a "Road & footpath" survey, upload phone footage, and see live analysis steps, then findings with severity, note, action, place and an outlined evidence still with faces and plates blurred.
2. Duplicate sightings are merged; counts are right on the counting stand-in.
3. Coverage names the section not yet filmed.
4. The report shows a summary and priority work orders with SLA; CSV and PDF download and open.
5. A revisit marks a cleared item "resolved".
6. Every new Meta call appears in the costs screen; gates are green; nothing pushed; existing features untouched.
