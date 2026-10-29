// The night background: deep ink with a slow-drifting teal glow, like the Mac app's Night theme.
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

export function Backdrop({ children, glowAt = 'top-left', tint = NIGHT.glow }: { children?: ReactNode; glowAt?: 'top-left' | 'center' | 'top-right'; tint?: string }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 4;
  const [x, y] = glowAt === 'center' ? [50, 45] : glowAt === 'top-right' ? [78, 8] : [18, 6];
  const pulse = interpolate(Math.sin(frame / 60), [-1, 1], [0.55, 0.8]);
  return (
    <AbsoluteFill style={{ background: NIGHT.bgDeep }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 60% at ${String(x + drift)}% ${String(y)}%, ${tint} 0%, transparent 70%)`,
          opacity: pulse,
        }}
      />
      <Particles />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent 55%, ${NIGHT.bgDeep} 100%)` }} />
      {children}
    </AbsoluteFill>
  );
}
