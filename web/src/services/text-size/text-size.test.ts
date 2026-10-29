import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWindowTextSize } from './text-size';

beforeEach(() => {
  localStorage.clear();
});

describe('createWindowTextSize', () => {
  it('opens at 100% and zooms the window to it', () => {
    const zoom = vi.fn(() => Promise.resolve());
    const control = createWindowTextSize({ storage: localStorage, zoom });

    expect(control.get()).toBe(1);
    expect(zoom).toHaveBeenCalledWith(1);
  });

  it('stores a change, zooms to it, tells listeners and keeps it for the next launch', () => {
    const zoom = vi.fn(() => Promise.resolve());
    const control = createWindowTextSize({ storage: localStorage, zoom });
    const listener = vi.fn();
    control.subscribe(listener);

    control.set(1.2);

    expect(zoom).toHaveBeenLastCalledWith(1.2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createWindowTextSize({ storage: localStorage, zoom }).get()).toBe(1.2);
  });

  it('turns a size that is not a step into 100%', () => {
    const control = createWindowTextSize({ storage: localStorage, zoom: () => Promise.resolve() });
    control.set(3);
    expect(control.get()).toBe(1);
  });

  it('survives blocked storage and a failed zoom', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    const control = createWindowTextSize({ storage: blocked, zoom: () => Promise.reject(new Error('denied')) });

    control.set(1.1);
    expect(control.get()).toBe(1.1);
  });
});
