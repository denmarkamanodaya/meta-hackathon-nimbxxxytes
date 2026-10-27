import { describe, expect, it } from 'vitest';
import { formatGb } from './storage';

describe('formatGb', () => {
  it('shows one decimal, drops ".0", and 0 GB for nothing', () => {
    expect(formatGb(41_200_000_000)).toBe('41.2 GB');
    expect(formatGb(6_000_000_000)).toBe('6 GB');
    expect(formatGb(0)).toBe('0 GB');
  });
});
