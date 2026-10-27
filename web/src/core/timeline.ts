// Pure rules for the clip player: where a tap seeks to, and which row is playing now.

/** Anything with a half-open time span `[start_s, end_s)` in clip seconds. */
export interface Span {
  start_s: number;
  end_s: number;
}

/**
 * Clamps a seek target into the playable range.
 * @param seconds - Requested time in clip seconds.
 * @param durationS - Media duration in seconds; NaN or Infinity before metadata loads.
 * @returns A time in `[0, duration]`, or `max(0, seconds)` when the duration is unknown.
 */
export function clampSeek(seconds: number, durationS: number): number {
  const start = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return Number.isFinite(durationS) && durationS > 0 ? Math.min(start, durationS) : start;
}

/**
 * Finds the span playing at `seconds`. Spans are sorted by start; when spans overlap the
 * latest-starting one wins, and a gap returns -1.
 * @param spans - Spans sorted by `start_s`.
 * @param seconds - Current playback time.
 * @returns The index of the active span, or -1.
 */
export function activeIndex(spans: readonly Span[], seconds: number): number {
  let low = 0;
  let high = spans.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const span = spans[mid];
    if (span === undefined) break;
    if (span.start_s <= seconds) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const span = found === -1 ? undefined : spans[found];
  return span !== undefined && seconds < span.end_s ? found : -1;
}

/**
 * Where each moment starts on the scrubber.
 * @param spans - Moments (segments) with `start_s`.
 * @param durationS - Clip duration in seconds; NaN or 0 before metadata loads.
 * @returns One position per moment, 0–100 (percent of the track); empty without a duration.
 */
export function markerPercents(spans: readonly Pick<Span, 'start_s'>[], durationS: number): number[] {
  if (!Number.isFinite(durationS) || durationS <= 0) return [];
  return spans.map((span) => Math.min(100, Math.max(0, (span.start_s / durationS) * 100)));
}

/**
 * The second a tap on the scrubber points at.
 * @param x - Pointer x relative to the track's left edge, px.
 * @param width - Track width, px.
 * @param durationS - Clip duration in seconds.
 * @returns Seconds, clamped to the clip; 0 without a duration or width.
 */
export function scrubSeconds(x: number, width: number, durationS: number): number {
  if (width <= 0 || !Number.isFinite(durationS) || durationS <= 0) return 0;
  return Math.min(durationS, Math.max(0, (x / width) * durationS));
}
