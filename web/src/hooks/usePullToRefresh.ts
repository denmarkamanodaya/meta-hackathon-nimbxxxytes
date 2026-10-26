// Pull-to-refresh for a page scrolled to the top. Touch only; polling already refreshes the
// data every few seconds, so this is a convenience with no single-pointer requirement.
import { useEffect, useRef, useState } from 'react';

/** Pull distance in px that triggers a refresh on release. */
export const PULL_TRIGGER_PX = 64;

/**
 * Maps finger travel to the indicator's pull distance, with rubber-band resistance.
 * @param deltaY - Finger travel down since touch start, in px.
 * @returns Pull distance in px, 0 for upward travel, capped at 1.5 × the trigger.
 */
export function pullDistance(deltaY: number): number {
  if (deltaY <= 0) return 0;
  return Math.min(deltaY * 0.5, PULL_TRIGGER_PX * 1.5);
}

/**
 * Listens for a downward pull while the page is at the top.
 * @param onRefresh - Called once when the user releases past the trigger distance.
 * @returns The current pull distance in px, for the indicator.
 */
export function usePullToRefresh(onRefresh: () => void): number {
  const [distance, setDistance] = useState(0);
  const startY = useRef<number | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const onStart = (event: TouchEvent) => {
      startY.current = window.scrollY <= 0 ? (event.touches[0]?.clientY ?? null) : null;
    };
    const onMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (startY.current === null || y === undefined) return;
      latest.current = pullDistance(y - startY.current);
      setDistance(latest.current);
    };
    const onEnd = () => {
      if (startY.current !== null && latest.current >= PULL_TRIGGER_PX) onRefresh();
      startY.current = null;
      latest.current = 0;
      setDistance(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh]);

  return distance;
}
