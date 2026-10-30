import { describe, expect, it } from 'vitest';
import { currentTurn, litBars, playerTime } from './player';

const turns = [
  { start_ms: 0, end_ms: 24_000 },
  { start_ms: 24_000, end_ms: 37_000 },
  { start_ms: 37_000, end_ms: 50_000 },
];

describe('player', () => {
  it('finds the line playing now, the last one that has started', () => {
    expect(currentTurn(turns, 0)).toBe(0);
    expect(currentTurn(turns, 37_500)).toBe(2);
    expect(currentTurn(turns, 36_999)).toBe(1);
    expect(currentTurn([{ start_ms: 2000, end_ms: 3000 }], 1000)).toBeNull();
    expect(currentTurn([], 1000)).toBeNull();
  });

  it('lights the wave in step with the time, and says where it is', () => {
    expect(litBars(20, 37, 90)).toBe(8);
    expect(litBars(20, 0, 0)).toBe(0);
    expect(litBars(20, 120, 90)).toBe(20);
    expect(playerTime(37, 90)).toBe('0:37 / 1:30');
  });
});
