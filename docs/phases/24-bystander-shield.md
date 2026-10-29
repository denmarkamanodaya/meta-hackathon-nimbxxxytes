# Phase 24: Bystander Shield. Brief + implementation plan (review copy, no code)

Status: **draft 2026-10-29, waiting for owner review.**
- Base: v2.0.4 (`c52b4ca`), which is local `main`, GitHub and the live server.
- Phase 23 is parked on branch `parked/phase23`.

Deadlines: demoable **Mon 2 Nov** · demo video Tue 3 Nov · submission Thu 5 Nov 10:00 Perth.

---

## Part A: One-page brief

### The problem (one sentence)
People wearing smart glasses record everyone around them, and **the people in the footage never agreed**. That is the biggest public objection to Ray-Ban Meta glasses, and today nothing protects the bystander once the footage exists.

### The user
**The glasses wearer** who records their everyday life and wants to be a good neighbour, without spending hours blurring.
- Their friends and family are the second user: they can say "yes, I'm happy to be visible".

### The promise
**"Everyone in your footage who didn't agree is protected automatically, before anyone sees it, including you, by default."**

### What the user sees: the outcome screen
One **Protection report** per clip, and a library-wide total:

> **Birthday party · 5:27**
> 31 people protected (faces blurred) · 4 friends visible with consent · 2 number plates · 1 phone screen · 3 spoken details muted ("my address is…", a phone number, a full name)
> **2 need you:** "Is this person part of your moment, or passing by?" → Ask them / Keep protected
> [Public view ▸] [Original (logged) ▸] [Audit log]

- The player defaults to the **Public view**: protected video and protected audio.
- Opening the original is possible, but every reveal asks for a reason and is logged.

### Why it's hard: the intelligence
1. **Who is a bystander?** It tells the people you're filming *with* (the subjects of the moment) from people passing by, using how long, how large and how central they are, plus Spark's reading of the scene. Bystanders are protected silently; subjects get a consent prompt.
2. **Who agreed?** Perception Encoder matches faces to the people who gave consent, across months of footage, so a friend who agreed once is recognised in every clip.
3. **Across sight and sound.** It finds personal details on screen (house numbers, name badges, letters, phone screens) and in speech (names, addresses, phone numbers said aloud), then hides or mutes exactly those moments.
4. **When unsure, it asks.** Low-confidence cases go to a short review queue, and nothing uncertain is left exposed in the meantime.
5. **It explains itself.** Every protection carries a reason and a confidence score, in the audit log.

**Safety rule:** blur by default. Any person not marked as consented is protected, whatever the judgement says. The intelligence decides **who to ask and how to report**, never whether a stranger is exposed.

### Meta AI doing the work

| Model | Job |
| --- | --- |
| **SAM 3.1** | Track every face, person, number plate and screen, frame by frame; masks for a precise blur |
| **Muse Spark** | Subject vs bystander judgement; personal details in frames (text) and in transcripts; plain-language reasons |
| **Voice Transcribe** | Speech + speakers; the timing of each personal detail spoken |
| **Perception Encoder** | Match faces to consented people across the library (opt-in, like today) |

### The demo, filmable solo
- **The birthday clip already in your library** (5:27, 35 face tracks): mark your 3–4 family members as consented, and everyone else is protected. This shows the main outcome straight away.
- **A new street walk on your phone or glasses** (5 min): strangers, cars (plates), a shop window, a phone in hand, and you saying "my address is 12 …" aloud. This shows bystanders, plates, screens and speech.
- **A consent moment:** send a consent link to a family member, who taps "I'm happy to be visible"; their face un-blurs in every clip. Can be staged with a second device.

