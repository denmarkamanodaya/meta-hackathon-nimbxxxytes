import { describe, expect, it } from 'vitest';
import { reorderTarget, shiftFor, swipeDecision } from './useGestures';

describe('reorderTarget', () => {
  const mids = [50, 150, 250, 350];

  it('lands below every other item whose middle the pointer passed', () => {
    expect(reorderTarget(0, 260, mids)).toBe(2);
    expect(reorderTarget(3, 120, mids)).toBe(1);
  });

  it('stays put without passing a neighbour middle', () => {
    expect(reorderTarget(1, 190, mids)).toBe(1);
  });

  it('clamps to the ends', () => {
    expect(reorderTarget(1, -500, mids)).toBe(0);
    expect(reorderTarget(1, 9000, mids)).toBe(3);
  });
});

describe('shiftFor', () => {
  it('moves the items between source and target to open a gap', () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 100))).toEqual([0, -100, -100, 0]);
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 100))).toEqual([0, 100, 100, 0]);
  });

  it('moves nothing when the target is the source', () => {
    expect([0, 1, 2].map((i) => shiftFor(i, 1, 1, 100))).toEqual([0, 0, 0]);
  });
});

describe('swipeDecision', () => {
  it('drops the card past 35 % of its width to the left only', () => {
    expect(swipeDecision(-140, 390)).toBe('dismiss');
    expect(swipeDecision(-130, 390)).toBe('cancel');
    expect(swipeDecision(300, 390)).toBe('cancel');
  });
});
