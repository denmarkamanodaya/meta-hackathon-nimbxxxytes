// "Show someone how to…" with the task rolling up to the next one as the voice names it (the
// promo's uses scene, shared with the iGuide film). Calm roll, no blur.
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { DISPLAY } from '../fonts';
import { NIGHT } from '../theme';
import { riseStyle, useEnter } from './motion';

/** The tasks, each with the word the voice says when it starts. */
export const USES: readonly { cue: string; text: string }[] = [
  { cue: 'laundry', text: 'do the laundry' },
  { cue: 'fix', text: 'fix a leaky tap' },
  { cue: 'video', text: 'make a video call' },
  { cue: 'tv', text: 'use the TV remote' },
  { cue: 'reset', text: 'reset the Wi-Fi' },
];

/**
 * When each task rolls in: 4 frames before the voice says its cue word.
 * @param words - The line's timed words (frames from the start of the scene).
 * @returns One start frame per task.
 */
export function useStarts(words: readonly { text: string; from: number }[]): number[] {
  return USES.map((use) => (words.find((w) => w.text.toLowerCase().replace(/[^a-z]/g, '').startsWith(use.cue))?.from ?? 0) - 4);
}

/** The roll, at the left edge of its parent (positioned by the caller); colours default to the night page. */
export function UsesRoll({ starts, leadColor = NIGHT.text, taskColor = NIGHT.accent }: { starts: readonly number[]; leadColor?: string; taskColor?: string }) {
  const frame = useCurrentFrame();
  const current = starts.reduce((idx, at, i) => (frame >= at ? i : idx), 0);
  const ROW = 96;
  const prev = starts[current] ?? 0;
  const roll = interpolate(frame, [prev, prev + 12], [current - 1, current], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const offset = current === 0 ? 0 : roll;
  // The task comes in with "Show someone how to", not before it.
  const enter = useEnter(4);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, height: ROW }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 200, fontSize: 72, color: leadColor, whiteSpace: 'nowrap', ...riseStyle(enter) }}>Show someone how to</div>
      <div style={{ position: 'relative', height: ROW, overflow: 'hidden', flex: 1, opacity: enter }}>
        {USES.map((use, i) => {
          const y = (i - offset) * ROW;
          const near = 1 - Math.min(1, Math.abs(i - offset));
          return (
            <div key={use.text} style={{ position: 'absolute', top: y + 2, fontFamily: DISPLAY, fontWeight: 300, fontSize: 72, color: taskColor, opacity: near, whiteSpace: 'nowrap' }}>
              {use.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
