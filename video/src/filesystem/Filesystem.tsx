// NimbytesFeatureFilesystem: the main feature, the AI-powered filesystem, from real captures
// (src/components/CaptureFilm.tsx): Finder and Get Info on a 3.4 GB clip ("Zero bytes on disk"),
// then it plays in nimbytes and scrubs instantly (the smart cache streams only what you watch); a
// white search card (SearchCard.tsx); then the searches and the duplicates (public/live/fs2-*.mp4).
// The "Intelligent Filesystem" headline comes in with the second voice line. Voice-over:
// src/filesystem/vo-*.json.
import { Series } from 'remotion';
import { CaptureFilm, filmFrames, type Cut } from '../components/CaptureFilm';
import { placeLines } from '../components/voTiming';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };
import { SEARCH_CARD_FRAMES, SearchCard } from './SearchCard';
import { SEARCH_ROWS_FRAMES, SearchRows } from './SearchRows';
import resultsGenerated from './vo-results.generated.json' with { type: 'json' };
import resultsLines from './vo-results-lines.json' with { type: 'json' };

const CLIP = 'live/fs-owner.mp4';
/** The scrubbing shot's fixed framing: the video and the timeline controls under it, edge to edge. */
const PLAYER_STILL = { x: 0.425, y: 0.335, zoom: 1.32 } as const;

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
  // Static: no camera move or tilt, framed on the video and its timeline controls.
  start: PLAYER_STILL,
  end: PLAYER_STILL,
};


/** The copy panel on the right. */
const PANEL = { x: 0.86, y: 0.27, zoom: 1.9 } as const;


/** The duplicates (public/live/fs2-dup*.mp4): the Copies filter, then the near-copy panel. */
const SEARCH_CUTS: readonly Cut[] = [
  // Duplicates: the Copies filter, then the near-copy and its score.
  { clip: 'live/fs2-dup.mp4', fromS: 1.2, toS: 2.8, start: { x: 0.3, y: 0.2, zoom: 1.5 }, end: { x: 0.3, y: 0.2, zoom: 1.65 } },
  { clip: 'live/fs2-dupres.mp4', fromS: 0, toS: 3.6, start: { ...PANEL, zoom: 1.75 }, end: { ...PANEL, zoom: 2.0 } },
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
export const FILESYSTEM_FRAMES = FIRST_FRAMES + SEARCH_CARD_FRAMES + SEARCH_ROWS_FRAMES + LAST_FRAMES;

/** The headline over the searches, as in the iListen film. */
const HEAD = { first: 'Intelligent Filesystem', second: 'Analyzed and indexed by Meta AI.' };
/** In the first part it comes in with the second voice line ("It plays in near real-time…"). */
const FIRST_HEADS = [{ ...HEAD, from: VO[1]?.from ?? 0 }];
const HEADS = [{ ...HEAD, from: 0 }];

/** The duplicates line (1.1×), from 0.3 s. The search line plays in SearchRows. */
const RESULTS_VO = placeLines(resultsLines.filter((line) => line.id === 'fsr-2'), resultsGenerated, { min: 0, lead: 0.3, gap: 0, tail: 0 }).lines;

export function Filesystem() {
  return (
    <Series>
      <Series.Sequence durationInFrames={FIRST_FRAMES}>
        <CaptureFilm name="" cuts={[SHOT_A, SHOT_B]} heads={FIRST_HEADS} vo={VO} voDir="audio/filesystem-vo" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SEARCH_CARD_FRAMES}>
        <SearchCard />
      </Series.Sequence>
      <Series.Sequence durationInFrames={SEARCH_ROWS_FRAMES}>
        <SearchRows />
      </Series.Sequence>
      <Series.Sequence durationInFrames={LAST_FRAMES}>
        <CaptureFilm name="" cuts={SEARCH_CUTS} heads={HEADS} vo={RESULTS_VO} voDir="audio/filesystem-vo" />
      </Series.Sequence>
    </Series>
  );
}
