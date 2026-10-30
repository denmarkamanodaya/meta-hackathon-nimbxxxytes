// The recording player's rules (pure): which line of What was said plays now, how far along the
// wave is lit, and the "0:37 / 1:30" line.
import { formatDuration } from '../format';

/**
 * The line that holds `atMs`: the last line that started at or before it.
 * @param turns - Every line's start, in order.
 * @param atMs - Where the player is.
 * @returns The line's index, or null before the first line or with no lines.
 */
export function currentTurn(turns: readonly { start_ms: number; end_ms: number }[], atMs: number): number | null {
  let found: number | null = null;
  turns.forEach((turn, index) => {
    if (turn.start_ms <= atMs) found = index;
  });
  return found;
}

/**
 * How many of `bars` are lit at a position.
 * @param bars - Wave bars.
 * @param atS - Where the player is.
 * @param lengthS - How long it is.
 * @returns 0 to `bars`.
 */
export const litBars = (bars: number, atS: number, lengthS: number): number =>
  lengthS <= 0 ? 0 : Math.min(bars, Math.max(0, Math.round((atS / lengthS) * bars)));

/**
 * "0:37 / 1:30".
 * @param atS - Where the player is.
 * @param lengthS - How long it is.
 * @returns The line.
 */
export const playerTime = (atS: number, lengthS: number): string => `${formatDuration(atS)} / ${formatDuration(lengthS)}`;
