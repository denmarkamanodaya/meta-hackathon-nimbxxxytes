// NimbytesFeatureFilesystem: the main feature, the AI-powered filesystem, from the owner's screen
// recording, uncut (src/components/CaptureFilm.tsx): the right-click in the Gallery, Show in Finder
// on a 3.4 GB clip, Get Info ("Zero bytes on disk"), then it opens in nimbytes and scrubs instantly
// (the smart cache streams only what you watch). One continuous shot; the camera only zooms and
// pans. At 10 s a white search card (SearchCard.tsx), then the searches and the duplicates (public/live/fs-searches.mp4, fs-duplicates.mp4).
// Capture: public/live/fs-owner.mp4 (silent). The voice-over is in src/filesystem/vo-lines.json.
import { Series } from 'remotion';
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';
import { placeLines } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };
import { SEARCH_CARD_FRAMES, SearchCard } from './SearchCard';

const CLIP = 'live/fs-owner.mp4';
/** The player (video and timeline), with the speech list beside it. */
const PLAYER = { x: 0.46, y: 0.31, zoom: 1.3 } as const;

/**
 * The shot: 4.24–14.48 s of the capture, uncut (it opens in Finder on the file's menu and stops
 * mid-scrub), with no pills. Camera keyframes are in seconds from the shot's start (capture time
 * minus 4.24).
 */
const SHOT: Cut = {
  clip: CLIP,
  fromS: 4.24,
  toS: 14.48,
  start: { x: 0.323, y: 0.533, zoom: 1.34 },
  end: { ...PLAYER, zoom: 1.5 },
  keys: [
    // Finder: the 3.4 GB file, right-click > Get Info.
    { atS: 0, x: 0.323, y: 0.533, zoom: 1.34 },
    { atS: 0.96, x: 0.3, y: 0.55, zoom: 1.4 },
    // Get Info: "3,403,757,823 bytes (Zero bytes on disk)".
    { atS: 1.66, x: 0.1, y: 0.16, zoom: 2.0 },
    { atS: 3.26, x: 0.1, y: 0.16, zoom: 2.2 },
    // Back to nimbytes, wide, as it opens.
    { atS: 4.26, x: 0.5, y: 0.5, zoom: 1.05 },
    // The player: it opens, streams, and every jump lands at once.
    { atS: 5.96, ...PLAYER, zoom: 1.25 },
    { atS: 9.46, ...PLAYER, zoom: 1.4 },
    { atS: 10.24, ...PLAYER, zoom: 1.5 },
  ],
};

const SEARCHES = 'live/fs-searches.mp4';
const DUPLICATES = 'live/fs-duplicates.mp4';
/** The iRecall box at the bottom, while a search is typed. */
const BOX = { x: 0.47, y: 0.95, zoom: 2.2 } as const;
/** The results list, top left. */
const LIST = { x: 0.44, y: 0.33, zoom: 1.35 } as const;
const WIDE = { x: 0.5, y: 0.5, zoom: 1.05 } as const;

/**
 * The searches (public/live/fs-searches.mp4, 28.8 s): sleeping dog, wooden temple, said
 * "sacrifices", all media from Kristoff, each typed at real speed and its results; the wait for
 * results is cut out. The camera follows each from the box to the results. Times are seconds into
 * the shot.
 */
const SEARCH_SHOT: Cut = {
  clip: SEARCHES,
  fromS: 0,
  toS: 28.8,
  start: WIDE,
  end: LIST,
  keys: [
    { atS: 0, ...WIDE },
    { atS: 1.0, ...BOX },
    { atS: 4.4, ...BOX },
    { atS: 5.2, ...LIST },
    { atS: 6.0, ...LIST },
    { atS: 6.6, ...BOX },
    { atS: 9.0, ...BOX },
    { atS: 9.8, ...LIST },
    { atS: 13.0, ...LIST },
    { atS: 13.6, ...BOX },
    { atS: 17.4, ...BOX },
    { atS: 18.2, ...LIST },
    { atS: 21.3, ...LIST },
    { atS: 21.7, ...WIDE },
    { atS: 22.3, ...BOX },
    { atS: 24.4, ...BOX },
    { atS: 25.2, ...LIST },
    { atS: 28.8, ...LIST, zoom: 1.6 },
  ],
};

/**
 * The duplicates (public/live/fs-duplicates.mp4, 12.8 s): the Copies filter, then the near-copy
 * "Duet under moon" and its panel: 99% the same as the original, 152 MB, Remove this copy / Keep both.
 */
const DUPLICATE_SHOT: Cut = {
  clip: DUPLICATES,
  fromS: 0,
  toS: 12.8,
  start: WIDE,
  end: { x: 0.86, y: 0.27, zoom: 2.1 },
  keys: [
    { atS: 0, ...WIDE },
    { atS: 2.6, x: 0.3, y: 0.16, zoom: 1.8 },
    { atS: 4.2, x: 0.3, y: 0.16, zoom: 1.8 },
    { atS: 5.4, x: 0.86, y: 0.27, zoom: 2.0 },
    { atS: 12.8, x: 0.86, y: 0.27, zoom: 2.15 },
  ],
};

/**
 * The voice-over (British female, 1.1×): "This video is 3.4 gigabytes, and takes zero bytes on
 * your disk." from 0.3 s over Finder and Get Info, then "Open it…" as it opens (5.3 s).
 */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 1.24, tail: 0 }).lines;

/** The composition's length in frames. */
/** The filesystem shot is cut at 10 s, where the search card comes in. */
const FIRST_FRAMES = 300;
const LAST_FRAMES = filmFrames([SEARCH_SHOT, DUPLICATE_SHOT]);
export const FILESYSTEM_FRAMES = FIRST_FRAMES + SEARCH_CARD_FRAMES + LAST_FRAMES;

export function Filesystem() {
  return (
    <Series>
      <Series.Sequence durationInFrames={FIRST_FRAMES}>
        <CaptureFilm name="" cuts={[SHOT]} heads={[]} vo={VO} voDir="audio/filesystem-vo" scrim={false} />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SEARCH_CARD_FRAMES}>
        <SearchCard />
      </Series.Sequence>
      <Series.Sequence durationInFrames={LAST_FRAMES}>
        <CaptureFilm name="" cuts={[SEARCH_SHOT, DUPLICATE_SHOT]} heads={[]} vo={[]} voDir="audio/filesystem-vo" scrim={false} />
      </Series.Sequence>
    </Series>
  );
}
