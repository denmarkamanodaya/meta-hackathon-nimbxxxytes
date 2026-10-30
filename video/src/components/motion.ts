// The calm entrances of the build prompt (§3): springs with no bounce, count-ups and staggers.
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { MOTION } from '../theme';

/**
 * Entrance progress, 0 to 1, starting `delay` frames into the scene. No overshoot.
 * @param delay - Frames before it starts.
 * @returns The progress.
 */
export function useEnter(delay = 0): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, durationInFrames: MOTION.enter, config: { damping: 200 } });
}

/**
 * The style of an item rising into place as it fades in.
 * @param progress - From `useEnter`.
 * @returns Opacity and a small upward slide.
 */
export const riseStyle = (progress: number) => ({ opacity: progress, transform: `translateY(${String((1 - progress) * 24)}px)` });

/**
 * A number counting up, eased out.
 * @param frame - Scene frame.
 * @param from - Start value.
 * @param to - End value.
 * @param delay - Frames before it starts.
 * @param duration - Frames it takes.
 * @returns The value now.
 */
export function countUp(frame: number, from: number, to: number, delay: number, duration: number): number {
  return interpolate(frame, [delay, delay + duration], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - (1 - t) ** 3,
  });
}

/**
 * The white-page entrance: fade in while zooming out from 125% to place, settling with no bounce.
 * @param delay - Frames before it starts.
 * @returns Opacity and a scale transform.
 */
export function useZoomFade(delay: number): { opacity: number; transform: string } {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, durationInFrames: 28, config: { damping: 200 } });
  return { opacity: enter, transform: `scale(${String(1.25 - 0.25 * enter)})` };
}
