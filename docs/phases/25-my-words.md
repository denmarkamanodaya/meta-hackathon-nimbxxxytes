# Phase 25: My Words. Brief + implementation plan (review copy, no code)

Status: **draft 2026-10-29, waiting for owner review.** Mocks V29–V32 are on the redesign-v2 canvas
(https://claude.ai/artifact/W3EF8HVDXBKnwAjcr96Vu3), section "Phase 25 · My Words".
- Base: v2.0.4 (`c52b4ca`), which is local `main`, GitHub and the live server.
- Phase 24 (Bystander Shield) brief is also waiting for review; see decision D1 for how the two fit.

Deadlines: demoable **Mon 2 Nov** · demo video Tue 3 Nov · submission Thu 5 Nov 10:00 Perth.

---

## Part A: One-page brief

### The problem (one sentence)
People who understand everything but can't speak (after a stroke, with aphasia, autism, MND,
cerebral palsy, some dementia) are given generic cartoon symbol boards that don't show *their*
life, so they don't use them, and their families are left guessing.

### The user
- **The person who can't speak**, for example Lola Rosa, 74, three months after a stroke. She
  understands everything and can say only "yes", "no" and "ah".
- **The carer**, for example her daughter Ana, who wears the glasses and builds the board.

### The promise
**"A talk board made from your own life. Tap, point or look at your own things, and nimbytes says
it for you."**

### What the user sees: the outcome
- Rosa taps her **blue mug** (or points the phone at the real mug, or looks at the tile with iPad
  Eye Tracking).
- nimbytes offers 2–3 sentences: *"Can I have a cup of tea, please?"*, *"Can I have some
  water?"*, *"My mug is empty."*
- She picks one and the iPad **speaks it aloud**. Ana makes the tea.
- nimbytes does not make tea. It speaks for her.

### Three ways to talk, one board

| Rosa's ability | Way to talk | Where the Meta AI is |
| --- | --- | --- |
| Can use one hand | **Tap** the board | Board built from her footage (SAM 3.1, PE, Muse Spark) |
| Can hold or aim a phone | **Point to Talk** (phone camera) | Live match to *her* things (SAM 3.1 + PE), sentences (Muse Spark) |
| Can't move her hands | **Look and hold** (Apple's built-in Eye Tracking) | The same board; we only make it gaze-friendly |

We do **not** build eye tracking. iOS / iPadOS Eye Tracking (Settings › Accessibility › Physical
and Motor) moves the pointer and Dwell taps. Our job is the layout rules in B2 (D6).

The glasses camera is **not** live (the Wearables toolkit is not approved). Glasses footage
reaches nimbytes the normal way (upload) and only feeds the board. Point to Talk uses the
**phone** camera.

### Why it's hard: the intelligence
1. **What matters in Rosa's world?** From weeks of footage, find the things, people and places
   that keep coming back (her mug 40 times, the garden chair every afternoon) and leave out the
   one-off clutter.
2. **Is it the same mug?** Perception Encoder matches the same object across clips and lighting,
   so one tile stands for "her blue mug", not "a cup".
3. **What does she mean?** One tile can mean several things. Muse Spark suggests sentences from
   the tiles, the time of day and her own routine seen in the footage (tea in the morning).
4. **Point to Talk:** SAM 3.1 finds objects in a phone photo using the board's own words as
   prompts ("mug, remote, banana"); PE picks *her* instance.
5. **It grows:** new footage adds tile suggestions ("a new baby appears in 6 clips. Add Mia?").

### Meta AI doing the work

| Model | Job |
| --- | --- |
| **SAM 3.1** | Cut out each object and person for a clean tile photo; find objects in a Point to Talk photo, prompted with the board's own labels |
| **Perception Encoder** | Group the same object across clips; match a photo to *her* tile |
| **Muse Spark** | Pick and label tiles (name, group, where and when she uses it); suggest the 2–3 sentences |
| **Voice Transcribe** | Words the family actually uses at home ("Lola", "merienda") become tile labels (stretch) |
| **MMS-TTS** (Meta, open model) | Speak the sentence in English or Tagalog, if spike S4 passes; otherwise device speech (D5) |

