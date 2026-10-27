import { act, type MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useMenu, type MenuControl } from './useMenu';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function mountMenu() {
  const probe: { current: MenuControl | null } = { current: null };
  function Probe() {
    probe.current = useMenu();
    return null;
  }
  view = await mount(<Probe />, fakeServices());
  return probe;
}

const fakeEvent = (over: Partial<MouseEvent<HTMLElement>>) =>
  ({ preventDefault: vi.fn(), clientX: 0, clientY: 0, ...over }) as unknown as MouseEvent<HTMLElement>;

describe('useMenu', () => {
  it('opens under the clicked button, from its box', async () => {
    const probe = await mountMenu();
    const button = document.createElement('button');
    button.getBoundingClientRect = () => ({ left: 330, top: 16, right: 374, bottom: 60, width: 44, height: 44, x: 330, y: 16, toJSON: () => ({}) });

    act(() => {
      probe.current?.openFromButton(fakeEvent({ currentTarget: button }));
    });

    expect(probe.current?.anchor).toEqual({ kind: 'button', box: { left: 330, top: 16, right: 374, bottom: 60 } });
  });

  it('opens at the pointer on right-click instead of the browser menu, and closes', async () => {
    const probe = await mountMenu();
    const preventDefault = vi.fn();
    const event = fakeEvent({ clientX: 120, clientY: 340, preventDefault });

    act(() => {
      probe.current?.openAtPointer(event);
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(probe.current?.anchor).toEqual({ kind: 'point', point: { x: 120, y: 340 } });

    act(() => {
      probe.current?.close();
    });
    expect(probe.current?.anchor).toBeNull();
  });
});
