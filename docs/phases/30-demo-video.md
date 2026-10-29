# Phase 30: the 3-minute demo video (plan)

## Context
- The demo video is one of the main scoring items. Submission: Thu 5 Nov 2026, 10:00 Perth.
- The build prompt is `nimbytes-demo-video-prompt.md` in the repo root (owner, 2026-10-29). It is the spec: copy, timing, tokens, sources and rules. This doc only splits it into phases and lists what is still open. Where they differ, the prompt wins.
- Output: a Remotion project in `video/` that renders one 1920×1080, 30 fps, 5400-frame (3:00) MP4.
- **Stays local** (owner ruling 2026-10-29): the prompt and all of `video/` are git-ignored. Nothing about the demo build is pushed.
- The app is not touched: no changes in `api/`, `web/`, `desktop/`, `render/`, `ml/` or `infra/`.

## The story
"We're deleting the very memories 57 million people are losing." nimbytes keeps every clip at 0 bytes on your device, and Meta AI turns it into everyday help for people with memory problems.

| Part | Scenes | Time |
|---|---|---|
| Hook | S00 | 0:00–0:12 |
| Two problems: storage, memory | S01–S05 | 0:12–0:54 |
| Turn | S06 | 0:54–0:57 |
| Product | S07 | 0:57–1:07 |
| Live demo: Store, iRecall, iGuide, iRead | S08–S11 | 1:07–2:25 |
| Six Meta models | S12 | 2:25–2:35 |
| Roadmap: glasses | S13 | 2:35–2:50 |
| Close | S14 | 2:50–3:00 |

## Phases

### V0: scaffold
- `video/package.json`, pinned as in `render/package.json`:
  - `remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/player` and `@remotion/google-fonts`, all `4.0.538`;
  - React `19.3.1`, TypeScript `6.0.3`;
  - `lucide-react` at a pinned version (named by the prompt for the card icons).
- Also `remotion.config.ts`, `tsconfig.json`, and `src/Root.tsx` registering `NimbytesDemo` (1920×1080, 30 fps, 5400 frames).
- Scripts: `dev` (Studio), `render` (H.264 CRF 18, `veryfast`, AAC 192k, to `video/out/nimbytes-demo.mp4`), `stills` (one PNG per scene to `video/out/stills/`), `typecheck`.
- **Check:** `npm run dev` opens the Studio and shows a 3:00 composition.

### V1: theme, timeline, placeholders
- `theme.ts`: the tokens from prompt §3, exactly. Fonts: Archivo 600/700/800 and Inter 400/600/700.
- `timeline.ts` is the single source of timing. Each entry holds `id`, `from`, `durationInFrames` and an optional recording `startFrom`. `Video.tsx` builds a `<Series>` from it. Scenes never hard-code timing.
- Cutting S11 is one change in `timeline.ts`: drop the entry, and S08 and S09 share its 17 s.
- Shared components: `Eyebrow`, `BigNumber` (count-up), `Bar`, `Card`, `Footer`, `Caption`, `ScreenFrame`, `SpeechBubble`, `ChapterChip`, `Placeholder`.
- A missing asset renders a grey placeholder card, for example "RECORDING: irecall.mp4 — 23 s", so the cut can be reviewed before the recordings exist.
- **Check:** a unit test sums the timeline to exactly 5400 frames with no gaps or overlaps, and checks that it still does with S11 cut.

### V2: slide scenes
- S01–S07 and S12–S14, with the copy, sizes, colours and footers from prompt §5, word for word.
- Motion: spring or ease-out entrances of 8–15 frames, 10-frame crossfades, count-ups, bars growing from the baseline, staggers 4–6 frames apart. No bounces or spins.
- S05 is the emotional pivot: at the bridge line the cards dim to 30% and the line holds for 2 s.
- S07 always shows the disclaimer.
- S13 always shows the "After the hackathon" pill and the roadmap footer. Its icons are the SVGs in prompt Appendix A, and the scene draws no Meta logo.
- **Check:** `npm run stills`. Compare each still with the pitch deck. Number and footer text equals the prompt (checked with a string test over the scene copy).