### The demo, filmable solo
1. **Before (15 s):** a generic cartoon symbol board next to your real kitchen.
2. **Build (30 s):** your existing clips, then "38 things found in Rosa's world". Approve, rename
   one, remove one.
3. **Tap (30 s):** a family member taps **[blue mug]** and picks *"Can I have a cup of tea,
   please?"*; the iPad speaks. Then **[Leo]**: *"I want to call Leo."*
4. **Point (15 s):** point the phone at the real mug, and the tile pops up and speaks.
5. **Look (15 s):** iPad on a stand with Eye Tracking on; look and hold on the mug tile; it speaks.
6. **Show me (10 s):** the ▶ on the church tile plays last Sunday's clip.
7. **Close (5 s):** "Built from a life, not a catalogue."

### Out of scope (MVP)
- Building our own eye or head tracking.
- Live glasses camera (toolkit not approved).
- Finger-pointing at objects across a room.
- Making things happen (smart home, ordering): it speaks, the carer acts.
- Therapy, diagnosis or any medical claim.

### Safety rules (never cut)
- **Fixed row** on every screen, same place, never changed by AI: Yes · No · Pain · Toilet ·
  Help · Tired.
- **Nothing is spoken without the person's own tap or dwell.** Spark only suggests.
- **Tapping always works.** Camera and gaze are extra ways, never the only way.
- **Only approved people become tiles:** people the carer named in Faces. Bystanders never do.
- **Point to Talk photos are not kept:** deleted after the match unless the carer turns saving on.
- Wording: "a communication helper". Never "therapy", "medical device" or "treatment".

### Success test (the owner judges)
1. A judge understands it in 5 seconds from the board and one spoken sentence.
2. From the owner's own footage, the board has at least 15 useful tiles after at most 5 minutes
   of carer review.
3. Tap mug, pick a sentence: the speech starts within 2 s.
4. Point the phone at the real mug: the right tile, 8 times out of 10, within 2.5 s.
5. iPad Eye Tracking on the gaze layout selects 8 of 10 tiles without a miss-tap.

---

## Part B: Implementation plan

### B1. What we reuse (on v2.0.4)

| Need | Existing piece |
| --- | --- |
| Objects per moment | Spark segment facts (objects, place, activity) from ingest |
| People | Faces: tracks, named people, hidden list, opt-in PE matching |
| Clean tile photos | SAM 3.1 mask decode in the renderer (Cut out, V22) |
| Same object across clips | Find this (V18): SAM track + PE search across clips |
| Show me clip | Search + player + snippets |
| Tagalog text | Spark already writes Tagalog (Phase 23 spike) |
| Background job + progress | The jobs worker + step SSE |

Bring back from `parked/phase23` (cherry-pick):
- `d4672c0`: SAM `store:false`, which avoids 413s on large clips (Cut out needs it).
- `6ac8310`: the `WORKERS` env setting.

### B2. Design decisions (recommendation first; owner to confirm)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | My Words vs Bystander Shield | **My Words is the headline.** One week fits one feature done well (Phase 23 lesson). Bystander Shield stays parked; its consent idea lives on as "only named, approved people become tiles" |
| D2 | Device | **PWA on iPad (board) and iPhone (Point to Talk), light theme.** The carer's Build screen is in the same PWA. The Mac app gets a link only. Reason: Rosa uses an iPad on a stand; one device story |
| D3 | Talk mode lock | Talk mode is full screen with no app navigation. Leaving it needs a 2-second hold on "Carer". Recommend iPadOS Guided Access in the demo |
| D4 | Sentences | Spark returns 3 suggestions per tile combination, using time of day and the routine facts. Cached per (combination, time band), so a repeat tap is instant and free |
| D5 | Speech | **Spike MMS-TTS** (Meta, `facebook/mms-tts-eng` + `mms-tts-tgl`, ONNX on the box, audio cached per sentence). If too slow or poor, the browser's Web Speech API (`speechSynthesis`, English; Tagalog only if the device has a voice). License note: MMS-TTS weights are CC-BY-NC 4.0 (fine for the hackathon, not for sale) |
| D6 | Gaze layout | Gaze board = **4×2 tiles per tab, at least 220 pt, 24 pt gaps**, fixed row on the top edge, tabs as big buttons, no scrolling, no long-press, no drag. Tap board = 5×2. A switch in carer Settings: "Bigger tiles for Eye Tracking" |
| D7 | Show me | A separate ▶ button on each tile (one dwell = one action), opening the clip moment full screen |
| D8 | Point to Talk prompts | SAM 3.1 prompted with the **board's own labels** (we know the vocabulary), then PE picks the instance. Fallback if SAM is slow: PE on the centre crop only (one object per photo) |
| D9 | Language | Board labels and sentences in English or Tagalog, chosen per board |

