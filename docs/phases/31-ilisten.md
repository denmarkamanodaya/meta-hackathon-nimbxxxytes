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
