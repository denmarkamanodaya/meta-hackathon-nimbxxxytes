# Phase 28 fixes: clear speech, iRead looks like iGuide, "iRecall" — plan

## Context
The owner tested iRead on `test/iread` and asked for 3 changes. #2 is the big one.
1. iRead must use iGuide's design pattern: the button sizes etc. are "incredibly not the same".
2. The voice says "words that are non-existent and out of the world pronunciation".
3. The Ask box's "Ask nimbytes" becomes **iRecall** (screenshot: the placeholder "Ask nimbytes: find a moment, make a short, read a letter…").

### Root cause of #2 (verified in code)
- The MMS-TTS vocab (`api/models/mms-tts-eng/vocab.json`) holds only: space `'` `-` `0-6` `_` `a-z` `–`. It has **no 7, 8 or 9**, and no `$ . , : % / @ & #`.
- `tts/tokens.rs:66` silently drops every character outside the vocab, then speaks the rest letter by letter.
- So "You owe $142.60. Pay by 14 November. Call 1300 555 019." reaches the model as "you owe 14260 pay by 14 november call 1300 555 01": digits read as characters, every 7/8/9 gone, the decimals glued on. That is the gibberish.
- Every iRead answer is full of amounts, dates, phone numbers and account numbers, so it hits hardest there. iGuide steps rarely contain numbers.

## Fix #2: speak words, not symbols (api, pure domain rule + tests)
New pure module `api/crates/core/src/domain/speech.rs`, `speakable(text) -> String`. It runs before every `Narrator::speak`, inside the shared voice path that iGuide and iRead both use, so both are fixed. All the output is lower-case letters, spaces, apostrophes and hyphens.

| Input | Spoken as |
|---|---|
| `$142.60`, `$1,860.00`, `$465` | "one hundred and forty-two dollars and sixty cents", "one thousand eight hundred and sixty dollars", "four hundred and sixty-five dollars" |
| plain numbers `38`, `2026` (as a year), `1,222` | "thirty-eight", "twenty twenty-six", "one thousand two hundred and twenty-two" |
| phone and account-like digit runs (≥ 6 digits with spaces, or a leading 0 / 1300 / 1800 / +61) `1300 555 019`, `4471 2093`, `08 9555 0100` | digits one by one, grouped as printed: "one three zero zero, five five five, zero one nine" (the groups become short pauses) |
| dates `14 November 2026`, `14/11/2026`, `30 Nov` | "the fourteenth of November, twenty twenty-six" |
| ordinals `1st`, `3rd`, `14th` | "first", "third", "fourteenth" |
| times `9:30am`, `14:00` | "nine thirty a m", "two p m" |
| `50%`, `&`, `@`, `/`, `#`, `+` | "fifty percent", "and", "at", "slash" (or "or" between words), "number", "plus" |
| units `kL`, `kWh`, `km`, `kg`, `mL`, `L` after a number | "kilolitres", "kilowatt hours", … |
| common abbreviations `St`, `Rd`, `Ave`, `Mr`, `Mrs`, `Ms`, `Dr`, `No.`, `Ref`, `Acct`, `GST`, `BPAY` | "street", "road", …, "B pay" |
| URLs and emails `sunvalewater.example`, `help@x.com` | "sunvale water dot example", "help at x dot com" |
| letters-only codes `ABC123` | spelled with spaces |

- Commas, colons and semicolons split a sentence into clauses. The WAV join (already built) gets a 150 ms pause between clauses, against 250 ms between sentences.
- **Tests:** a table test for every row above, plus the full spike sentences. Mutation-check: drop the 7–9 handling and the tests fail.
- **Second check, speech to text (the mic):**
  - Run `/api/transcribe` on 3 clips made with macOS `say` (an AIFF converted to WebM with ffmpeg), as the box sends them: "summarise this letter for me", "how do I pay this", "make a thirty second short of the sunsets from our Thai trip".
  - If Voice Transcribe mishears them, try its non-diarization mode for short notes (one speaker), then re-test.
  - The owner's words point to the voice (TTS); this check rules out the mic side as well.