### B3. Spikes (Thu 29 PM – Fri 30 AM, ≤ 3 h, ≤ $1; results in `docs/meta-api.md`)

| Spike | Question | Done when |
| --- | --- | --- |
| S1 Discovery | From the 5 library clips: Spark facts → top recurring objects → SAM crop on the best frame → PE cluster. Are at least 15 of the top 25 useful tiles? | List + crops saved; useful count noted |
| S2 Point to Talk | 10 phone photos (mug, remote, rice cooker…) vs the S1 tiles: SAM with label prompts + PE, and PE centre crop alone | Accuracy and time on the t4g.large for both |
| S3 Sentences | Spark on 10 tile combinations × 3 time bands: natural, short, polite, no invented facts? | Prompt + schema saved; 3 good of 3 in ≥ 8 combos |
| S4 Speech | MMS-TTS English + Tagalog on the box CPU: time for a 10-word sentence and quality | Time noted; owner listens to 2 samples |
| S5 Eye Tracking (owner, 30 min) | iPad Eye Tracking on the static V32 layout: 10 selections in a row | Misses counted; tile size confirmed or raised |

### B4. Phases

| Phase | Day | Deliver |
| --- | --- | --- |
| **25.0** Brief + mocks approval + spikes | Thu 29 – Fri 30 AM | Owner reviews this doc and V29–V32. S1–S5. Owner films 3–5 min of their own kitchen, living room and family |
| **25.1** Foundations | Fri 30 | Cherry-pick `d4672c0` + `6ac8310`. Migration: `boards` (owner, person name, language, gaze layout on/off), `board_tiles` (board, kind person / thing / place / word, label, group, position, status suggested / kept / removed, source clip + time, cut-out key, PE vector, seen count, where and when), `fixed_words` seeded. Keys for cut-outs and cached audio. Contracts + TS mirror |
| **25.2** Discovery job | Fri 30 – Sat 31 | `words_discover` job: candidates from segment facts + named people → best frame per candidate → SAM cut-out → PE embed → cluster across clips → rank (count, places, times) → Spark label, group and "where and when" → tiles as `suggested`. Re-runs on new uploads and adds suggestions. Pure rules unit-tested: ranking, clustering threshold, dedupe |
| **25.3** Talk endpoints | Sat 31 | `POST /api/words/suggest` (tile ids, time band → 3 sentences, cached); `POST /api/words/recognise` (photo → up to 3 tile matches with scores; photo deleted after); `GET /api/words/speech` (sentence → cached audio, if D5 = MMS-TTS). Handler tests incl. `FORBIDDEN` on another user's board; wire tests on every SAM, PE and Spark body |
| **25.4** Build the approved UI | Sat 31 – Sun 1 | PWA: Build (V29), Board (V30) with the gaze switch (V32), Point to Talk (V31), Show me. Services → hooks → components; `dev:mock` fixtures. Mac: a "My Words" link only |
| **25.5** Owner test | Sun 1 | On the owner's footage: build the board, tap, point, look. Success test in Part A |
| **25.6** Close | Mon 2 | README "My Words" section (what it does, the Meta model per step, the safety rules, limits); demo script; deploy **only on owner word** |

**Cut order:** Voice Transcribe labels → Show me → Tagalog speech (keep Tagalog text) → MMS-TTS
(keep device speech) → SAM in Point to Talk (keep PE centre crop).
**Never cut:** the fixed row, confirm before speaking, tapping always works, only approved people
as tiles, the board built from footage.

