// The background: near-black ink with a slow, blurred teal and warm-amber aurora, plus faint specks.
import type { ReactNode } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { NIGHT } from '../theme';

/** Slow-rising specks of light; positions come from a fixed seed so every render is the same. */
function Particles() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      {Array.from({ length: 34 }, (_, i) => {
        const x = (i * 197) % 1920;
        const speed = 0.4 + ((i * 37) % 10) / 12;
        const y = 1080 - ((frame * speed + i * 131) % 1180);
        const size = 2 + ((i * 13) % 4);
        const glow = 0.15 + ((i * 7) % 10) / 30;
        return <div key={String(i)} style={{ position: 'absolute', left: x + Math.sin((frame + i * 20) / 40) * 14, top: y, width: size, height: size, borderRadius: size, background: NIGHT.accent, opacity: glow, boxShadow: `0 0 ${String(size * 4)}px ${NIGHT.accent}` }} />;
      })}
    </AbsoluteFill>
  );
}

/**
 * The backdrop: near-black ink with two soft, heavily blurred colour fields that drift very slowly:
 * a teal haze from the upper left and a warm red-to-amber glow from the lower right, our brand
 * colours as a smooth aurora gradient. `glowAt` shifts the teal field; nothing moves fast.
 */
export function Backdrop({ children, glowAt = 'top-left' }: { children?: ReactNode; glowAt?: 'top-left' | 'center' | 'top-right'; tint?: string }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const drift = Math.sin(t / 3) * 2;
  const [tx, ty] = glowAt === 'center' ? [30, 40] : glowAt === 'top-right' ? [62, 18] : [10, 32];
  const breathe = interpolate(Math.sin(t / 2.5), [-1, 1], [0.85, 1]);
  return (
    <AbsoluteFill style={{ background: '#0B1013' }}>
      <AbsoluteFill style={{ filter: 'blur(80px)', opacity: breathe }}>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 42% 60% at ${String(tx + drift)}% ${String(ty)}%, rgba(95,195,217,0.55) 0%, rgba(11,110,133,0.35) 38%, transparent 72%)` }} />
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 34% 30% at ${String(tx + 4 - drift)}% ${String(ty + 26)}%, rgba(120,180,150,0.22) 0%, transparent 70%)` }} />
        <AbsoluteFill style={{ background: `linear-gradient(${String(150 + drift)}deg, transparent 52%, rgba(224,106,85,0.0) 58%, rgba(224,106,85,0.55) 74%, rgba(255,190,110,0.7) 92%)` }} />
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 40% 34% at ${String(96 - drift)}% ${String(96)}%, rgba(255,214,140,0.55) 0%, transparent 70%)` }} />
      </AbsoluteFill>
      <Particles />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 70% 70% at 50% 45%, rgba(11,16,19,0.55) 0%, transparent 70%)' }} />
      {children}
    </AbsoluteFill>
  );
}
