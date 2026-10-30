// The searches as one split screen: three rows under the "Intelligent Filesystem" headline, each
// playing one search (typing at real speed, then a dissolve to its results once loaded), starting
// one after another as the voice says "what you saw", "what was said" and "who was there".
// Captures: public/live/fs2-type*.mp4 and fs2-res*.mp4. Voice: fsr-1.
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { placeIn, type Frame } from '../components/CaptureFilm';
import { Headline } from '../components/Headline';
import { useZoomFade } from '../components/motion';
import { placeLines } from '../components/voTiming';
import generated from './vo-results.generated.json' with { type: 'json' };
import lines from './vo-results-lines.json' with { type: 'json' };

const FPS = 30;
/** Row size and placement, px: three rows under the headline. */
const ROW_W = 1728;
const ROW_H = 260;
const ROW_LEFT = 96;
const ROW_TOP = [230, 510, 790] as const;
/** Frames the typing dissolves into the results. */
const DISSOLVE = 10;

/** The iRecall box, wide enough to read the query. */
const BOX: Frame = { x: 0.47, y: 0.955, zoom: 2.35 };
/** The top of the results: the count, then the first results. */
const TOP_RESULTS: Frame = { x: 0.455, y: 0.165, zoom: 1.4 };

/** One row: its typing clip (seconds to play) and its results still. */
interface Row {
  typing: string;
  typingS: number;
  results: string;
}

const ROWS: readonly Row[] = [
  { typing: 'live/fs2-type2.mp4', typingS: 2.5, results: 'live/fs2-res2.mp4' },
  { typing: 'live/fs2-type3.mp4', typingS: 1.6, results: 'live/fs2-res3.mp4' },
  { typing: 'live/fs2-type4.mp4', typingS: 3.3, results: 'live/fs2-res4.mp4' },
];

/** The voice line ("Search by what you saw, what was said, or who was there…"), from 0.3 s. */
const VO = placeLines(lines.filter((line) => line.id === 'fsr-1'), generated, { min: 0, lead: 0.3, gap: 0, tail: 0 }).lines;
/** When each row starts: on "what you saw", "what was said" (1.74 s into the line), "who" (2.58 s). */
const ROW_AT = [0, 1.74, 2.58].map((s) => (VO[0]?.from ?? 0) + Math.round(s * FPS));

/** How long the rows hold after the last one shows its results. */
const HOLD = 1.3;

/** The scene's length in frames. */
export const SEARCH_ROWS_FRAMES = Math.round((ROW_AT[2] ?? 0) + ((ROWS[2]?.typingS ?? 0) + HOLD) * FPS);

/** One row: typing, then the results dissolve in and push in slowly. */
function SearchRow({ row, top, at }: { row: Row; top: number; at: number }) {
  const frame = useCurrentFrame() - at;
  const typingFrames = Math.round(row.typingS * FPS);
  const reveal = interpolate(frame, [typingFrames, typingFrames + DISSOLVE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin) });
  const pan = interpolate(frame, [typingFrames, typingFrames + 3 * FPS], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const results = { ...TOP_RESULTS, zoom: TOP_RESULTS.zoom + 0.04 * pan };
  return (
    <div style={{ position: 'absolute', left: ROW_LEFT, top, width: ROW_W, height: ROW_H, overflow: 'hidden', borderRadius: 18, background: '#141414', border: '1px solid rgba(255,255,255,0.08)', ...useZoomFade(at) }}>
      <Sequence from={at} durationInFrames={typingFrames + DISSOLVE} layout="none">
        <OffthreadVideo src={staticFile(row.typing)} muted style={placeIn(BOX, ROW_W, ROW_H)} />
      </Sequence>
      <Sequence from={at + typingFrames} layout="none">
        <div style={{ position: 'absolute', inset: 0, opacity: reveal }}>
          <OffthreadVideo src={staticFile(row.results)} muted style={placeIn(results, ROW_W, ROW_H)} />
        </div>
      </Sequence>
    </div>
  );
}

export function SearchRows() {
  return (
    <AbsoluteFill style={{ background: '#141414' }}>
      <div style={{ position: 'absolute', left: 96, top: 72 }}>
        <Headline first="Intelligent Filesystem" second="Analyzed and indexed by Meta AI." size={64} />
      </div>
      {ROWS.map((row, index) => (
        <SearchRow key={row.typing} row={row} top={ROW_TOP[index] ?? 0} at={ROW_AT[index] ?? 0} />
      ))}
      {VO.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`audio/filesystem-vo/${line.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
