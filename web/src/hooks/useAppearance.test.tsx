import { act, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Appearance } from '../core/appearance';
import type { AppearanceControl } from '../core/ports/appearance';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useAppearance } from './useAppearance';

const handle: { set: ((appearance: Appearance) => void) | null } = { set: null };

function Probe() {
  const setting = useAppearance();
  useEffect(() => {
    handle.set = setting?.setAppearance ?? null;
  });
  return <output>{setting === null ? 'none' : setting.appearance}</output>;
}

/** An in-memory control, as the adapter behaves. */
function fakeControl(initial: Appearance): AppearanceControl & { external: (next: Appearance) => void } {
  let current = initial;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: () => current,
    set: (next) => {
      current = next;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    external: (next) => {
      current = next;
      notify();
    },
  };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  handle.set = null;
});

describe('useAppearance', () => {
  it('is null in the PWA, which has no setting', async () => {
    view = await mount(<Probe />, fakeServices());

    expect(view.container.textContent).toBe('none');
  });

  it('shows the current choice and sets a new one', async () => {
    const control = fakeControl('system');
    view = await mount(<Probe />, fakeServices({ appearance: control }));
    expect(view.container.textContent).toBe('system');

    act(() => {
      handle.set?.('dark');
    });

    expect(control.get()).toBe('dark');
    expect(view.container.textContent).toBe('dark');
  });

  it('re-renders when the choice changes elsewhere (another window)', async () => {
    const control = fakeControl('light');
    view = await mount(<Probe />, fakeServices({ appearance: control }));

    act(() => {
      control.external('dark');
    });

    expect(view.container.textContent).toBe('dark');
  });
});
