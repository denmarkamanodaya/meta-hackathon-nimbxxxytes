// NimbytesFeatureFilesystem: the main feature, the AI-powered filesystem, from real captures
// (src/components/CaptureFilm.tsx): Finder and Get Info on a 3.4 GB clip ("Zero bytes on disk"),
// then it plays in nimbytes and scrubs instantly (the smart cache streams only what you watch); a
// white search card (SearchCard.tsx); then the searches and the duplicates (public/live/fs2-*.mp4).
// The "Intelligent Filesystem" headline comes in with the second voice line. Voice-over:
// src/filesystem/vo-*.json.
import { Series } from 'remotion';
import { CaptureFilm, cutStarts, filmFrames, type Cut } from '../components/CaptureFilm';
import { placeLines } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };
import { SEARCH_CARD_FRAMES, SearchCard } from './SearchCard';
import resultsGenerated from './vo-results.generated.json' with { type: 'json' };
import resultsLines from './vo-results-lines.json' with { type: 'json' };

const CLIP = 'live/fs-owner.mp4';
/** The player (video and timeline), with the speech list beside it. */
const PLAYER = { x: 0.46, y: 0.31, zoom: 1.3 } as const;

/**
 * The filesystem shot (capture 4.24–14.48 s), with the way back to nimbytes and the loading player (7.28–10.0 s) cut out:
 * Finder and Get Info, then the player dissolves in. No pills. Camera keyframes are in seconds from
 * each piece's start.
 */
const SHOT_A: Cut = {
  clip: CLIP,
  fromS: 4.24,
  toS: 7.28,
  start: { x: 0.323, y: 0.533, zoom: 1.34 },
  end: { x: 0.1, y: 0.16, zoom: 2.15 },
  keys: [
    // Finder: the 3.4 GB file, right-click > Get Info.
    { atS: 0, x: 0.323, y: 0.533, zoom: 1.34 },
    { atS: 0.96, x: 0.3, y: 0.55, zoom: 1.4 },
    // Get Info: "3,403,757,823 bytes (Zero bytes on disk)".
    { atS: 1.66, x: 0.1, y: 0.16, zoom: 2.0 },
    { atS: 3.04, x: 0.1, y: 0.16, zoom: 2.15 },
  ],
};

/**
 * The way back to nimbytes and the player still loading (capture 7.28–10.0 s) are cut out; the
 * playing video dissolves in over Get Info.
 */
const SHOT_B: Cut = {
  clip: CLIP,
  fromS: 10.0,
  toS: 14.48,
  start: { ...PLAYER, zoom: 1.15 },
  end: { ...PLAYER, zoom: 1.5 },
  keys: [
    // The player: it opens, streams, and every jump lands at once.
    { atS: 0, ...PLAYER, zoom: 1.15 },
    { atS: 0.2, ...PLAYER, zoom: 1.25 },
    { atS: 3.7, ...PLAYER, zoom: 1.4 },
    { atS: 4.48, ...PLAYER, zoom: 1.5 },
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
 * your disk." from 0.3 s over Finder and Get Info, then "It plays in near real-time…" as it plays (4.4 s).
 */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0.3, tail: 0 }).lines;

/** The composition's length in frames. */
/** The filesystem shots run to the search card (without the film's end hold). */
const FIRST_FRAMES = filmFrames([SHOT_A, SHOT_B]) - 15;
const LAST_FRAMES = filmFrames(SEARCH_CUTS);
export const FILESYSTEM_FRAMES = FIRST_FRAMES + SEARCH_CARD_FRAMES + LAST_FRAMES;

/** The headline over the searches, as in the iListen film. */
const HEAD = { first: 'Intelligent Filesystem', second: 'Analyzed and indexed by Meta AI.' };
/** In the first part it comes in with the second voice line ("It plays in near real-time…"). */
const FIRST_HEADS = [{ ...HEAD, from: VO[1]?.from ?? 0 }];
const HEADS = [{ ...HEAD, from: 0 }];

/** The voice-over over the searches (1.1×): line 1 from 0.5 s, line 2 as the duplicates begin. */
const RESULTS_VO = (() => {
  const dupAt = (cutStarts(SEARCH_CUTS)[9] ?? 0) / 30;
  const first = resultsGenerated['fsr-1'].seconds;
  return placeLines(resultsLines, resultsGenerated, { min: 0, lead: 0.5, gap: Math.max(0.3, dupAt - 0.5 - first), tail: 0 }).lines;
})();

export function Filesystem() {
  return (
    <Series>
      <Series.Sequence durationInFrames={FIRST_FRAMES}>
        <CaptureFilm name="" cuts={[SHOT_A, SHOT_B]} heads={FIRST_HEADS} vo={VO} voDir="audio/filesystem-vo" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SEARCH_CARD_FRAMES}>
        <SearchCard />
      </Series.Sequence>
      <Series.Sequence durationInFrames={LAST_FRAMES}>
        <CaptureFilm name="" cuts={SEARCH_CUTS} heads={HEADS} vo={RESULTS_VO} voDir="audio/filesystem-vo" />
      </Series.Sequence>
    </Series>
  );
}
