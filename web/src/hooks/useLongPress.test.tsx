import { act, type MouseEvent, type PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { LONG_PRESS_MS, useLongPress, type LongPressHandlers } from './useLongPress';

let view: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const at = (clientX: number, clientY: number) => ({ clientX, clientY }) as unknown as PointerEvent<HTMLElement>;
const mouse = () => {
  const preventDefault = vi.fn();
  return { event: { preventDefault } as unknown as MouseEvent<HTMLElement>, preventDefault };
};

async function mountPress() {
  const onHold = vi.fn();
  const probe: { current: LongPressHandlers | null } = { current: null };
  function Probe() {
    probe.current = useLongPress(onHold);
    return null;
  }
  view = await mount(<Probe />, fakeServices());
  const press = probe.current;
  if (press === null) throw new Error('the hook rendered');
  return { press, onHold };
}

describe('useLongPress', () => {
  it('fires once after the hold time and swallows the click that follows', async () => {
    const { press, onHold } = await mountPress();

    press.onPointerDown(at(10, 10));
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    });
    expect(onHold).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onHold).toHaveBeenCalledTimes(1);

    press.onPointerUp();
    const after = mouse();
    expect(press.swallowClick(after.event)).toBe(true);
    expect(after.preventDefault).toHaveBeenCalled();
    expect(press.swallowClick(mouse().event)).toBe(false);
  });

  it('does not fire on a short tap or when the finger moves (a scroll)', async () => {
    const { press, onHold } = await mountPress();

    press.onPointerDown(at(0, 0));
    press.onPointerUp();
    press.onPointerDown(at(0, 0));
    press.onPointerMove(at(0, 30));
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });

    expect(onHold).not.toHaveBeenCalled();
    expect(press.swallowClick(mouse().event)).toBe(false);
  });

  it('blocks the system menu only during a press, never a plain right-click', async () => {
    const { press } = await mountPress();
    const plain = mouse();
    press.onContextMenu(plain.event);
    expect(plain.preventDefault).not.toHaveBeenCalled();

    press.onPointerDown(at(0, 0));
    const held = mouse();
    press.onContextMenu(held.event);
    expect(held.preventDefault).toHaveBeenCalled();
  });
});
