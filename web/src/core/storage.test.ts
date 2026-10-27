import { describe, expect, it } from 'vitest';
import { formatGb, formatGbRounded, tierSplit } from './storage';

describe('formatGb', () => {
  it('shows one decimal, drops ".0", and 0 GB for nothing', () => {
    expect(formatGb(41_200_000_000)).toBe('41.2 GB');
    expect(formatGb(6_000_000_000)).toBe('6 GB');
    expect(formatGb(0)).toBe('0 GB');
  });
});

describe('formatGbRounded', () => {
  it('rounds to whole GB, MB under 1 GB', () => {
    expect(formatGbRounded(6_442_450_944)).toBe('6 GB');
    expect(formatGbRounded(420_000_000)).toBe('420 MB');
    expect(formatGbRounded(0)).toBe('0 GB');
  });
});

describe('tierSplit', () => {
  it('splits proportionally and keeps a small tier visible', () => {
    expect(tierSplit(6, 35)).toEqual({ frequent: 15, resting: 85 });
    expect(tierSplit(1, 999)).toEqual({ frequent: 2, resting: 100 });
    expect(tierSplit(0, 10)).toEqual({ frequent: 0, resting: 100 });
    expect(tierSplit(0, 0)).toEqual({ frequent: 0, resting: 0 });
  });
});
