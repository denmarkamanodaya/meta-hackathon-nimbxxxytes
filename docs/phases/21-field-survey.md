# Phase 21: Field Survey, investigation and phased plan (rev 2, review copy, no code)

Status: **rev 2, 2026-10-28, waiting for owner review.** Brief: `docs/prompts/21-field-survey-brief.md` (Option A: the creator product stays the headline; Field Survey gets one demo segment).

**Owner ruling 2026-10-28: GPS is parked.** Nothing reads, stores or shows coordinates.
- A finding's place is its **plan section** (from coverage), else the survey's area note.
- Merging and revisits use **section + time + Perception Encoder similarity** instead of distance.
- Consequence: **ingest stays fully unchanged.** No probe change and no `clip_locations` table.

Deadlines: demoable Mon 2 Nov · demo video Tue 3 Nov · submission Thu 5 Nov 10:00 Perth.

---

## 1. Verdict

**Feasible in the window, and simpler without GPS.** About 75 % is reuse.
- What's new is the survey domain: profiles, findings, merge, plan, coverage, report, revisit, plus four screens.
- One real risk must be spiked first: whether SAM finds **potholes and cracks** (textures, not objects).

## 2. Reuse map (engine today → Field Survey)

| Survey need | Existing piece | Change |
| --- | --- | --- |
| Footage in | Upload + ingest (segments, Spark facts, transcript, faces at 1 fps, PE vectors) | **None** |
| Detect / count | Track B `SubjectTracker::segment` (concept, cache), 1 fps proxy | None. The job calls it once per concept |
| Outline on evidence | Renderer `/mask/path` | None |
| Privacy on evidence | SAM concepts (faces, plates, screens; B1 phrases) | New still path. Track B blurs **videos**; evidence is a **still**, so the renderer gets an `EvidenceStill` composition (frame + outline + blur boxes) |
| Strict JSON findings | `SparkReasoner` + `StrictSchema` + retry | New prompt pair |
| Plan → coverage → **place** | Production Studio `shot_list` → `match_coverage`, Studio background run, `Runs<K>`, SSE | Same pattern, survey wording. The matched section is the finding's place |
| Same object across frames and clips | `object_vectors` + PE crops (Find this) | PE similarity of evidence crops is the merge and revisit signal |
| Background per clip | `jobs` table + worker | New kind `survey`. The jobs `CHECK (kind IN …)` forces a table rebuild, the 0008 way, with a child-rows test (LEARNING #7) |
| Ask the survey | Search | `SearchRequest` has no scope. Add an optional `survey_id` filter (additive) |
| Costs screen | `GET /api/costs` | None |
| Mac + PWA shell | Productions list/page patterns, compact Night | New Surveys section beside Productions |

## 3. Gaps and risks

| # | Finding | Impact | Resolution |
| --- | --- | --- | --- |
| R1 | SAM is open-vocabulary but object-centric. `pothole`, `crack` and `lifted paver` are textures and may return nothing or noise | Road & footpath, the first MVP profile, rests on it | **Spike F1 first.** If weak: Spark finds them from the segment (category, note, `t_s`), SAM boxes only the concepts that work, and that evidence goes un-outlined (still valid). Try 2 phrasings each |
| R2 | SAM takes **one concept per request**, minimum 50 frames | Cost and latency scale with concepts | 3 concepts × 60 frames/min ≈ $0.036/min. Cap 6 concepts per profile |
| R3 | Counting: a track lost then re-found gets a new ordinal; 1 fps loses fast movers | Double counts | F4 dedupe rule: same concept, gap ≤ 2 s and the next box near the last one, **or** PE crop similarity ≥ 0.85. Counting profiles may set 2 fps in config |
| R4 | Without GPS, two different potholes in one section can look alike | Over-merging | Merge only on **same category + same section + (same clip ≤ 5 s apart, or PE ≥ 0.85 across clips)**. A merge is a soft `merged_into` the owner can undo (Unmerge on the finding) |
| R5 | **PDF**: Remotion renders stills, not PDFs; `page.pdf()` needs Puppeteer (a new dependency) | The brief's "no new heavy deps" | Spike F5 (30 min): can the bundled Chrome Headless Shell print through `@remotion/renderer`'s browser API? Fallback, no dependency: render report pages as JPEG stills and wrap them in a minimal hand-written PDF (pure Rust, tested). Or cut it (CSV + on-screen report stay) |
| R6 | Severity stability: Spark may wander between 2 and 3 | Ranking noise | F2: 3 runs per segment. Rubric + anchored examples per profile, strict enum, low effort |
| R7 | Evidence privacy: the best frame needs exact blur | A face or plate left readable | A SAM image pass on each evidence still: `face`, `license plate`, `screen`, 3 × $0.0025 per finding, padded 30 % |
| R8 | Hackathon: "simple image analyzer" ban; health ban; one 3-min video | Disqualification risk / diluted demo | Present it as an **agent**: plan → coverage → detect → merge → rank → work orders → revisit. No health wording ("stock count", never animal health). One ~40 s segment after the creator story |
| R9 | Time: ~4 build days after Tracks A and B | Overrun | Teammates in parallel; mocks posted Fri; cut order below |

## 4. Cost estimate (per minute of phone footage, on top of ingest ≈ $0.05–0.09)

| Step | Estimate |
| --- | --- |
| SAM detect, 3 concepts at 1 fps | $0.036 |
| Spark findings, ~8 segments/min, low effort | $0.04–0.05 |
| Evidence privacy, SAM image × 3 per finding (~2 findings/min) | $0.015 |
| Plan, coverage, summary, work orders (per survey) | ≈ $0.02 |
| **Total** | **≈ $0.10/min** + ingest ≈ **$0.15–0.20/min**. The real number goes in `STATUS.md` after the field tests |

## 5. Owner decisions (recommendation first)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | PDF route | Spike F5. If no clean path, image-PDF (no dependency); cut it if behind |
| D2 | Per-clip trigger | New `survey` JobKind (0008-style jobs rebuild, child-rows test). The ingest `ready` step only registers it when the clip is in a survey (one line, no behaviour change) |
| D3 | Place | Plan section from coverage, else area note. "Grouped by section" replaces the map |
| D4 | Map | Cut |
| D5 | Platforms | Mac full. PWA: list, New survey with phone upload, survey page and report (compact) |
| D6 | Spend | Spikes ≤ $0.50; field tests ≈ $2–5 |
| D7 | Profiles | 3 MVP. Others as TOML rows only if F1 shows their concepts work |

---

## 6. Phased plan

Every step: unit tests in the same commit, local commits only, `STATUS.md` after each phase, spike facts in `docs/meta-api.md`.

### 21.0 Phase doc + spikes (Thu 29 Oct AM, ≤ 2 h, ≤ $0.50)

| Spike | Question | Done when |
| --- | --- | --- |
| F1 SAM concepts | pothole / crack / rubbish pile / mattress / damaged roof / fallen tree (+ 2 phrasings each) on 1 fps phone proxies | A verdict per concept + best phrase + fixtures |
| F2 Spark findings | Segment video vs keyframes + segment facts; severity/category stable over 3 runs | Prompt + schema pass on 3 segments; cheaper input picked |
| F4 Counting | Ordinals vs real count on pets/birds; where it double-counts | Dedupe rule + tests |
| F5 PDF | Chrome Headless Shell print through Remotion's renderer API? | Yes/no; route chosen |

Owner input: 3–4 short phone clips (a street with cracks, a rubbish pile, debris, pets/birds), uploaded as usual.

### 21.1 Foundations (Thu 29 Oct)
- **Migration `0014_field_survey.sql`:**
  - `surveys` (+ `plan`, `coverage` JSON, `summary`, `work_orders` JSON, report keys, status);
  - `survey_clips`;
  - `findings` as in the brief, **without lat/lon**, plus `section_id`, a `crop_key` for PE and `merged_into`;
  - `finding_vectors` (vec0 1024-d per user);
  - `survey_clip_runs` (step, status per clip);
  - the jobs rebuild adding `survey` (child-rows test).
- **Profiles:** `api/config/survey_profiles.toml` (3 MVP) + a loader with validation (unique ids, severities 1–5, SLA per severity), compiled in like `prices.toml`.
- **Keys** in `keys.rs`: evidence, crops, report.pdf, findings.csv.
- **Contracts** `contracts/src/surveys.rs` + TS mirror.

### 21.2 Analysis job (Fri 30 Oct)
`survey` job steps, per clip, resumable:
1. `detect`: SAM concepts on the 1 fps proxy → tracks → F4 dedupe → counts.
2. `findings`: Spark per segment with profile categories + detections in the range → strict JSON `{category, severity, note, action, t_s, box_ref?}`.
3. `evidence`: `frame_at` → SAM image privacy concepts → renderer `EvidenceStill` (outline + blur) → R2; crop → PE vector.
4. `place`: the segment's coverage section.
5. `merge`: pure rule (R4). Keep the highest severity, sum the counts.
6. `done`

SSE through the Studio-style stream. A failure fails only that clip's analysis, never the clip.

Renderer: an `EvidenceStill` composition (image, outline path, blur boxes) through `/still`.

### 21.3 Agent layer (Fri 30 – Sat 31 Oct)
- **Plan:** Spark area → sections (strict schema), on create.
- **Coverage:** Spark matches each clip's segments to sections (the `match_coverage` pattern) → covered / not yet filmed; re-run when each clip is done; the sections become places.
- **Report:**
  - Spark summary + work orders (priority, category, size note, section, SLA from profile, evidence time);
  - CSV writer (pure, RFC 4180, tested);
  - PDF per F5;
  - signed URLs.
- **Search scope:** an optional `survey_id` on `SearchRequest` (additive; the existing tests stay green).
- **API:** the brief's 9 routes + `GET /api/survey-profiles` + `POST /api/findings/{id}/unmerge`; ownership on every route; handler tests.

### 21.4 Mocks → owner approval (Fri 30 Oct, parallel to 21.2)
Boards on the redesign-v2 canvas (Mac + PWA variant):
1. Surveys list (profile icon, title, area, findings by severity chips, coverage bar, last visit).
2. New survey (profile cards, area, upload / add clips).
3. Survey page (plan sections with coverage, findings grouped by section + filters, evidence still + play at the second, Dismiss / Resolve / Edit severity / Unmerge).
4. Report (summary, work orders by priority, changes since last visit, Download PDF/CSV).

**Stop for approval.**

### 21.5 Build the approved screens (Sat 31 Oct – Sun 1 Nov)
Mac first, then the PWA compact. Services → hooks → components; `dev:mock` fixtures; Vitest.

### 21.6 Revisit + PDF (Sun 1 Nov)
- Revisit: a linked survey with the same plan sections.
- After analysis, a pure match (same category + same section + PE ≥ 0.85) plus a Spark check on the two evidence stills marks findings resolved or still open.
- "Changes since last visit" in the report.
- PDF per F5.

### 21.7 Field tests + close (Mon 2 Nov)
- The owner's field tests (brief §8, without the GPS checks), with numbers: found/real, false alarms, $/min, upload → report time.
- README "Field Survey" section (what it does, Meta model per step, privacy).
- Deploy and install **only on owner word**.

### Cut order
revisit → PDF (keep CSV + on-screen report) → profiles beyond the 3 MVP → coverage.
If coverage is cut, place = area note.

**Never cut:** SAM detection with blurred evidence, Spark findings with severity, merge, the work-order report, CSV.

### Schedule at a glance

| Day | Deliver |
| --- | --- |
| Thu 29 | 21.0 spikes · 21.1 foundations |
| Fri 30 | 21.2 analysis job · 21.4 mocks posted · 21.3 starts |
| Sat 31 | 21.3 agent layer + API · mock approval · 21.5 starts |
| Sun 1 | 21.5 screens · 21.6 revisit + PDF |
| Mon 2 | 21.7 field tests, fixes, README, numbers |

## 7. Parked
- **GPS**: reading location from phone footage (the ISO 6709 tags), distance-based merge and a map. Notes kept for later:
  - the upload path may strip location (iPhone Photos → browser);
  - Android uses the `location` tag (not `com.android.capture.fps`);
  - glasses have no GPS.

## 8. Verification
- **Gates:** api/web/render, with the output shown; ran vs traced lists.
- **Wire tests:** every new request body (SAM concepts and privacy, Spark findings/plan/coverage/report/revisit, renderer EvidenceStill).
- **Mutation checks:** merge rule, dedupe rule, severity → SLA, revisit match.
- **Definition of done:** the brief's §10, without GPS, checked by the owner on the local stack, then on the installed build.
