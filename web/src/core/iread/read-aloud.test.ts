import { describe, expect, it } from 'vitest';
import { FROM_PART_ZERO, FROM_SUMMARY, nextRead, readItemLine, type ReadItem } from './read-aloud';

/** Walks the sequence from `start` the way the player does, with a text of `parts` parts. */
function walk(start: ReadItem, parts: number): ReadItem[] {
  const played: ReadItem[] = [];
  let item: ReadItem | null = start;
  while (item !== null && played.length < 20) {
    played.push(item);
    // The player learns the part count from the first part that answers.
    item = nextRead(item, item.kind === 'part' ? parts : null);
  }
  return played;
}

describe('nextRead (the parts player sequence)', () => {
  it('Read it to me: the summary, then every part in turn, then stops', () => {
    expect(walk(FROM_SUMMARY, 3)).toEqual([
      { kind: 'summary' },
      { kind: 'part', part: 0 },
      { kind: 'part', part: 1 },
      { kind: 'part', part: 2 },
    ]);
  });

  it('Read the whole letter: from part 0; a one-part letter ends after it', () => {
    expect(walk(FROM_PART_ZERO, 2)).toEqual([
      { kind: 'part', part: 0 },
      { kind: 'part', part: 1 },
    ]);
    expect(walk(FROM_PART_ZERO, 1)).toEqual([{ kind: 'part', part: 0 }]);
  });

  it('never goes past a part without knowing how many there are', () => {
    expect(nextRead({ kind: 'part', part: 0 }, null)).toBeNull();
  });
});

describe('readItemLine', () => {
  it('names the summary and the part', () => {
    expect(readItemLine(FROM_SUMMARY, null)).toBe('Summary');
    expect(readItemLine({ kind: 'part', part: 1 }, 5)).toBe('Part 2 of 5');
    expect(readItemLine(FROM_PART_ZERO, null)).toBe('Part 1');
  });
});
