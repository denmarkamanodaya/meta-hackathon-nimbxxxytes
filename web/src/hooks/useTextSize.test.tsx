import { act, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TextSizeControl } from '../core/ports/text-size';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useTextSize, useTextSizeKeys } from './useTextSize';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const handle: { set: ((size: number) => void) | null } = { set: null };

function Probe() {
  const setting = useTextSize();
  useTextSizeKeys();
  useEffect(() => {
    handle.set = setting?.setSize ?? null;
  });
  return <output>{setting === null ? 'none' : String(setting.size)}</output>;
}

/** An in-memory control, as the adapter behaves. */
function fakeControl(initial: number): TextSizeControl {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const press = (init: KeyboardEventInit) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }));
  });
};

describe('useTextSize', () => {
  it('is null in the PWA, and the keys do nothing there', async () => {
    view = await mount(<Probe />, fakeServices());
    press({ key: '=', metaKey: true });
    expect(view.container.textContent).toBe('none');
  });

  it('shows the size and changes it from the setting', async () => {
    view = await mount(<Probe />, fakeServices({ textSize: fakeControl(1) }));
    expect(view.container.textContent).toBe('1');
    act(() => {
      handle.set?.(1.2);
    });
    expect(view.container.textContent).toBe('1.2');
  });

  it('steps with ⌘+ and ⌘−, resets with ⌘0, and ignores plain keys', async () => {
    view = await mount(<Probe />, fakeServices({ textSize: fakeControl(1) }));
    press({ key: '=', metaKey: true });
    press({ key: '+', ctrlKey: true });
    expect(view.container.textContent).toBe('1.2');
    press({ key: '-', metaKey: true });
    expect(view.container.textContent).toBe('1.1');
    press({ key: '=' });
    expect(view.container.textContent).toBe('1.1');
    press({ key: '0', metaKey: true });
    expect(view.container.textContent).toBe('1');
  });
});
