import { act, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useInFlightKeys, type InFlightKeys } from './useInFlightKeys';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function setup() {
  const seen: { keys: InFlightKeys | null } = { keys: null };
  function Probe() {
    const keys = useInFlightKeys();
    useEffect(() => {
      seen.keys = keys;
    });
    return null;
  }
  view = await mount(<Probe />, fakeServices());
  const run = (fn: (keys: InFlightKeys) => void) => {
    act(() => {
      if (seen.keys !== null) fn(seen.keys);
    });
  };
  return { seen, run };
}

describe('useInFlightKeys', () => {
  it('keeps a key against an answer requested before it, however close in time (no clock ties)', async () => {
    const { seen, run } = await setup();
    let before = 0;

    // All of this happens within one millisecond: only the order counts.
    run((k) => {
      before = k.stamp();
      k.add('tiktok');
    });
    run((k) => {
      k.settle(false, before);
    });

    expect(seen.keys?.keys.has('tiktok')).toBe(true);
  });

  it('drops the key once an answer requested after it says nothing runs, but not while busy', async () => {
    const { seen, run } = await setup();
    let after = 0;

    run((k) => {
      k.add('tiktok');
      after = k.stamp();
    });
    run((k) => {
      k.settle(true, after);
    });
    expect(seen.keys?.keys.has('tiktok')).toBe(true);

    run((k) => {
      k.settle(false, after);
    });
    expect(seen.keys?.keys.has('tiktok')).toBe(false);
  });

  it('stamps strictly increase', async () => {
    const { run } = await setup();
    const stamps: number[] = [];

    run((k) => {
      stamps.push(k.stamp(), k.stamp(), k.stamp());
    });

    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(3);
  });
});