### B5. Cost and speed targets
- Discovery per board (about 60 candidates): SAM cut-outs ~$0.15, Spark labels ~$0.06, PE local
  $0. **About $0.20 per board**, once, plus new suggestions as clips arrive.
- Sentences: about $0.001 per new combination; repeats are cached and free.
- Point to Talk: one SAM call ~$0.0025, PE local. Target **≤ 2.5 s** photo to tile on the
  t4g.large.
- Speech: cached audio, so a repeated sentence costs nothing.

### B6. Risks

| Risk | Mitigation |
| --- | --- |
| Discovery finds junk tiles (a random chair, a passing car) | Rank by recurrence across days; carer review is required before a tile shows on the board |
| Point to Talk picks the wrong thing | Confirm step with the tile's own photo; "Not this" offers the next 2 matches and "Save for Ana" |
| Speed on a 2 vCPU box | PE runs locally (fast); SAM is one call; fallback to PE centre crop (D8) |
| No Tagalog voice | MMS-TTS spike S4; else English speech + Tagalog text on screen |
| Eye Tracking needs a recent iPad and a stand | Say so in the pitch; Head Tracking and tapping stay as backups |
| Wording drifts into health claims | "Communication helper" only; review README and UI copy |
| Time | Spikes first; teammates in parallel (api, web); the cut order above |

### B7. Verification
- Gates green (api, web, render), with ran vs traced lists.
- Wire tests on every SAM, PE and Spark request body.
- Mutation checks:
  - the fixed row cannot be removed or reordered by discovery (removing the guard must fail a
    test);
  - suggest never triggers speech on its own (speech only from a confirm call);
  - a person tile needs a named, approved face (an unnamed track must be rejected);
  - a recognise photo is deleted after the match when saving is off.
- The owner's success test (Part A) on the owner's footage and devices; then the installed build
  after a deploy.

---

## Part C: Prototype build (approved 2026-10-29, "prototype this build quick and fast")

Owner approved the brief, mocks V29–V32 and the recommended decisions D1–D9. Prototype order:
get every function testable first, then polish. Speech uses the browser's `speechSynthesis` for
the prototype (MMS-TTS is spike S4, later). Point to Talk uses PE only (D8 fallback) first; SAM
label prompts are a later step. "Save for Ana" is UI only for now.

Base: `main` at `c9de127` (v2.0.4 + cherry-picks `d4672c0` → 144d3db, `6ac8310` → c9de127).
Teammates: `api-words` (branch `feat/words-api`, worktree `.worktrees/words-api`) and `web-words`
(branch `feat/words-web`, worktree `.worktrees/words-web`). The lead merges.

### C1. Wire contract (snake_case JSON, like every other route)

| Route | Body | Answer |
| --- | --- | --- |
| `GET /api/words/board` | – | `BoardResponse` (creates the board with defaults on first call: person name "", language `en`, gaze false, keep_photos false, the 6 word tiles) |
| `PUT /api/words/board` | `BoardUpdate` (every field optional) | `BoardResponse` |
| `POST /api/words/discover` | – | `202 {"status":"running"}`; queues job kind `words_discover`. Idempotent: if one is already queued or running, the same 202 and no second job |
| `PATCH /api/words/tiles/{id}` | `{ "label"?: string (1–24 chars), "status"?: "kept" \| "removed" }` | `Tile`; `FORBIDDEN` for another user's tile, `NOT_FOUND` for none |
| `POST /api/words/suggest` | `{ "tile_ids": [string] (1–3, the user's kept tiles), "time_band": "morning" \| "afternoon" \| "evening" \| "night" }` | `{ "sentences": [string, string, string], "cached": bool }` |
| `POST /api/words/recognise` | raw `image/jpeg` body, ≤ 4 MB | `{ "matches": [RecogniseMatch] (0–3, best first), "confident": bool, "took_ms": u64 }` |

