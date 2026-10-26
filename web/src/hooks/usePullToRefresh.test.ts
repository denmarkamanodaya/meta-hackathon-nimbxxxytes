import { describe, expect, it } from 'vitest';
import { PULL_TRIGGER_PX, pullDistance } from './usePullToRefresh';

describe('pullDistance', () => {
  it('moves at half the finger speed', () => {
    expect(pullDistance(40)).toBe(20);
  });

  it('ignores upward travel and caps the stretch', () => {
    expect(pullDistance(-30)).toBe(0);
    expect(pullDistance(1000)).toBe(PULL_TRIGGER_PX * 1.5);
  });

  it('needs twice the trigger distance of finger travel to refresh', () => {
    expect(pullDistance(PULL_TRIGGER_PX * 2 - 1)).toBeLessThan(PULL_TRIGGER_PX);
    expect(pullDistance(PULL_TRIGGER_PX * 2)).toBe(PULL_TRIGGER_PX);
  });
});