### Out of scope (MVP)
- Real-time blurring on the glasses themselves.
- Disguising voices (we mute personal details; we don't anonymise voices).
- Replacing faces with generated ones.
- Location-clue findability (a later mode).
- Any legal guarantee: we say "helps protect", never "GDPR-compliant".

### Success test (the owner judges)
1. A judge understands it in 5 seconds from the Protection report.
2. In the birthday clip, no non-consented face is visible in the Public view; consented family members are.
3. In the street walk, every plate and the phone screen are blurred, and the spoken address is muted.
4. Consenting via the link un-blurs that person everywhere; withdrawing consent protects them again.

---

## Part B: Implementation plan

### B1. What we reuse (on v2.0.4)

| Need | Existing piece |
| --- | --- |
| Face tracks per clip, people, names, hide | Ingest `faces` step (SAM `face` at 1 fps, 1280 px), `face_tracks` (`person_id`, `hidden`), `face_boxes`, People/Faces screens |
| Consent-style matching | Opt-in face matching: PE proposes, Spark confirms (`face_matching.rs`) |
| Plates and screens | Track B1 (shipped): SAM `license plate` / `screen` concepts + box blur, today only in exports |
| Precise outlines | Track B5 (shipped): SAM mask decode in the renderer (cut-outs). Mask-shaped blur (B4) was never built |
| Speech | Voice Transcribe turns with speakers |
| Frame facts | Spark segment facts |
| Background run + progress | The jobs worker + step SSE |

To bring back from `parked/phase23` (cherry-pick):
- `d4672c0`: SAM `store:false`, which avoids the 413s on large clips.
- `6ac8310`: the `WORKERS` env setting.

Lessons from `docs/investigations/2026-10-28-latency.md` that apply here:
- No inline base64 without `store:false`.
- Run calls in parallel, bounded.
- Never wait on one call at a time.

### B2. Design decisions (recommendation first; owner to confirm)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Default view | **Public view everywhere**: player, thumbnails, search results, shorts, exports, share links, the Mac drive. The original only through "Reveal (logged)" |
| D2 | Who is protected | **Everyone not consented** (blur by default). Subject vs bystander only changes the prompts and the report |
| D3 | Consent | The owner marks named people "Consented". A **consent link** lets a person confirm themselves (stretch for Mon). Withdrawing consent re-protects all clips |
| D4 | Spoken details | Mute (soft beep) the exact span. Transcribe gives turn-level times only, so the turn is re-transcribed in 2 s windows to place the phrase. Fallback: mute the whole short turn |
| D5 | Protected copy | A protected proxy is rendered once per clip with ffmpeg (blur boxes interpolated, masks if fast; audio mute spans), not Remotion (faster). Snippets and thumbnails are rebuilt from it |
| D6 | Faces of bystanders in our own index | No face vectors and no crops are kept for non-consented people; only blurred thumbnails. Privacy by design |
| D7 | Scope of clips | New uploads automatically, plus a one-time "Protect my library" run for existing clips |

### B3. Spikes (Thu 29 AM, ≤ 2 h, ≤ $1; results in `docs/meta-api.md`)

| Spike | Question | Done when |
| --- | --- | --- |
| S1 Subject vs bystander | Spark on 10 face tracks from the birthday clip (track stats + 3 crops + scene): does it match the owner's call? | Accuracy noted; prompt + schema saved |
| S2 Spoken details | Spark finds names, addresses and numbers in transcript turns; 2 s re-transcribe places the phrase within the turn | The phrase located within ±0.5 s on a test recording |
| S3 Text in frame | Spark on keyframes finds house numbers, name badges and screens with readable text | Precision/recall on 20 frames |
| S4 Protected proxy speed | ffmpeg blur of the per-frame boxes for a 5-min 720p clip on the box | Encode time and quality; masks vs ellipses |
| S5 SAM at scale | `face`, `person`, `license plate` and `screen` at 1 fps with `store:false`, run in parallel | Latency and cost per minute; no 413s |

### B4. Phases

| Phase | Day | Deliver |
| --- | --- | --- |
| **24.0** Brief approval + spikes | Thu 29 AM | S1–S5. The owner films the 5-min street walk |
| **24.1** Foundations | Thu 29 | Cherry-pick `d4672c0` + `6ac8310`. Migration: `people.consent` (none / consented / withdrawn + at, by, via), `protection_runs` (clip, status, counts), `protections` (clip, kind face / plate / screen / text / speech, track or time span, reason, confidence, decision auto / review / owner), `reveal_log` (who, clip, reason, at). Keys for protected proxies, snippets and thumbs. Contracts + TS mirror |
| **24.2** Protection pipeline | Thu 29 – Fri 30 | New ingest step `protect` after `faces`, plus a `protect` job for existing clips. Steps run in parallel, bounded: SAM `license plate` + `screen` (faces reuse the ingest tracks); Spark subject-vs-bystander per track; Spark text-in-frame on segment keyframes; Spark spoken details on turns, then a 2 s re-transcribe to place them; the decision list (blur unless consented; uncertain items go to review); the report counts. Pure rules unit-tested: decision, span merge, report counts |
| **24.3** Protected copy + read paths | Fri 30 | ffmpeg protected proxy (video blur + audio mute), protected snippets and thumbs. **Every read path** serves the protected media by default (library, player, search, shorts and exports inputs, share, Mac sync). "Reveal original" asks for a reason → `reveal_log` → a short-lived URL. Handler tests prove no route leaks an original without a log row |
| **24.4** Consent | Sat 31 | Faces: Consented / Not consented / Withdrawn. Consent changes re-render the protected copies of the affected clips (background). Consent link page (PWA): shows the person's face crops, "I'm happy to be visible" / "Keep me blurred", signed token, expiry. Stretch if behind |
| **24.5** Mocks → approval | Fri 30 (parallel) | Boards: Protection report (clip), the library "Protected" summary, Review queue, the player Public view / Original toggle with the reveal reason, Faces consent states, the consent link page (phone), Settings › Privacy. **Stop for approval** |
| **24.6** Build the approved UI | Sat 31 – Sun 1 | Mac first, then the PWA. Services → hooks → components; `dev:mock` fixtures |
| **24.7** Library run + test | Sun 1 | "Protect my library" over the existing clips (birthday first). The owner tests against the success test |
| **24.8** Close | Mon 2 | README "Bystander Shield" (what it does, the Meta model per step, the privacy stance, limits); demo script segment; deploy **only on owner word** (resize to t4g.xlarge for processing, with live prices quoted first) |

**Cut order:** consent link (keep owner-marked consent) → text in frame → spoken details placed in 2 s windows (keep whole-turn mute) → masks (keep ellipse blur).
**Never cut:** blur by default for non-consented faces in every view, plates and screens, the Protection report, reveal-with-log.

### B5. Cost and speed targets (per minute of footage)
- SAM plate + screen at 1 fps (faces reused from ingest): ~$0.024.
- Spark judgements and details: ~$0.03–0.05.
- 2 s re-transcribe of flagged turns: < $0.01.
- **Total ≈ $0.06–0.09/min**, on top of ingest.
- Time: protection < 2 min per minute of footage on t4g.xlarge, with the calls running in parallel.

### B6. Risks

| Risk | Mitigation |
| --- | --- |
| SAM misses a tiny face (POV faces can be about 14 px) | Faces stay on the 1280 px copy (the ingest rule). A `person` concept backs it up: a person with no face track gets a head-region blur |
| A read path still serves an original | One media-URL helper chooses protected or original. Handler tests on every route. The original key is only signed in the reveal flow |
| Re-render cost after consent changes | Only the affected clips, background, protected copy swapped atomically |
| Wording | "Helps protect bystanders", never a legal guarantee; no health words |
| Time | Spikes first; teammates in parallel (api, render/ffmpeg, web); the cut order above |

### B7. Verification
- Gates green (api, web, render), with ran vs traced lists.
- Wire tests on every SAM, Spark and Transcribe body.
- Mutation checks:
  - the blur-by-default rule (removing it must fail a test);
  - the reveal log (a reveal without a row must fail);
  - consent withdrawal re-protecting a clip.
- The owner's success test (Part A) on the birthday clip and the street walk; then the installed build after a deploy.
