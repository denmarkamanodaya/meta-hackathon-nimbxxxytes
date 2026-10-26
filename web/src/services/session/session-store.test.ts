import { describe, expect, it, vi } from 'vitest';
import { createSessionStore } from './session-store';

describe('createSessionStore', () => {
  it('starts unknown, locks on 401 and unlocks after a session is created', () => {
    const store = createSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getSnapshot()).toBe('unknown');
    store.lock();
    expect(store.getSnapshot()).toBe('locked');
    store.unlock();
    expect(store.getSnapshot()).toBe('active');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when the status does not change', () => {
    const store = createSessionStore();
    store.lock();
    const listener = vi.fn();
    store.subscribe(listener);

    store.lock();

    expect(listener).not.toHaveBeenCalled();
  });
});
