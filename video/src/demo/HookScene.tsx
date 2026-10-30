// Demo scene 2 (2.5 s): the hook. "Think of your loved ones / slowly forgetting" and a phrase that
// spins fast through everyday tasks ("how to tie a shoe", "how to cook", ...), slows down and lands
// on the one that hurts most: "you."
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { riseStyle, useEnter } from '../components/motion';
import { ROBOTO } from '../fonts';
import { COLOR } from '../theme';

/** What the phrase spins through, "how to" included; it lands on the last, in red. */
export const TASKS = [
  'how to tie a shoe',
  'how to use the remote',
  'how to make coffee',
  'how to button a shirt',
  'how to brush teeth',
  'how to lock the door',
  'how to take pills',
  'how to boil an egg',
  'how to set the table',
  'how to fold laundry',
  'how to water plants',
  'how to make the bed',
  'how to use the phone',
  'how to wash the dishes',
  'how to set an alarm',
  'how to make tea',
  'how to cook',
  'you.',
] as const;

const SIZE = 88;
const LINE = Math.round(SIZE * 1.2);
/** The spin: starts at full speed, eases out and lands. */
const SPIN = { from: 8, to: 54 } as const;

/** The spinning phrase: a column of tasks behind a one-line window, blurred while it moves fast. */
function Spinner() {
  const frame = useCurrentFrame();
  const last = TASKS.length - 1;
  const ease = (t: number) => 1 - (1 - t) ** 4;
  const range = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease } as const;
  const position = interpolate(frame, [SPIN.from, SPIN.to], [0, last], range);
  const speed = position - interpolate(frame - 1, [SPIN.from, SPIN.to], [0, last], range);
  const enter = useEnter(SPIN.from - 6);
  return (
    <span style={{ display: 'inline-block', height: LINE, overflow: 'hidden', verticalAlign: 'top', opacity: enter }}>
      <span style={{ display: 'block', transform: `translateY(${String(-position * LINE)}px)`, filter: `blur(${String(Math.min(speed * 5, 5))}px)` }}>
        {TASKS.map((task, index) => (
          <span key={task} style={{ display: 'block', height: LINE, whiteSpace: 'nowrap', color: index === last ? COLOR.red : COLOR.teal, fontWeight: 500 }}>
            {task}
          </span>
        ))}
      </span>
    </span>
  );
}

export function HookScene() {
  const text = { fontFamily: ROBOTO, fontWeight: 300, fontSize: SIZE, lineHeight: `${String(LINE)}px`, color: COLOR.ink } as const;
  return (
    <AbsoluteFill style={{ background: COLOR.white, justifyContent: 'center', paddingLeft: 128 }}>
      <div style={{ ...text, ...riseStyle(useEnter(2)) }}>Think of your loved ones</div>
      <div style={{ ...text, whiteSpace: 'nowrap', ...riseStyle(useEnter(4)) }}>
        slowly forgetting <Spinner />
      </div>
    </AbsoluteFill>
  );
}
