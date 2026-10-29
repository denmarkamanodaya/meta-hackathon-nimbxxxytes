# nimbytes promo video

The nimbytes product video, built as code with [Remotion](https://www.remotion.dev): one 1920×1080,
30 fps MP4 of about 1:26, made from real screen recordings of the nimbytes Mac app.

## Commands

```bash
npm install
npm run dev        # Remotion Studio
npm run render     # out/nimbytes-promo.mp4 (H.264 CRF 18, AAC 192k)
npm run stills     # one PNG per scene in out/stills/
npm run typecheck
```

## How it is put together

- `src/vo-lines.json`: the voice-over, one line per entry, grouped by scene. Lines marked
  `"voice": "device"` are the app reading aloud in the Mac's own voice.
- `scripts/make-vo.py`: speaks every line locally (Kokoro-82M, British English voice `bf_emma`,
  through mlx-audio; device lines through macOS `say`) into `public/audio/vo/`, and writes each
  line's length to `src/vo.generated.json`.
- `src/timeline.ts`: lays the scenes out from those lengths: lead-in, gaps, holds, and the time a
  line owns when a recording under it runs longer (`slots`).
- `src/promo/*Scenes.tsx`: the scenes. App recordings play at real speed inside a window, cut
  with `{ clip, fromS, durS }` and joined by soft dissolves; a slow camera (`cams`) frames them
  and `Ring` draws around the part that matters.
- `src/components/`: the window and camera, rings, headlines, pills and backdrop.

## Media (not in the repo)

`public/` holds the recordings, stills, voice-over and music. It is not published: the footage is
personal and the music is licensed for use in the video, not for redistribution. To render, put
the files back under `public/` with the names the scenes use (`raw/*.mp4`, `shots/*.png`,
`audio/music.mp3`, `demo-docs/water-bill.png`), run `python3 scripts/make-vo.py`, then
`npm run render`.

Stock footage in the guide scene: Pexels (alleksana). No endorsement implied.
