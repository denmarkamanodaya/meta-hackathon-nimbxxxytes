import { describe, expect, it } from 'vitest';
import { activeIndex, clampSeek } from './timeline';

describe('clampSeek', () => {
  it('keeps a time inside the media', () => {
    expect(clampSeek(12.5, 60)).toBe(12.5);
    expect(clampSeek(75, 60)).toBe(60);
    expect(clampSeek(-3, 60)).toBe(0);
  });

  it('only floors at zero while the duration is unknown', () => {
    expect(clampSeek(42, Number.NaN)).toBe(42);
    expect(clampSeek(42, Number.POSITIVE_INFINITY)).toBe(42);
  });
});

describe('activeIndex', () => {
  const spans = [
    { start_s: 0, end_s: 7.5 },
    { start_s: 7.5, end_s: 15 },
    { start_s: 20, end_s: 28 },
  ];

  it('finds the span containing the time, with end exclusive', () => {
    expect(activeIndex(spans, 0)).toBe(0);
    expect(activeIndex(spans, 7.49)).toBe(0);
    expect(activeIndex(spans, 7.5)).toBe(1);
    expect(activeIndex(spans, 27.9)).toBe(2);
  });

  it('returns -1 in a gap, before the first and after the last span', () => {
    expect(activeIndex(spans, 17)).toBe(-1);
    expect(activeIndex(spans, 28)).toBe(-1);
    expect(activeIndex([{ start_s: 5, end_s: 6 }], 1)).toBe(-1);
    expect(activeIndex([], 1)).toBe(-1);
  });

  it('prefers the later span where two overlap', () => {
    expect(activeIndex([{ start_s: 0, end_s: 10 }, { start_s: 5, end_s: 8 }], 6)).toBe(1);
  });
});