## Fix #3: "iRecall"
- `MacAskBox.tsx:102` placeholder becomes "iRecall: find a moment, make a short, read a letter…".
- The aria-label "Ask nimbytes" becomes "iRecall".
- Grep for any other visible "Ask nimbytes" and update the tests.
- No route or identifier changes.

## Fix #1: iRead uses iGuide's patterns (web; detail from the comparison pass)
Mac:
- **Buttons:**
  - Read it to me = `mac-button mac-button--primary mac-guide__button` (32 px), inline with secondary `mac-button`s.
  - The mic = `mac-button mac-button--icon`.
  - Delete `.mac-iread__read`, `.mac-iread__button`, `.mac-letter__read-button` and the 48 px ask-row override.
- **List rows:** share iGuide's `mac-guides__*` row, thumb (96×72 `--guide-thumb-*`) and meta styles. The kind badge = `<MacPill>`; "Reading…" is a pill, not a Spinner.
- **Right column:**
  - Wrapped in `<ClipPanel>`, gap `--space-3-5`.
  - Order: title (h2, h3 18), then the muted meta (xs), then the page preview (`--radius-sm`), then the summary at `__pv-text` size, then the buttons, then "Made {date}".
- **Letter page:** iGuide's `mac-guide__big` type scale (title 26, text 18), `mac-guide__state` while reading (with a stage list Pages → Read → Voice, like `GuideStages`), the `video` skeleton.

Phone:
- **List:**
  - Rows like `GuidesPage` (`--tap-min`, 96×72 thumb, body 14 / xs 12, a `<Chip>` badge, a Reading chip).
  - Snap a letter = `buttonClassName('primary','lg')`; Choose a PDF = `buttonClassName('secondary','lg')`.
  - Gaps `--space-3` / `--space-2`.
- **Letter page:**
  - `<BackHeader>` (title, "from" subtitle, Rename in the actions slot) and the `guide-page__head/__body` layout.
  - Read it to me at the `guide-step__play` size (56 px); Hold to ask at the `guide-step__back` size (64 px).
  - Show the page = ghost `Button`; Delete = the `guide-page__delete` style; muted text sm.
- Keep the answer text at 24 px. It is the one large-print element, and the owner ruled it.

Shared:
- `DocumentPicker` renders a real `<button>` that opens a hidden file input, so the `:disabled` and hover styles apply.
- The empty-state Upload gets the `plus` icon.
- `AskReadCard`'s last done-state button = `mac-button--primary`.
- Clean-up: remove the `--iread-*` tokens and the CSS that is now unused. Keep `--iread-play`, `--iread-wave-*` and `--iread-chip-thumb-*`.

## Who does what
- Teammate `speech-fix` (api, branch `feat/speech` from `test/iread`): `domain/speech.rs` + tests; wire it in before `speak` for iGuide and iRead (one place); clause pauses in the join; the transcribe check with `say` clips (report the transcripts). A cost of ≤ $0.02.
- Teammate `iread-ui` (web, branch `feat/iread-ui` from `test/iread`): fix #1 as above + fix #3.
- Lead: merge both into `test/iread`, run every gate, rebuild the local api, then:
  - speak the bill answer again and play the WAV myself before handing over;
  - relaunch the Mac dev app; the tunnel stays up.

## Verification
- Gates: Rust fmt/clippy/test, web lint/test/build/build:desktop, desktop, render.
- `speakable` table tests + a mutation check; the WAV clause-pause test.
- Live: re-ask "how do I pay this?" on the stored bill; confirm the spoken text (log `speakable` output at debug) reads "one three zero zero, five five five, zero one nine"; play the WAV.
- The owner listens in the Mac dev app and on the phone; checks that iRead and iGuide look the same side by side.
- Commits stay local until the owner says merge or release.
