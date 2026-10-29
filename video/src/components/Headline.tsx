// The two-tone headline: a white first line and an accent second line, each word rising in on a
// stagger (Outfit 200: thin and clean).
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { DISPLAY } from '../fonts';
import { NIGHT } from '../theme';

function Words({ text, color, delay, size }: { text: string; color: string; delay: number; size: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: size * 0.26 }}>
      {text.split(' ').map((word, index) => {
        const p = spring({ frame: frame - delay - index * 3, fps, durationInFrames: 18, config: { damping: 18, mass: 0.6 } });
        return (
          <span key={`${word}-${String(index)}`} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: size * 0.08 }}>
            <span style={{ display: 'inline-block', color, transform: `translateY(${String((1 - p) * 100)}%) scale(${String(0.92 + 0.08 * p)})`, opacity: p}}>{word}</span>
          </span>
        );
      })}
    </div>
  );
}

export function Headline({
  first,
  second,
  size = 96,
  delay = 0,
  secondDelay,
  align = 'left',
  firstColor = NIGHT.text,
  secondColor = NIGHT.accent,
}: {
  first: string;
  second?: string;
  size?: number;
  delay?: number;
  secondDelay?: number;
  align?: 'left' | 'center';
  firstColor?: string;
  secondColor?: string;
}) {
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontWeight: 200,
        fontSize: size * 0.8,
        lineHeight: 1.08,
        letterSpacing: -size / 70,
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        textAlign: align,
      }}
    >
      <Words text={first} color={firstColor} delay={delay} size={size} />
      {second !== undefined && <Words text={second} color={secondColor} delay={secondDelay ?? delay + first.split(' ').length * 3 + 4} size={size} />}
    </div>
  );
}
