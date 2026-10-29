// What iRead reads aloud, in turn (pure). "Read it to me" plays the summary first, then the whole
// letter part by part; "Read the whole letter" starts at part 0. Each part is fetched only when it
// is next (`POST /documents/{id}/speak`), so the sequence knows only how many parts there are once
// the first one answered.

/** One thing to read: the summary, or one part (0-based) of the full text. */
export type ReadItem = { kind: 'summary' } | { kind: 'part'; part: number };

/** Where "Read it to me" starts. */
export const FROM_SUMMARY: ReadItem = { kind: 'summary' };

/** Where "Read the whole letter" starts. */
export const FROM_PART_ZERO: ReadItem = { kind: 'part', part: 0 };

/**
 * What to read after `item`.
 * @param item - What just ended.
 * @param parts - How many parts the text has; null before a part answered.
 * @returns The next item, or null when the letter is read to the end.
 */
export function nextRead(item: ReadItem, parts: number | null): ReadItem | null {
  if (item.kind === 'summary') return FROM_PART_ZERO;
  const next = item.part + 1;
  return parts !== null && next < parts ? { kind: 'part', part: next } : null;
}

/**
 * Where a part sits, for the player line ("Part 2 of 5").
 * @param item - What plays.
 * @param parts - How many parts; null when unknown.
 * @returns The line ("Summary" for the summary).
 */
export function readItemLine(item: ReadItem, parts: number | null): string {
  if (item.kind === 'summary') return 'Summary';
  return parts === null ? `Part ${String(item.part + 1)}` : `Part ${String(item.part + 1)} of ${String(parts)}`;
}
