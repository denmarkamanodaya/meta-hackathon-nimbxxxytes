import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatRate, percentOf } from './format';

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
