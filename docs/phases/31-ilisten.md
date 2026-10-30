# Phase 31: iListen (listen to any recording, summary in your language) — plan

## Context
- Owner request (2026-10-30): a new feature next to iGuide and iRead.
  - Drop in any sound file or video. nimbytes keeps only the audio, transcribes it and summarises it.
  - The spoken language is detected automatically, including mixed recordings (Mandarin and Japanese in one file).
  - The summary comes out in an **output language the user picks**. Example: Mandarin audio, English summary.
  - Meta models only.
- What the code has today:
  - **Voice Transcribe** (`muse-voice-transcribe-1.0`, `adapters/meta/transcribe.rs`) returns turns with start, end, text and speaker. It returns **no language code** (confirmed again in spike 31.0).
    - Limits: 10 min and 32 MB per call.
    - Chunking at 570 s already exists (`core/domain/transcript.rs`).
  - **Muse Spark** (`muse-spark-1.3`) runs through `MetaClient`, with a strict JSON schema and cost rows.
  - Audio-only files are rejected in three places:
    - the content-type check (`domain/media.rs`);
    - the extension list;
    - the ffprobe "no video stream" check (`adapters/media/parse.rs`).
  - **Read-aloud:** MMS-TTS speaks English only, and the web voice picker filters to English voices (`web/src/core/speech/voice-choice.ts`).
  - **iRead is the pattern:**
    - a jobs-table runner (`usecases/documents/run.rs`);
    - a raw-body source upload;
    - polling hooks;
    - the shared `StageList` progress.

## Spike 31.0: does it work on Mandarin, Japanese and a mix? (2026-10-30)
Script: `scripts/spike-ilisten.sh <dir> <target>`. The outputs stay local in `data/`.

**Test audio** (synthetic, from the macOS voices; real recordings come next):

| File | What | Length |
|---|---|---|
| zh | Mandarin: plans for a 60th birthday party | 22 s |
| ja | Japanese: trip briefing, Tokyo to Kyoto | 22 s |
| mix | Mandarin and Japanese taking turns, two speakers, five turns | 26 s |
| en | English: office move update | 12 s |

**Voice Transcribe:**
- The script is correct in every file: simplified Hanzi for Mandarin, Kana and Kanji for Japanese.
- Mixed file: the speaker turns split correctly, and each turn stays in its own script.
- Small errors, which Spark tolerates:
  - repeated words ("号号", "大概大概", "晚上晚上");
  - 订 heard as 定;
  - "Hi" heard as "High".
- **No language field** in the response, so language detection is Spark's job.

**Muse Spark** (the draft `listen_understand` prompt, effort low, strict schema):

| File | Languages named | Per-turn labels | English summary | Chinese summary |
|---|---|---|---|---|
| zh | zh 100 | 1/1 right | right: date, place, cake, photographer, budget | (not run) |
| ja | ja 100 | 1/1 right | right: meeting point, train, temple, ryokan, rain plan | (not run) |
| mix | zh 60, ja 40 | **5/5 right** (zh, ja, zh, ja, zh) | right: 10 AM, 3rd-floor room, laptop, slides in English | right; Japanese turns translated, Mandarin turns kept |
| en | en 100 | 1/1 right | right | right |

- Cost: about 1,300 tokens per Spark call on these short files. Transcribe is $0.18 per hour.
- **Decision:** the language **share** is computed in our code from turn durations, not taken from Spark. Spark's 60/40 is a guess; the durations are measured.
- **Verdict:** the feature is viable on Meta models alone. Next: real recordings from the owner, then the UI mock.

## Spike 31.1: a check loop that scores the translation until it passes (2026-10-30)
Owner request: loop the result through a checker, keep each version, and stop at a passing confidence score.

- **Why not SAM:** SAM 3.1 segments images and video. It cannot read or judge text, so the checker is a separate **Muse Spark** pass with its own prompt and schema (`listen_check`).
- **The checker, per turn:**
  - translates the draft back into the turn's own language;
  - compares the meaning with the original;
  - scores 0–100, strict on numbers, dates, times, places, names and amounts;
  - writes a one-line issue.

  It also scores the summary and key points for faithfulness: nothing invented, nothing important missing.
- **The fixer** (`listen_fix`) re-translates only the flagged turns, using the checker's notes, and keeps every other turn word for word.

Test on the zh/ja mix, with two planted errors in version 1 (10 AM changed to 11 AM, third floor changed to second):

| Version | Turn scores | Summary | Checker notes |
|---|---|---|---|
| clean draft | 100 ×5 | 100 | none |
| v1, errors planted | 100, **30**, 100, 100, 100 | **75** | "Time mistranslated as 11 AM instead of 10 AM and floor as second instead of third"; key point "11:00 AM" wrong |
| v2, after one fix pass | 100 ×5 | 100 | none, **passed** |

