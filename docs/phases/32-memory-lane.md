# Phase 32: Memory Lane (a guided memory session from the family's own footage) — plan

Status: **draft for owner review. No code until approved.** Deadline: event ends 2026-11-04.

## The problem, the user, the one outcome

- **User:** an older person whose memory is fading (early dementia, or just ageing), sitting with a
  family member or carer.
- **Problem:** memory care is still done by hand. Reminiscence therapy uses photos, videos and
  life-story books that families gather and sort themselves (Cochrane review 2018; our slide 5).
  The footage exists, scattered across phones and drives, and nobody has time to turn it into a
  session.
- **One visible outcome:** pick a person ("Kristoff") or a moment ("Mum's 60th birthday"), press
  start, and nimbytes plays a calm, spoken memory session made from the family's own videos and
  photos: each moment shown big, a warm line read aloud ("This is Kristoff, your son, at your 60th
  birthday. He gave a speech thanking you for 34 years of sacrifices."), and a gentle prompt ("Do
  you remember what song was playing?"). No typing, large text, one big button.

Why it wins on the rubric: Impact (a specific user and a named problem, the one our video opens
with); Meta tooling (Muse Spark writes the session, SAM 3.1 faces pick the moments, Perception
Encoder finds the photos, Voice Transcribe supplies what was said, Muse Image draws the session
cover, and a second Muse Spark pass checks every line: an autonomous, self-checking agent); Demo (one 20-second clip that anyone understands).

What it is not: not diagnosis or treatment; it supports reminiscence, it does not replace care
(same wording as the README).

## What already exists (reuse, don't rebuild)

| Need | Already in the code |
| --- | --- |
| Who appears where, and when | Named people and their face tracks per clip (`/api/people`, `/api/people/overview`, `usecases/people*.rs`), with on-screen time |
| What happens in each moment | Moment descriptions per clip (Muse Spark) |
| What was said | Transcripts with speakers (Voice Transcribe), speech hits by time (`domain/captions.rs`) |
| Photos | Photo facts and vectors (`usecases/photos`), searchable next to moments |
| Search by person / scene / words | `/api/search` (Tantivy + sqlite-vec + Spark rerank) |
| Read aloud | Device voice (`web/src/services/media/device-voice.ts`, `core/speech/voice-choice.ts`), MMS-TTS fallback |
| A jobs-table runner + progress | iRead / iListen pattern (`usecases/documents/run.rs`, `StageList`) |
| Covers | Muse Image (`listen_cover.md` pattern) |
| Playing a moment of a clip | Guide step replay (`GuideStepPage`), player seek |

## Design (mock first: owner approves before any UI code)

One new page, **Memory Lane**, under Accessibility in the sidebar (Mac) and Features (phone):

1. **Start screen:** "Who shall we remember today?" Large face tiles of named people, plus "A day"
   (pick an event/segment). One tap.
2. **Session:** full-screen, one moment at a time: the photo, or the clip playing just that moment
   (muted or with its own sound), a large caption with the line, read aloud in the device voice.
   Under it, the prompt in softer text. Two huge buttons: **Next** and **Again**. A small "Who is
   this?" reveal shows the name only when tapped, so the person can try to remember first.
3. **End:** "That was Kristoff." The session cover (Muse Image) and **Save as a memory book**
   (keeps the session to replay; optional, phase 32.4).

Mock goes on the design canvas (https://claude.ai/artifact/ChDqcftUKSR5yvrYBKQAS7, local copy
`docs/design/mist/`) in the white/teal look of the demo, with real frames from the library.

## How it works

`POST /api/memory-sessions { person_id | segment_id }` → a job (jobs table, iRead pattern):

1. **Gather (no AI cost):** the person's face tracks (clip, start, end), the moment descriptions
   that overlap them, speech lines in those spans, photos whose facts or vectors match the person,
   and recording dates. Rank by on-screen time and variety (different days, places); keep 6–8.
2. **Write (Muse Spark, one call):** prompt `memory_session.md` + strict schema: for each moment a
   caption line (who, where, when, what happened, ≤ 30 words, warm, second person, only facts
   from the inputs), one gentle prompt question, and the session title. Never invents names or
   events; unknown → leave it out. Cached by `MetaClient` like every call.
3. **Check (Muse Spark, agent review):** a second pass compares every line with its inputs (the
   moment description, the speech, the face track, the date) and marks each claim supported or
   not; unsupported lines are rewritten once with the reason, then dropped if still unsupported
   (the iListen check-and-fix loop). The session shows "Checked by the agent".
4. **Cover (Muse Image, optional):** one cover from the first frames.

The run is shown as an agent with visible stages in the shared `StageList`: **Find the moments
(SAM 3.1 faces, Perception Encoder photos) → Write the session (Muse Spark) → Check every line
(Muse Spark) → Paint the cover (Muse Image)**, so judges see an autonomous, self-checking agent,
not a single prompt.
4. Result: `MemorySession { title, cover_url, moments: [{ kind: clip|photo, clip_id, start_s,
   end_s | photo_id, line, prompt, who }] }`. The web plays it; read-aloud is on the device.

## Phases (each with its tests in the same commit; gates green before handoff)

| Phase | What | Done when | Time |
| --- | --- | --- | --- |
| **32.0 Spike (on real data)** | Script that gathers Kristoff's moments from the live library and calls Muse Spark with the draft prompt; read the output aloud on the Mac and iPhone | 6–8 sensible moments, every line true to the footage, sounds warm read aloud; owner says "yes, that's it" | 3–4 h |
| **32.1 Mock** | Canvas mock of the three screens with real frames | Owner approves | 2–3 h |
| **32.2 API** | Domain `MemorySession` + gather use case (pure ranking, unit-tested) + Spark adapter + prompt/schema + job runner + endpoints; fakes in testkit; handler tests (403 on another user's person) | `cargo test` green; request shape asserted | ~1 day |
| **32.3 Web** | Memory Lane page exactly as approved: start, session player (photo / clip moment / caption / read aloud / Next / Again / reveal), end; hook + service; Vitest | `npm test` + build green; works on Mac app and iPhone PWA | ~1 day |
| **32.4 Save as memory book (stretch)** | Keep a session and replay it from the list | Only if 32.2–32.3 land by day 3 | 3–4 h |
| **32.5 Ship + story** | Deploy; DMG; 20 s demo clip into the video (new part after iRead); README: one-sentence direction ("helping people with fading memory or eyesight stay independent, with their family's own footage") and Memory Lane in What it does | Live on the judging server; video re-uploaded; PR merged with CI green | ~0.5 day |

## Day plan (owner time zone, AWST)

| Day | Morning | Afternoon / night |
| --- | --- | --- |
| Fri 31 Oct | 32.0 spike | 32.1 mock → owner review |
| Sat 1 Nov | 32.2 API | 32.2 API, tests |
| Sun 2 Nov | 32.3 web | 32.3 web on Mac + iPhone; owner tests |
| Mon 3 Nov | Fixes; 32.4 if time | 32.5 deploy, demo clip, README |
| Tue 4 Nov | Buffer, final checks, submit | |

## Risks and answers

| Risk | Answer |
| --- | --- |
| Too few named people / faces in the demo library | Kristoff has 10 moments + photos; name 2–3 more people during 32.0 |
| Spark invents facts | Strict schema, facts-only prompt, every line checked against its inputs in the spike; unknown → omit |
| Read-aloud voice differs by device | Device voice as in iRead (UK female if present); MMS fallback |
| Scope creep | 32.4 is a stretch; anything else waits until after the event |
| Owner exhaustion | Plan leaves Tue as buffer; demo clip can reuse the existing video pipeline in an hour |

## Agentic workflows: what nimbytes already has, and how to show it

The directory labelled the project "Multimodal Vision & Video (SAM)"; that label comes from its
scanner, not from the rubric, which scores Meta tooling, impact, depth and demo. nimbytes already
runs several autonomous, multi-step agents; they are just not presented as such:

| Agent | Loop |
| --- | --- |
| iGuide | Plans the guide, then stages: find steps → frame each step → SAM 3.1 traces the control → voice |
| Agentic shorts | Plan the edit → render → watch the draft → critique → revise |
| iListen | Transcribe → translate → translate back and score every line → fix what fails, up to 3 versions |
| iRecall | Plans a spoken or typed request into intents (search, short, guide, read) and runs them with visible steps |
| Memory Lane (new) | Find moments → write → check every line → cover |

In 32.5, add an **"Agents"** section to the README (this table) and name the loops in the demo
clip, so the agentic work is visible to judges and to the scanner.

## Open questions for the owner

1. Start from a **person** only, or also from **a day/event** (segment) in v1? (Recommendation:
   person only in v1; event if time.)
2. Prompt questions on screen: always, or a toggle? (Recommendation: always, soft text.)
3. Name for the feature: **Memory Lane** (recommended), "Remember", "iRecall Memories"?
