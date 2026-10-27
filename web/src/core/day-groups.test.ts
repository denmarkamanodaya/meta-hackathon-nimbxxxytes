import { describe, expect, it } from 'vitest';
import type { ClipStatus } from '../services/api/types';
import { dayLabel, dayTimeLabel, groupByDay } from './day-groups';

const now = new Date('2026-10-27T10:00:00Z');
const zone = 'UTC';

describe('dayLabel', () => {
  it('says Today, Yesterday, a weekday this week, else a date', () => {
    expect(dayLabel('2026-10-27T07:42:00Z', now, zone)).toBe('Today');
    expect(dayLabel('2026-10-26T23:59:00Z', now, zone)).toBe('Yesterday');
    expect(dayLabel('2026-10-24T12:00:00Z', now, zone)).toBe('Sat');
    expect(dayLabel('2026-10-12T12:00:00Z', now, zone)).toBe('12 Oct');
    expect(dayLabel('2025-10-12T12:00:00Z', now, zone)).toBe('12 Oct 2025');
  });

  it('uses the given zone for the calendar day', () => {
    expect(dayLabel('2026-10-26T20:00:00Z', now, 'Asia/Manila')).toBe('Today');
  });

  it('is empty for a bad value', () => {
    expect(dayLabel('soon', now, zone)).toBe('');
  });
});

describe('dayTimeLabel', () => {
  it('adds the clock time in lower-case am/pm', () => {
    expect(dayTimeLabel('2026-10-27T07:42:00Z', now, zone)).toBe('Today 7:42 am');
    expect(dayTimeLabel('2026-10-26T18:05:00Z', now, zone)).toBe('Yesterday 6:05 pm');
  });
});

describe('groupByDay', () => {
  const clip = (id: string, recorded_at: string | null, duration_s: number | null, status: ClipStatus = 'ready') => ({
    id,
    recorded_at,
    duration_s,
    status,
  });

  it('groups newest day first with clip count and rounded minutes', () => {
    const groups = groupByDay(
      [
        clip('a', '2026-10-26T08:00:00Z', 57),
        clip('b', '2026-10-27T07:00:00Z', 42),
        clip('c', '2026-10-27T08:00:00Z', 318),
        clip('d', null, null),
      ],
      now,
      zone,
    );

    expect(groups.map((g) => [g.label, g.items.map((i) => i.id), g.minutes])).toEqual([
      ['Today', ['b', 'c'], 6],
      ['Yesterday', ['a'], 1],
      ['Recently added', ['d'], 0],
    ]);
    expect(groups.map((g) => g.count)).toEqual([2, 1, 1]);
  });

  it('shows a duplicate in its day but leaves it out of the count and the minutes', () => {
    const [today] = groupByDay(
      [clip('orig', '2026-10-27T07:00:00Z', 120), clip('copy', '2026-10-27T07:00:00Z', 120, 'duplicate')],
      now,
      zone,
    );

    expect(today?.items.map((i) => i.id)).toEqual(['orig', 'copy']);
    expect([today?.count, today?.minutes]).toEqual([1, 2]);
  });
});
