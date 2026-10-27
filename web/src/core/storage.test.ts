import { describe, expect, it } from 'vitest';
import { ApiError } from '../services/api/client';
import { describeError } from './error-text';
import { capView, formatGb, STORAGE_FULL_TEXT } from './storage';

describe('formatGb', () => {
  it('shows one decimal, drops ".0", and 0 GB for nothing', () => {
    expect(formatGb(41_200_000_000)).toBe('41.2 GB');
    expect(formatGb(6_000_000_000)).toBe('6 GB');
    expect(formatGb(0)).toBe('0 GB');
  });
});

describe('capView', () => {
  const cap = 250_000_000_000;

  it('reads "X of 250 GB" with no notice while there is room', () => {
    expect(capView({ used_bytes: 44_236_288_000, cap_bytes: cap, level: 'ok' })).toEqual({
      line: '44.2 GB of 250 GB',
      ofCap: 'of 250 GB',
      percent: 17,
      tone: 'ok',
      notice: null,
      isFull: false,
    });
  });

  it('warns at the warn and high levels the API sends, with the percentage and what to do', () => {
    const warn = capView({ used_bytes: 205_000_000_000, cap_bytes: cap, level: 'warn' });
    const high = capView({ used_bytes: 240_000_000_000, cap_bytes: cap, level: 'high' });

    expect(warn).toMatchObject({ tone: 'warning', isFull: false });
    expect(warn.notice).toBe('Storage is 82% full: 205 GB of 250 GB. Delete duplicates or old clips to make room.');
    expect(high).toMatchObject({ tone: 'warning', percent: 96, isFull: false });
  });

  it('follows the level, not its own sum: full blocks uploads even below 100 %', () => {
    const full = capView({ used_bytes: 249_990_000_000, cap_bytes: cap, level: 'full' });

    expect(full).toMatchObject({ tone: 'danger', isFull: true, notice: STORAGE_FULL_TEXT });
    expect(capView({ used_bytes: cap, cap_bytes: cap, level: 'high' }).isFull).toBe(false);
  });

  it('gives STORAGE_FULL refusals the same sentence in a toast', () => {
    expect(describeError(Object.assign(new Error('full'), { code: 'STORAGE_FULL' })).text).toBe(STORAGE_FULL_TEXT);
    expect(describeError(new ApiError('BAD_RESPONSE', 'x', 507)).text).not.toBe(STORAGE_FULL_TEXT);
  });
});