```text
BoardResponse {
  board: { person_name: string, language: "en" | "tl", gaze: bool, keep_photos: bool,
           discover_status: "idle" | "running" | "ready" | "failed", clips_used: u32,
           updated_at: string (ISO-8601) },
  fixed: [FixedWord],            // always 6, fixed order: yes, no, pain, toilet, help, tired
  tiles: [Tile]                  // every tile incl. removed, ordered by group then position
}
FixedWord { id: string, label: string, sentence: string }   // e.g. pain / "Pain" / "I’m in pain."
Tile {
  id: string, kind: "person" | "thing" | "place" | "word",
  group: "people" | "food" | "places" | "things" | "words",
  label: string, status: "kept" | "removed", position: u32,
  image_url: string | null,      // signed URL of the crop JPEG; null for word tiles
  seen_count: u32, where_when: string,   // "Seen 40 times · kitchen, mornings" parts: where_when = "kitchen, mornings"
  clip: { clip_id: string, start_s: f64, end_s: f64, title: string } | null   // Show me
}
BoardUpdate { person_name?: string (≤ 40), language?: "en" | "tl", gaze?: bool, keep_photos?: bool }
RecogniseMatch { tile_id: string, label: string, score: f64 (0–1) }
```

Rules the server owns (the web never decides them):
- The fixed words and the 6 word tiles (hot, cold, more, stop, call, later) are constants in the
  core domain. Discovery never removes, renames or reorders the fixed words.
- Discovery adds tiles as `kept` (the carer removes); a re-run keeps each existing tile's status
  and label (matched by its source label) and only adds new ones.
- A person tile only comes from a **named** person with a visible (not hidden) face track.
- `confident` = the best match's score ≥ the core constant `MATCH_MIN` (start 0.55; tuned on the
  owner's photos). Removed tiles are never matched.
- The recognise photo is never stored (prototype: `keep_photos` is saved but unused).

### C2. Discovery job (`words_discover`)
1. Things: `segments.objects` of the user's ready, non-duplicate clips; names cleaned with the
   existing `clean_label`; count segments and distinct clips; top 30 seen in ≥ 2 segments.
2. Places: `segments.place`, top 8 the same way.
3. People: named people with a visible face track; image = the largest face crop; clip = that track.
4. One Spark call (`api/prompts/words_board.md` + schema): candidates with counts, places, times of
   day, 2 sample descriptions → per candidate `{source, label (1–3 words, board language), group
   (food | things | places), useful (bool), where_when (≤ 4 words)}`. Drop `useful = false`.
5. Things and food: best segment (highest quality containing it) → frame at its middle from the
   720p proxy → SAM 3.1 text prompt = the source label on that image → largest box → crop with a
   margin → JPEG at `users/{u}/words/{tile_id}.jpg` (key builder in `keys.rs`) → PE `embed_image`
   → `word_tile_vectors`. SAM finds nothing: use the segment thumbnail, embed it too.
6. Places: the best segment's thumbnail as image (also embedded).

### C3. Suggest
One Spark call (`api/prompts/words_suggest.md` + schema `{sentences: [3 strings]}`): the tiles
(label, kind, where_when), time band, language, person name. Prompt rules: first person, ≤ 12 words,
polite, everyday, no invented facts, no medical or safety advice, three different meanings.
MetaClient caches by input, so a repeat is free; `cached` reports it.

### C4. Web (PWA, light Mist tokens, mobile-first, tap targets ≥ 44 px)
- `/words`: Build (V29). Discover button + status, group tabs, Keep / Remove, Rename, board
  settings (gaze, keep photos, language, person name), "Open board", "Point to Talk".
- `/words/talk`: Board (V30), full screen without the app tab bar. Fixed row, sentence bar with
  chips + 3 suggestions, tapping a suggestion or a fixed word speaks it, Say again, Clear, group
  tabs, 5×2 tiles (4×2 big tiles when `gaze`, V32), ▶ Show me opens the clip moment in the existing
  player. "Carer" needs a 2 s press to leave.
- `/words/point`: Point to Talk (V31). Live camera (`getUserMedia`, rear camera) with a big Tap to
  look area; frame → JPEG → recognise; confident → "Looks like" + 3 suggestions; not confident or
  Not this → "isn't on the board yet" + Save for Ana (UI only) / Try again. File input with
  `capture="environment"` as fallback when getUserMedia fails.
- Speech only through one service module wrapping `speechSynthesis` (language from the board).
- Time band from the device clock in one pure function (tested).
- `npm run dev:mock` gets fixtures for every words route so the UI runs without the server.