### V3: hook and recording scenes
- S00: b-roll cuts from `public/broll/hook-*.mp4`, plus a "Storage Almost Full" overlay card at about 8 s with a tap on "Delete". The card is an overlay, not a fake app.
- S08–S11: `<OffthreadVideo>` inside `ScreenFrame` (`objectFit: contain`), trimmed from `timeline.ts`. Each has its chapter chip.
  - S08: the yellow "0 bytes on disk" callout ring.
  - S09: a speech bubble with the spoken query.
  - S10: the Pexels credit line when the stock clip plays.
- Placeholders stand in until the owner's files arrive.
- **Check:** the Studio plays each scene with and without its file.

### V4: captions and audio
- `captions.ts`: the VO lines from prompt §5, timed per scene, at most 2 lines of about 42 characters each.
- Captions are burned in (Inter 600, 40 px, white on `ink` at 75%, radius 12, 72 px from the bottom). On S02–S07 and S12–S14 they sit above the footer.
- Voice-over: `audio/vo.wav`, or one `vo-SNN.wav` per scene. With per-scene files, a console warning shows when a file runs longer than its scene.
- Music only with a licensed file: −24 LUFS, ducked 6 dB under the VO. Silent otherwise.
- **Check:** a unit test asserts that every scene with VO has a caption, and that no caption is longer than 2 × 42 characters.

### V5: render and hand-back
- `npm run render` gives `video/out/nimbytes-demo.mp4`. The probe must read ≤ 5400 frames, 30 fps, 1920×1080, H.264 + AAC.
- `video/README.md`:
  - how to drop in the assets;
  - how to retime a scene and how to cut S11;
  - the asset checklist;
  - the sources (prompt Appendix B).
- Go through the acceptance checklist in prompt §9 one item at a time, and watch the render once with the sound off.

## Owner inputs (placeholders until they arrive)
| File | Length | Content | Status |
|---|---|---|---|
| `broll/hook-*.mp4` | 3–4 s each | Glasses POV: garden, birthday cake, kettle | open |
| `recordings/store.mp4` | ~15 s | Finder `~/nimbytes`, "On this Mac: 0 bytes", play a clip | open |
| `recordings/irecall.mp4` | ~23 s | Hold the mic, "Rosa's birthday cake", result and playback | open |
| `recordings/iguide.mp4` | ~23 s | Washing-machine clip to steps, circled button, a step read aloud | open |
| `recordings/iread.mp4` | ~17 s | Bill photo, "Read it to me", spoken summary | open; decides whether S11 is in the cut |
| `audio/vo.wav` or `vo-S00…S14.wav` | 3:00 | Voice-over (prompt §5) | open |
| `audio/music.mp3` | – | A licensed track only | optional |

## Flags for the owner (the prompt is followed as written)
1. The VO uses two names. Ana films and owns the library (S08, S10); Rosa asks and listens (S09, S11). That reads as daughter and mother. Confirm, or pick one name.
2. S12 "The voice: MMS-TTS … as fallback" matches the 2026-10-29 ruling: read-aloud uses the device voice first, with MMS-TTS as the backup. The VO says "six Meta models", which stays true.
3. The S08 VO says "plays like it's local", which is the approved pitch line. The video never says "offline" or "same as local".
4. Rules the prompt already enforces, kept as review checks:
   - the word list next to nimbytes (prompt §2.4);
   - roadmap labelling on S13;
   - the Pexels credit;
   - no copyrighted music.

## Progress (2026-10-29)
- V0–V5 built with placeholders: 19 unit tests pass (timeline, captions, copy), typecheck clean.
- `npm run stills` reviewed: S05 bridge got a paper backing, and S08's ring moved above the captions.
- `npm run render`: 5400 frames, 30 fps, 1920×1080, H.264, 180.0 s, 4.2 MB. No audio track until a voice-over is supplied.
- Waiting on the owner's assets (table above). Then re-render and watch it once with the sound off.

## Acceptance (from prompt §9)
- [x] Renders without errors: ≤ 5400 frames at 30 fps, 1920×1080.
- [x] Every number and source footer matches the prompt word for word.
- [x] The disclaimer is on S07. "After the hackathon" and the roadmap footer are on for all of S13.
- [x] The banned words never sit next to nimbytes, and no Meta logo is drawn.
- [ ] Every VO line has a caption, and no caption covers a source footer.
- [x] Placeholders are clear when assets are missing, and S11 can be cut with one change in `timeline.ts`.
- [x] No files changed outside `video/` (apart from the `.gitignore` lines already committed).
- [ ] Watched once with the sound off: the slides and captions alone tell the story.
