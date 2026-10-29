// Small pieces the promo scenes share: the source note, the frame-from-line helper, a glass card,
// and a fade wrapper that shows its children only inside a frame range.
import type { CSSProperties, ReactNode } from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { useEnter } from '../components/motion';
import { INTER } from '../fonts';
import { NIGHT } from '../theme';
import type { Scene } from '../timeline';

/** What every scene gets: its place on the timeline. */
export interface SceneProps {
  scene: Scene;
}

/**
 * A scene line's start, in frames from the scene's start.
 * @param scene - The scene.
 * @param index - Which line.
 * @returns The frame (0 when the line is missing).
 */
export const at = (scene: Scene, index: number): number => (scene.lines[index]?.from ?? scene.from) - scene.from;

/** The source note, top right, small and quiet. */
export function Source({ children }: { children: string }) {
  const enter = useEnter(10);
  return (
    <div style={{ position: 'absolute', right: 64, top: 40, maxWidth: 760, textAlign: 'right', fontFamily: INTER, fontSize: 20, lineHeight: 1.4, color: NIGHT.textSoft, opacity: 0.85 * enter }}>
      {children}
    </div>
  );
}

/** A frosted glass card. */
export function Glass({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: CSSProperties }) {
  const enter = useEnter(delay);
  return (
    <div
      style={{
        background: NIGHT.glass,
        border: `1px solid ${NIGHT.glassBorder}`,
        borderRadius: 24,
        padding: 36,
        boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
        opacity: enter,
        transform: `perspective(1200px) translateY(${String((1 - enter) * 60)}px) rotateX(${String((1 - enter) * 35)}deg)`,
        transformOrigin: 'center bottom',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Shows its children from `from` to `to` (scene frames), fading 8 frames at each end. */
export function During({ from, to, children }: { from: number; to?: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [from, from + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const fadeOut = to === undefined ? 1 : interpolate(frame, [to - 10, to], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  if (frame < from || (to !== undefined && frame >= to)) return null;
  // Enter by rising gently into place; leave by lifting softly away, so nothing just pops.
  const t = fadeIn * fadeOut;
  const lift = (1 - fadeIn) * 10 - (1 - fadeOut) * 10;
  return <div style={{ position: 'absolute', inset: 0, opacity: t, transform: `translateY(${String(lift)}px)`}}>{children}</div>;
}

/** The headline's place: top left. */
export const HEAD: CSSProperties = { position: 'absolute', left: 120, top: 110 };
