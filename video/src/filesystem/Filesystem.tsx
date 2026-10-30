// NimbytesFeatureFilesystem: the main feature, the AI-powered filesystem, from the owner's screen
// recording, uncut (src/components/CaptureFilm.tsx): the right-click in the Gallery, Show in Finder
// on a 3.4 GB clip, Get Info ("Zero bytes on disk"), then it opens in nimbytes and scrubs instantly
// (the smart cache streams only what you watch). One continuous shot; the camera only zooms and
// pans. At 10 s a white search card (SearchCard.tsx), then the searches and the duplicates
// (public/live/fs2-*.mp4) under the headline.
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

/** The iRecall box at the bottom, while a search is typed. */
const BOX = { x: 0.47, y: 0.95, zoom: 2.0 } as const;
/** A results list, set below the headline (the framing may pass the app's top edge). */
const RESULTS = { x: 0.4, y: 0.22, zoom: 1.4 } as const;
/** The copy panel on the right. */
const PANEL = { x: 0.86, y: 0.27, zoom: 1.9 } as const;

const typed = (clip: string, toS: number, tilt: number): Cut => ({ clip, fromS: 0, toS, start: { ...BOX, zoom: 1.85, tiltY: tilt, tiltX: -2 }, end: { ...BOX, tiltY: tilt / 5 } });
const found = (clip: string, tilt: number): Cut => ({ clip, fromS: 0, toS: 2.6, free: true, start: { ...RESULTS, zoom: 1.32, tiltY: tilt, tiltX: 2 }, end: { ...RESULTS, tiltY: 0 } });

/**
 * The searches and the duplicates (public/live/fs2-*.mp4): for each search, the typing at real speed,
 * then its results once every picture has loaded (the wait is cut); "sacrifices" also shows Muse
 * Spark's "Did you mean…" choice. Then the Copies filter and the near-copy panel. Cuts dissolve and
 * tilt like the iListen film.
 */
const SEARCH_CUTS: readonly Cut[] = [
  typed('live/fs2-type1.mp4', 2.4, -6),
  found('live/fs2-res1.mp4', 6),
  typed('live/fs2-type2.mp4', 2.5, 6),
  found('live/fs2-res2.mp4', -6),
  typed('live/fs2-type3.mp4', 1.6, -6),
  // Muse Spark asks: search for sacrifices, or make a short about them?
  { clip: 'live/fs2-type3.mp4', fromS: 1.6, toS: 4.6, start: { x: 0.47, y: 0.8, zoom: 1.75, tiltY: 6, tiltX: 2 }, end: { x: 0.47, y: 0.8, zoom: 1.9 } },
  found('live/fs2-res3.mp4', -6),
  typed('live/fs2-type4.mp4', 3.3, 6),
  found('live/fs2-res4.mp4', -6),
  // Duplicates: the Copies filter, then the near-copy and its score.
  { clip: 'live/fs2-dup.mp4', fromS: 1.2, toS: 2.8, start: { x: 0.3, y: 0.2, zoom: 1.5, tiltY: 6, tiltX: 2 }, end: { x: 0.3, y: 0.2, zoom: 1.65 } },
  { clip: 'live/fs2-dupres.mp4', fromS: 0, toS: 3.6, start: { ...PANEL, zoom: 1.75, tiltY: -6, tiltX: 2 }, end: { ...PANEL, zoom: 2.0, tiltY: 0 } },
];

/**
 * The voice-over (British female, 1.1×): "This video is 3.4 gigabytes, and takes zero bytes on
 * your disk." from 0.3 s over Finder and Get Info, then "Open it…" as it opens (5.3 s).
 */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 1.24, tail: 0 }).lines;

/** The composition's length in frames. */
/** The filesystem shot is cut at 10 s, where the search card comes in. */
const FIRST_FRAMES = 300;
const LAST_FRAMES = filmFrames(SEARCH_CUTS);
export const FILESYSTEM_FRAMES = FIRST_FRAMES + SEARCH_CARD_FRAMES + LAST_FRAMES;

/** The headline over the searches, as in the iListen film. */
const HEADS = [{ first: 'Intelligent Filesystem', second: 'Analyzed and indexed by Meta AI.', from: 0 }];

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
        <CaptureFilm name="" cuts={SEARCH_CUTS} heads={HEADS} vo={[]} voDir="audio/filesystem-vo" />
      </Series.Sequence>
    </Series>
  );
}
