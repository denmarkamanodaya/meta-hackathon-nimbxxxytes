import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { LONG_PRESS_MS, useLongPress, type LongPress } from './useLongPress';

const handle: { press: LongPress | null } = { press: null };

function Probe({ onLongPress }: { onLongPress: () => void }) {
  const press = useLongPress(onLongPress);
  useEffect(() => {
    handle.press = press;
  });
  return null;
}

let view: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const at = (x: number, y: number) => ({ clientX: x, clientY: y });

describe('useLongPress', () => {
  it('fires after holding still, and the next click is swallowed once', async () => {
    const onLongPress = vi.fn();
    view = await mount(<Probe onLongPress={onLongPress} />, fakeServices());

    handle.press?.onPointerDown(at(10, 10));
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(handle.press?.consumeLongPress()).toBe(true);
    expect(handle.press?.consumeLongPress()).toBe(false);
  });

  it('does not fire on a short tap', async () => {
    const onLongPress = vi.fn();
    view = await mount(<Probe onLongPress={onLongPress} />, fakeServices());

    handle.press?.onPointerDown(at(10, 10));
    vi.advanceTimersByTime(LONG_PRESS_MS - 50);
    handle.press?.onPointerUp();
    vi.advanceTimersByTime(1000);

    expect(onLongPress).not.toHaveBeenCalled();
    expect(handle.press?.consumeLongPress()).toBe(false);
  });

  it('cancels when the finger moves (scrolling)', async () => {
    const onLongPress = vi.fn();
    view = await mount(<Probe onLongPress={onLongPress} />, fakeServices());

    handle.press?.onPointerDown(at(10, 10));
    handle.press?.onPointerMove(at(10, 30));
    vi.advanceTimersByTime(1000);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
