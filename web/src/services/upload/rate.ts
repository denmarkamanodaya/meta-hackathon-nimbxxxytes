// Transfer speed from progress samples over a sliding window.

/** One progress reading: monotonic time in ms and total bytes at that time. */
export interface RateSample {
  atMs: number;
  bytes: number;
}

/**
 * Average speed over the samples inside the window ending at `nowMs`.
 * @param samples - Readings in time order.
 * @param nowMs - Current monotonic time in ms.
 * @param windowMs - Window length in ms.
 * @returns Bytes per second, or null with fewer than two samples in the window or no elapsed time.
 */
export function bytesPerSecond(
  samples: readonly RateSample[],
  nowMs: number,
  windowMs: number,
): number | null {
  const recent = samples.filter((sample) => nowMs - sample.atMs <= windowMs);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined || last.atMs <= first.atMs) return null;
  return Math.max(0, ((last.bytes - first.bytes) * 1000) / (last.atMs - first.atMs));
}
