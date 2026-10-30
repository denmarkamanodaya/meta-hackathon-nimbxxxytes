// The search card between the filesystem shot and the searches: a white page with a search box, a
// magnifier and "Search by" rolling through scene, people and dialogue, under its voice-over
// ("Search your objects like text. Meta AI analyzes them, so you can search the way you want.").
import { Search } from 'lucide-react';
import { AbsoluteFill, Audio, interpolate, Easing, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { useZoomFade } from '../components/motion';
import { placeLines } from '../components/voTiming';
import { ROBOTO } from '../fonts';
import { COLOR } from '../theme';
import generated from './vo-search.generated.json' with { type: 'json' };
import lines from './vo-search-lines.json' with { type: 'json' };

/** What the search box rolls through, in order; it holds on the last. */
const OPTIONS = ['scene', 'people', 'dialogue'] as const;

const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0.3, tail: 0.6 });

/** The card's length in frames. */
export const SEARCH_CARD_FRAMES = VO.durationInFrames;

const SIZE = 64;
const LINE = Math.round(SIZE * 1.25);
/** Frames each option shows before rolling to the next, and the roll's length. */
const HOLD = 40;
const ROLL = 10;
const FIRST = 14;

/** The rolling word: each option slides up to the next, then it rests on the last. */
function Roller() {
  const frame = useCurrentFrame();
  const position = OPTIONS.slice(1).reduce((pos, _, index) => {
    const start = FIRST + HOLD * (index + 1) + ROLL * index;
    return pos + interpolate(frame, [start, start + ROLL], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  }, 0);
  return (
    <span style={{ display: 'inline-block', height: LINE, overflow: 'hidden', verticalAlign: 'top' }}>
      <span style={{ display: 'block', transform: `translateY(${String(-position * LINE)}px)` }}>
        {OPTIONS.map((option) => (
          <span key={option} style={{ display: 'block', height: LINE, color: COLOR.teal, fontWeight: 500 }}>
            {option}
          </span>
        ))}
      </span>
    </span>
  );
}

export function SearchCard() {
  return (
    <AbsoluteFill style={{ background: COLOR.white, alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: 1180,
          height: 150,
          borderRadius: 32,
          background: COLOR.white,
          border: `2px solid ${COLOR.teal}`,
          boxShadow: '0 30px 80px rgba(13, 27, 30, 0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          padding: '0 48px',
          ...useZoomFade(2),
        }}
      >
        <Search size={64} strokeWidth={1.8} color={COLOR.teal} />
        <div style={{ fontFamily: ROBOTO, fontWeight: 300, fontSize: SIZE, lineHeight: `${String(LINE)}px`, color: COLOR.ink, whiteSpace: 'nowrap' }}>
          Search by <Roller />
        </div>
      </div>
      {VO.lines.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`audio/filesystem-vo/${line.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
