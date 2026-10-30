// The searches, in two scenes under the "Intelligent Filesystem" headline:
// 1. SearchTyping: a still close-up of the iRecall box; three real searches are typed one after
//    another (sped up 1.6×), each rolling in with a fade and rolling out for the next.
// 2. SearchResults: their result screens as a stack of cards that shuffle, each coming to the front.
// Captures: public/live/fs3-type*.mp4 (typing) and fs3-res*.png (results once loaded). Voice: fsr-1
// over the typing.
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { placeIn, type Frame } from '../components/CaptureFilm';
import { Headline } from '../components/Headline';
import { placeLines } from '../components/voTiming';
import generated from './vo-results.generated.json' with { type: 'json' };
import lines from './vo-results-lines.json' with { type: 'json' };

const FPS = 30;
const APP_BG = '#141414';
/** Typing plays this much faster than it was typed, so each search reads quickly but still types. */
const RATE = 1.6;
/** Frames each search rolls in and out. */
const ROLL = 9;

/** The three searches: typing clip (seconds long) and its result screen. */
const SEARCHES = [
  { typing: 'live/fs3-type1.mp4', seconds: 4.6, results: 'live/fs3-res1.png' }, // Show me all my footage of the wooden temple
  { typing: 'live/fs3-type2.mp4', seconds: 3.73, results: 'live/fs3-res2.png' }, // Who said "sacrifices" in a birthday event?
  { typing: 'live/fs3-type3.mp4', seconds: 2.73, results: 'live/fs3-res3.png' }, // All media from Kristoff
] as const;

/** Frames each search is on screen. */
const SPANS = SEARCHES.map((search) => Math.round((search.seconds / RATE) * FPS));
const STARTS = SPANS.map((_, index) => SPANS.slice(0, index).reduce((sum, span) => sum + span, 0));

/** The typing scene's length in frames. */
export const SEARCH_TYPING_FRAMES = SPANS.reduce((sum, span) => sum + span, 0) + 6;

/** The voice line ("Search by what you saw, what was said, or who was there…"), from 0.3 s. */
const VO = placeLines(lines.filter((line) => line.id === 'fsr-1'), generated, { min: 0, lead: 0.3, gap: 0, tail: 0 }).lines;

/** The close-up on the iRecall box only (viewport 1640 × 200, centred): the live-answer drop-down above it stays out. */
const BOX_W = 1640;
const BOX_H = 200;
const BOX: Frame = { x: 0.47, y: 0.948, zoom: 2.25 };

function Head() {
  return (
    <div style={{ position: 'absolute', left: 96, top: 72 }}>
      <Headline first="Intelligent Filesystem" second="Analyzed and indexed by Meta AI." size={64} />
    </div>
  );
}

/** One search: rolls up into place with a fade, types, then rolls up and out. */
function TypedSearch({ index }: { index: number }) {
  const frame = useCurrentFrame();
  const span = SPANS[index] ?? 0;
  const search = SEARCHES[index];
  if (search === undefined) return null;
  const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) } as const;
  const isLast = index === SEARCHES.length - 1;
  const inT = index === 0 ? interpolate(frame, [0, ROLL], [0, 1], ease) : interpolate(frame, [0, ROLL], [0, 1], ease);
  const outT = isLast ? 0 : interpolate(frame, [span - ROLL, span], [0, 1], ease);
  return (
    <div style={{ position: 'absolute', left: (1920 - BOX_W) / 2, top: 560 - BOX_H / 2, width: BOX_W, height: BOX_H, overflow: 'hidden', borderRadius: 24, opacity: inT * (1 - outT), transform: `translateY(${String((1 - inT) * 60 - outT * 60)}px)` }}>
      <OffthreadVideo src={staticFile(search.typing)} muted playbackRate={RATE} style={placeIn(BOX, BOX_W, BOX_H)} />
    </div>
  );
}

export function SearchTyping() {
  return (
    <AbsoluteFill style={{ background: APP_BG }}>
      <Head />
      {SEARCHES.map((search, index) => (
        <Sequence key={search.typing} from={STARTS[index] ?? 0} durationInFrames={(SPANS[index] ?? 0) + (index === SEARCHES.length - 1 ? 6 : 0)}>
          <TypedSearch index={index} />
        </Sequence>
      ))}
      {VO.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`audio/filesystem-vo/${line.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

/** Card size and the part of each result screen it shows: the count and the first results. */
const CARD_W = 1440;
const CARD_H = 720;
const CARD_FRAME: Frame = { x: 0.46, y: 0.33, zoom: 1.4 };
/** Frames each card stays at the front before the next shuffles over it. */
const SHUFFLE = 34;

/** The results scene's length in frames: each card comes to the front once, the last one holds. */
export const SEARCH_RESULTS_FRAMES = SHUFFLE * SEARCHES.length + 30;

/** One result card. `depth` 0 is the front; it moves back as later cards come forward. */
function Card({ index }: { index: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const search = SEARCHES[index];
  if (search === undefined) return null;
  // Each card arrives from below at its turn, then steps back once per later card.
  const arrive = spring({ frame: frame - index * SHUFFLE, fps, durationInFrames: 18, config: { damping: 200 } });
  const back = SEARCHES.slice(index + 1).reduce((sum, _, later) => sum + spring({ frame: frame - (index + 1 + later) * SHUFFLE, fps, durationInFrames: 18, config: { damping: 200 } }), 0);
  const scale = 1 - 0.07 * back;
  const y = (1 - arrive) * 700 - back * 46;
  return (
    <div
      style={{
        position: 'absolute',
        left: (1920 - CARD_W) / 2,
        top: 250,
        width: CARD_W,
        height: CARD_H,
        overflow: 'hidden',
        borderRadius: 24,
        background: APP_BG,
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
        opacity: Math.min(1, arrive * 2) * (1 - 0.25 * back),
        transform: `translateY(${String(y)}px) scale(${String(scale)})`,
        transformOrigin: 'center top',
        zIndex: index,
      }}
    >
      <Img src={staticFile(search.results)} style={placeIn(CARD_FRAME, CARD_W, CARD_H)} />
    </div>
  );
}

export function SearchResults() {
  return (
    <AbsoluteFill style={{ background: APP_BG }}>
      <Head />
      {SEARCHES.map((search, index) => (
        <Card key={search.results} index={index} />
      ))}
    </AbsoluteFill>
  );
}