- Cost: about 1.9k tokens per check (medium effort) and about 1k per fix, so cents per file.
- **Verdict:** the checker catches meaning errors on its own, and one fix pass recovered them.

### Check loop design
1. **v1** = the understand step (translate and summarise).
2. **check:** scores each turn and the summary. The confidence is the lowest of all scores.
   - **Pass:** every turn ≥ 90 and the summary ≥ 90.
3. **Fail:** fix only the flagged turns and the summary, giving **v2**, then check again. Up to **3 versions**.
4. **Stop:**
   - passed: show "Checked · 97% · v2";
   - still below 90 after v3: keep the best version and show "Needs a human check", with the flagged turns highlighted.
5. **Guards against a model checking itself:**
   - a different prompt and role from the translator;
   - back-translation, so the checker compares in the source language;
   - medium effort;
   - a code check that every number in the original turn appears in its translation, in Arabic or CJK numerals (normalised in `domain/listen.rs`). A missing number caps that turn at 60.
6. **What it cannot see:** the audio itself. Transcription slips (repeated words, a misheard character) are flagged by the checker as "heard as" notes. They do not fail the translation.
7. **Stored:**
   - `listen_versions` rows: version, turn scores, issues, summary score, passed;
   - the UI shows the version history (v1 → v2) with the score of each.
8. Steps become `audio → transcribe → understand → check → voice → ready`. The check step owns the loop and is idempotent per version.

## Design
1. **Upload or pick:**
   - any audio (mp3, wav, m4a, aac, ogg, flac) or video;
   - `POST /api/listens` with `{filename, content_type, size, target}`, then a raw-body `PUT /api/listens/{id}/source` streamed to storage (the iRead path), capped at 300 MB;
   - or `POST /api/listens` with `{clip_id, target}` for a clip already in the library. That reuses the clip's stored audio and its transcript.
2. **Listen job** (jobs kind `listen`; migration 0017 rebuilds `jobs` the 0015 way). Steps are `audio → transcribe → understand → voice → ready`, each idempotent:
   1. **audio:** probe without needing a video stream, then extract a 16 kHz mono WAV with ffmpeg. Cap: 2 h.
   2. **transcribe:** 570 s chunks sent to Voice Transcribe in DIARIZATION mode, turns re-offset, stored.
   3. **understand:** Muse Spark (`prompts/listen_understand.md` and its schema) returns, in the target language:
      - the title;
      - a language code and a translation per turn;
      - the summary;
      - the key points.

      Long transcripts are summarised chunk by chunk, then merged in one call. Language shares are computed from turn durations.
   4. **voice:** MMS-TTS audio of the summary when the target is English. Other languages use the device voice.
3. **Change output language:** `POST /api/listens/{id}/language {target}` re-runs **understand + voice only**. The transcript is kept.
4. **Output languages** (curated): English, 中文, 日本語, 한국어, Tagalog, Español, Français, Deutsch, Bahasa Indonesia, Tiếng Việt, ไทย, हिन्दी. The default is the user's saved choice, starting at English.

## UI (mock first; owner approves before it is wired)
- **iListen** sits after iRead under Features: the Mac sidebar, and a fourth option in the phone Features switch.
- **List and add:**
  - a drop zone for audio or video;
  - an output-language select;
  - rows with status and language chips ("中文 60% · 日本語 40% → English").
- **Detail:**
  - the summary and key points in the output language;
  - the detected languages with their shares;
  - the transcript, each turn tagged with speaker and language, toggling Original / Translated;
  - read-aloud;
  - "Change output language".
- **Clip page:** a "Listen" button next to "Make a guide".

## Steps
- 31.0 Spike. Done; results above.
- 31.1a Check-loop spike. Done; results above.
- 31.1 This doc, then the UI mock with fixtures. Owner approval.
- 31.2 Backend:
  - domain, migration 0017, the audio probe, the transcribe and understand steps, the routes;
  - tests: request shapes asserted for every Meta call, a mixed zh/ja fixture, tiny audio from `ffmpeg -f lavfi`.
- 31.3 Web:
  - client, parser, hooks, phone and Mac pages, the language preference;
  - device voice for the target language;
  - tests.
- 31.4 Gates (`make gates`), a real-app run on the spike files and the owner's recordings, then deploy on the owner's yes.

## Verification
- Upload a Mandarin mp3 and get an English summary.
- Upload a Mandarin + Japanese video. Both languages show, with shares, and each turn is labelled.
- Switch the output to Japanese. A new summary appears without a new transcribe: no new transcribe row in `model_calls`.
- Read-aloud speaks the summary.
