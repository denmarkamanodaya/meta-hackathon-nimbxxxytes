import { describe, expect, it } from 'vitest';
import { bytesPerSecond } from './rate';

describe('bytesPerSecond', () => {
  it('averages bytes over the elapsed time of samples inside the window', () => {
    const samples = [
      { atMs: 0, bytes: 0 },
      { atMs: 1000, bytes: 1_000_000 },
      { atMs: 2000, bytes: 3_000_000 },
    ];

    expect(bytesPerSecond(samples, 2000, 3000)).toBe(1_500_000);
  });

  it('ignores samples older than the window', () => {
    const samples = [
      { atMs: 0, bytes: 0 },
      { atMs: 5000, bytes: 9_000_000 },
      { atMs: 6000, bytes: 10_000_000 },
    ];

    expect(bytesPerSecond(samples, 6000, 3000)).toBe(1_000_000);
  });

  it('returns null with one sample or no elapsed time', () => {
    expect(bytesPerSecond([{ atMs: 0, bytes: 5 }], 0, 3000)).toBeNull();
    expect(bytesPerSecond([], 0, 3000)).toBeNull();
  });

  it('never reports a negative speed after a retry resets in-flight bytes', () => {
    const samples = [
      { atMs: 0, bytes: 8 },
      { atMs: 1000, bytes: 4 },
    ];

    expect(bytesPerSecond(samples, 1000, 3000)).toBe(0);
  });
});
