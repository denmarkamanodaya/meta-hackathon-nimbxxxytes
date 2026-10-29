# Phase 22: nimbytes Access, plan draft (review copy, no code)

Status: **draft 2026-10-28, waiting for owner review.**

Owner direction 2026-10-28:
- Solve a real public-good problem; it is the priority over a shorts tool.
- Combine tools where Meta has no capability (for example speech output).
- Meta models stay the brain for every understanding step.

## 1. The problem
- Most video is unusable for blind, low-vision, deaf, hard-of-hearing and cognitively disabled people.
- WCAG 2.1 AA (the standard governments, councils and schools must meet) requires captions (1.2.2) and audio description (1.2.5) for prerecorded video.
- Making them by hand costs hours per video, so almost nobody does it.

**nimbytes Access turns any video into a complete accessibility pack, automatically, with Meta AI understanding every second.**

## 2. The pack

| Output | For | How (Meta model doing the work) |
| --- | --- | --- |
| **Voiced audio description, in the pauses** | Blind / low-vision | The **Voice Transcribe** turns give the silences. **Spark** writes a description sized to each gap (words ≈ gap × 2.5/s) from the segment video. **SAM** names what is in focus. A TTS voice reads it, mixed into the video with the original audio ducked. Also a WebVTT `descriptions` track |
| **Full captions (SDH)** | Deaf / hard of hearing | **Voice Transcribe** words + speaker labels (named via Faces/Speech). **Spark** adds sound cues (`[applause]`, `[dog barks]`). WebVTT + SRT, and a burned-in large high-contrast version |
| **Magnified view** | Low vision | **SAM** follows the active speaker or main subject (the Track B crop path); large high-contrast captions |
| **Easy Read version** | Intellectual disability, low literacy, new English speakers | **Spark** retells the video in short one-idea sentences. **Muse Image** draws one picture per sentence anchored on the real frame / **SAM** cut-out (the real people, kept consistent). Output: an Easy Read page (print/PDF) + a narrated picture video |
| **Alt text** | Screen-reader users | **Spark** alt text for every exported still, cover and short (one line + one long description) |

Third-party tools (labelled in the README):
- a TTS voice (see D1);
- ffmpeg for mixing;
- the existing Remotion renderer.

## 3. Why this wins
- **A real problem with legal weight**, not "an image analyzer". It is an agent:
  1. listens for the silences;
  2. watches and writes for each audience;
  3. fits every description to its gap (it rewrites when too long);
  4. checks the result against the timing rules;
  5. packages standards-compliant formats.
- **Every Meta model does its strongest job:** Spark sees and writes, Voice Transcribe hears and times, SAM tracks focus, Muse Image draws, Perception Encoder keeps the pack searchable.
- **No footage problem:** it works on any video, including the existing library (birthday, walks, dog).
- **Mostly reuse:** segment descriptions, speaker turns, crop paths, Muse Image, the renderer, ffmpeg and exports already exist.

## 4. Gaps and risks

| # | Risk | Resolution |
| --- | --- | --- |
| R1 | **No Meta TTS** | Owner allows another tool. Spike A3: **Piper** (open-source, runs offline on CPU, arm64 build, no per-use cost; needs a voice model + its licence checked) vs a cloud TTS (paid per character). Recommend Piper inside the api/renderer container |
| R2 | Gaps too short for a description | Pure rule: gap ≥ 1.5 s qualifies. Spark gets a hard word budget per gap and rewrites once if over. Optional "extended description": pause the video for the important ones (WCAG AAA 1.2.7), off by default |
| R3 | Does Spark hear audio (for sound cues)? | Spike A2. If not, sound cues come from Spark on the video frames ("people clapping" → `[applause]`) plus Transcribe non-speech markers. Mark the gap honestly |
| R4 | Easy Read pictures must stay consistent (same person every picture) | Anchor each Muse Image call on the real frame + the SAM cut-out of the main person. Spike A4 checks consistency over 6 pictures |
| R5 | Accessibility claims must be true | Validators (pure, tested): caption line length and reading speed (≤ 20 chars/s), description fits its gap, contrast ratio of burned captions ≥ 7:1. The owner checks with VoiceOver on the Mac |
| R6 | Hard rule 8 says Meta models only for AI | **Needs the owner's ruling**: "Meta models for every understanding and writing step; non-Meta tools only where Meta has no capability (speech output), labelled as third-party" |
| R7 | Time: Field Survey was planned for the same days | One public-good mode only (see D2) |

## 5. Owner decisions (recommendation first)

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | TTS tool | **Decided (owner 2026-10-28): Piper.** Spike A3 confirms the arm64 build, speed and voice licence |
| D2 | Field Survey vs Access | **Access replaces Field Survey** as the public-good mode (no footage to source, stronger problem). Field Survey stays parked with its plan doc |
| D3 | Hard rule 8 wording | Amend as in R6 |
| D4 | Scope order | Audio description + captions first (the legal core), then magnified view, Easy Read, alt text |
| D5 | Where | Mac and PWA: an **Accessibility pack** panel on any clip and short; a pack page with previews and downloads |

## 6. Phased plan

| Phase | Day | Deliver |
| --- | --- | --- |
| 22.0 Spikes (≤ $0.50) | Thu 29 AM | **A1** description in gaps: Spark with word budgets on 3 segments, fit rate. **A2** Spark sound cues: does it hear audio? **A3** Piper on arm64 in Docker: quality, speed, voice licence. **A4** Muse Image Easy Read consistency, 6 pictures. **A5** WebVTT `descriptions` + captions in the Mac WKWebView player and VoiceOver |
| 22.1 Foundations | Thu 29 | Migration (`access_packs`, `access_items`: kind, status, keys), contracts + TS mirror, keys, the TTS adapter port (`Narrator`) |
| 22.2 Audio description | Fri 30 | Gap finder (pure), Spark describer with budgets + rewrite, WebVTT descriptions writer (pure), Narrator per cue, ffmpeg mix with ducking → described MP4. Background run + SSE (the Studio pattern) |
| 22.3 Captions | Fri 30 | Speaker-named cues, Spark sound cues, WebVTT/SRT writers, reading-speed validator, burned-in high-contrast render |
| 22.4 Mocks → approval | Fri 30 | The Access panel, the pack page (previews, toggles, downloads), the Easy Read page. **Stop for approval** |
| 22.5 Magnified view + alt text | Sat 31 | Crop path on the active speaker (reuse B2), large captions; alt text on exports |
| 22.6 Easy Read | Sat 31 – Sun 1 | Spark plain-language steps, Muse Image pictures anchored on frames/cut-outs, Easy Read page (print/PDF) + narrated picture video |
| 22.7 Build approved UI | Sun 1 | Mac + PWA |
| 22.8 Check + close | Mon 2 | Owner VoiceOver check, timing/contrast validators green, README "nimbytes Access" (models per step, third-party tools) |

Cut order: Easy Read video (keep the page) → magnified view → alt text.
**Never cut:** voiced audio description in the pauses, captions with speakers.

## 7. Verification
- Gates green, with ran vs traced lists.
- Wire tests on every Spark/Transcribe/TTS call.
- Mutation checks: gap rule, word budget, reading speed, contrast.
- The owner watches 2 library videos with VoiceOver and the described audio, and judges whether a blind viewer would follow them.
