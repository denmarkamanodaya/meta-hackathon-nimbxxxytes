import { describe, expect, it } from 'vitest';
import { createRecentQueryStore } from './recent-store';

describe('createRecentQueryStore', () => {
  it('records queries newest first and reads them back', () => {
    localStorage.clear();
    const store = createRecentQueryStore(localStorage);

    store.record('beach');
    store.record('latte');

    expect(store.read()).toEqual(['latte', 'beach']);
  });

  it('clears the list', () => {
    localStorage.clear();
    const store = createRecentQueryStore(localStorage);
    store.record('beach');

    store.clear();

    expect(store.read()).toEqual([]);
  });

  it('reads a corrupt or foreign value as empty', () => {
    localStorage.setItem('nimbytes.recentQueries', '{"not":"a list"}');

    expect(createRecentQueryStore(localStorage).read()).toEqual([]);
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    const store = createRecentQueryStore(blocked);

    expect(store.read()).toEqual([]);
    expect(store.record('x')).toEqual(['x']);
    expect(() => {
      store.clear();
    }).not.toThrow();
  });
});
