import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatLongDate,
  formatClipTime,
  formatDuration,
  formatRate,
  formatShortDate,
  formatUsd,
  percentOf,
} from './format';

describe('formatBytes', () => {
  it('uses decimal units with one decimal below 100', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(12_400_000)).toBe('12.4 MB');
    expect(formatBytes(950_000)).toBe('950 KB');
    expect(formatBytes(1_234_000_000)).toBe('1.2 GB');
  });
});

describe('formatRate', () => {
  it('appends per second', () => {
    expect(formatRate(2_100_000)).toBe('2.1 MB/s');
  });
});

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss, flooring fractions', () => {
    expect(formatDuration(7.9)).toBe('0:07');
    expect(formatDuration(750)).toBe('12:30');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

describe('percentOf', () => {
  it('floors and clamps, and treats an empty file as done', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 4)).toBe(100);
    expect(percentOf(0, 0)).toBe(100);
  });
});

describe('formatShortDate', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('shows day and month in the given zone, without the current year', () => {
    expect(formatShortDate('2026-10-26T23:30:00Z', now, 'Asia/Manila')).toBe('27 Oct');
    expect(formatShortDate('2026-10-26T23:30:00Z', now, 'UTC')).toBe('26 Oct');
  });

  it('adds the year for another year, and is empty for a bad value', () => {
    expect(formatShortDate('2025-03-02T10:00:00Z', now, 'UTC')).toBe('2 Mar 2025');
    expect(formatShortDate('yesterday', now, 'UTC')).toBe('');
  });
});

describe('formatLongDate', () => {
  it('always shows the year, in the given zone, and is empty for a bad value', () => {
    expect(formatLongDate('2026-10-27T23:30:00Z', 'Asia/Manila')).toBe('28 Oct 2026');
    expect(formatLongDate('2026-10-27T23:30:00Z', 'UTC')).toBe('27 Oct 2026');
    expect(formatLongDate('soon', 'UTC')).toBe('');
  });
});

describe('formatUsd', () => {
  it('keeps small costs readable', () => {
    expect(formatUsd(0.0842)).toBe('$0.084');
    expect(formatUsd(0.00312)).toBe('$0.0031');
    expect(formatUsd(1.254)).toBe('$1.25');
    expect(formatUsd(0)).toBe('$0.00');
  });
});

describe('formatClipTime', () => {
  it('shows minutes, seconds and tenths', () => {
    expect(formatClipTime(64)).toBe('1:04.0');
    expect(formatClipTime(3.5)).toBe('0:03.5');
    expect(formatClipTime(59.96)).toBe('1:00.0');
  });
});
