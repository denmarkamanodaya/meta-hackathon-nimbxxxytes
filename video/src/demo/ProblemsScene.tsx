// Demo scene 1 (timed to its two voice lines): the deck's dementia slide on a white page. 57M counts up, the 2021 and 2050
// bars grow to 139M, nine people pop in with one in red (1 in 9 aged 65+), "No cure yet." lands
// under them, and the source fades in; then it holds to be read.
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { countUp, riseStyle, useEnter } from '../components/motion';
import { ROBOTO } from '../fonts';
import { COLOR } from '../theme';
import { lineOf, type DemoSceneProps } from './timeline';

/** Text colours on white: deck ink (dark, not black) and its soft tint. */
const INK = COLOR.ink;
const SOFT = COLOR.inkSoft;

/** A bar growing from the floor with no bounce, starting `delay` frames in. */
function useGrow(delay: number, duration = 40): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, durationInFrames: duration, config: { damping: 200 } });
}

function Statement({ children, delay, color = INK, weight = 400 }: { children: string; delay: number; color?: string; weight?: number }) {
  return <div style={{ fontFamily: ROBOTO, fontWeight: weight, fontSize: 64, lineHeight: 1.15, color, marginTop: 16, ...riseStyle(useEnter(delay)) }}>{children}</div>;
}

/** One growing bar with its value over it and its year under it. */
function Bar({ height, color, label, value, delay, strong = false }: { height: number; color: string; label: string; value: string; delay: number; strong?: boolean }) {
  const grow = useGrow(delay);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ fontFamily: ROBOTO, fontWeight: 500, fontSize: 48, color, opacity: grow }}>{value}</div>
      <div style={{ width: 200, height: height * grow, borderRadius: '12px 12px 2px 2px', background: color }} />
      <div style={{ fontFamily: ROBOTO, fontWeight: strong ? 500 : 300, fontSize: 28, color: strong ? INK : SOFT, opacity: grow }}>{label}</div>
    </div>
  );
}

/** One person: a round head over a rounded body, popping in from `delay`. */
function Person({ color, delay }: { color: string; delay: number }) {
  const pop = useGrow(delay, 14);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: pop, transform: `scale(${String(0.4 + 0.6 * pop)})`, transformOrigin: 'center bottom' }}>
      <div style={{ width: 17, height: 17, borderRadius: '50%', background: color }} />
      <div style={{ width: 26, height: 30, borderRadius: '13px 13px 6px 6px', background: color }} />
    </div>
  );
}

/** 1 in 9 people aged 65+: nine people, the first in red, then the line under them. */
function OneInNine({ delay }: { delay: number }) {
  return (
    <div style={{ marginTop: 44 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        {Array.from({ length: 9 }, (_, index) => (
          <Person key={index} color={index === 0 ? COLOR.red : COLOR.cardBorder} delay={delay + (index === 0 ? 10 : index * 2)} />
        ))}
      </div>
      <div style={{ fontFamily: ROBOTO, fontWeight: 500, fontSize: 32, color: INK, marginTop: 12, ...riseStyle(useEnter(delay + 14)) }}>
        <span style={{ color: COLOR.red }}>1 in 9</span> people aged 65+
      </div>
    </div>
  );
}

export function ProblemsScene({ scene }: DemoSceneProps) {
  const frame = useCurrentFrame();
  // Timed to the voice: the people row on "1 in 9" (about half way through line 1), "No cure yet." on line 2.
  const first = lineOf(scene, 0);
  const peopleAt = first.from + Math.round(first.durationInFrames * 0.5) - 4;
  const noCureAt = lineOf(scene, 1).from;
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      <div style={{ position: 'absolute', left: 128, right: 128, top: 0, bottom: 150, display: 'flex', alignItems: 'center', gap: 120 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: ROBOTO, fontWeight: 300, fontSize: 300, lineHeight: 0.95, letterSpacing: -8, color: COLOR.teal, fontVariantNumeric: 'tabular-nums', ...riseStyle(useEnter(2)) }}>
            {`${String(Math.round(countUp(frame, 0, 57, 2, 32)))}M`}
          </div>
          <Statement delay={12}>people living with dementia.</Statement>
          <OneInNine delay={peopleAt} />
          <div style={{ marginTop: 28 }}>
            <Statement delay={noCureAt} color={COLOR.red} weight={500}>No cure yet.</Statement>
          </div>
        </div>
        {/* Fixed height, so the bars' floor never moves while they grow: they rise from it. */}
        <div style={{ width: 680, height: 640, display: 'flex', gap: 56, alignItems: 'flex-end', justifyContent: 'center' }}>
          <Bar height={205} color={COLOR.tealPale} label="2021" value="57M" delay={12} />
          <Bar height={500} color={COLOR.red} label="2050" value="139M" delay={22} strong />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 128, bottom: 64, width: 1664, fontFamily: ROBOTO, fontWeight: 300, fontSize: 24, color: SOFT, lineHeight: 1.4, opacity: useEnter(noCureAt + 10) }}>
        Sources: WHO Dementia fact sheet (Oct 2026); Alzheimer’s Disease International (139M by 2050); Alzheimer’s Association, 2026 Facts and Figures (1 in 9 Americans aged 65+ has Alzheimer’s).
      </div>
    </AbsoluteFill>
  );
}
