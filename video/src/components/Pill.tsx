// A small rounded label ("AFTER THE HACKATHON", "REC", "Sample bill").
import type { ReactNode } from 'react';
import { INTER } from '../fonts';
import { useEnter } from './motion';

export function Pill({ children, background, color, delay = 0, size = 26 }: { children: ReactNode; background: string; color: string; delay?: number; size?: number }) {
  const enter = useEnter(delay);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background, color, fontFamily: INTER, fontWeight: 400, fontSize: size, letterSpacing: 2, padding: '8px 20px', borderRadius: 999, opacity: enter, transform: `scale(${String(0.7 + 0.3 * enter)})` }}>
      {children}
    </span>
  );
}
