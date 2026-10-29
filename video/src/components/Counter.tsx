// A big glowing number that counts up.
import { useCurrentFrame } from 'remotion';
import { ARCHIVO } from '../fonts';
import { countUp, riseStyle, useEnter } from './motion';

export function Counter({ from, to, format, size, color, delay = 0, duration = 36 }: { from: number; to: number; format: (v: number) => string; size: number; color: string; delay?: number; duration?: number }) {
  const frame = useCurrentFrame();
  const enter = useEnter(delay);
  const done = frame - (delay + duration);
  const punch = done >= 0 && done < 12 ? 1 + 0.06 * Math.sin((done / 12) * Math.PI) : 1;
  return (
    <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: size, letterSpacing: -size / 28, lineHeight: 0.9, color, textShadow: `0 0 60px ${color}55`, ...riseStyle(enter), transform: `${String(riseStyle(enter).transform)} scale(${String(punch)})`, transformOrigin: 'left center' }}>
      {format(countUp(frame, from, to, delay, duration))}
    </div>
  );
}
