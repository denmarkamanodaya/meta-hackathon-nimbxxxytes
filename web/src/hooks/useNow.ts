// The current instant, refreshed on an interval: for countdowns and "2 min ago" lines.
import { useEffect, useState } from 'react';

/**
 * The current instant, updated every `intervalMs`.
 * @param intervalMs - How often to refresh.
 * @returns The latest instant.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
