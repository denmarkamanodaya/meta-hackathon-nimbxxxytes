import { describe, expect, it, vi } from 'vitest';
import { createDismissedMatches } from './dismissed-matches';

describe('createDismissedMatches', () => {
  it('adds a key once, gives a new snapshot and notifies; a repeat changes nothing', () => {
    const store = createDismissedMatches();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    store.dismiss('g_leo');
    const after = store.getSnapshot();
    store.dismiss('g_leo');

    expect(before.has('g_leo')).toBe(false);
    expect(after.has('g_leo')).toBe(true);
    expect(store.getSnapshot()).toBe(after);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
