import { describe, expect, it } from 'vitest';
import { createListenPrefsStore } from './listen-prefs';

const memory = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: () => null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

describe('listen prefs', () => {
  it('starts in English and remembers the pick', () => {
    const store = createListenPrefsStore(memory());
    expect(store.readTarget()).toBe('en');

    store.writeTarget('ja');

    expect(store.readTarget()).toBe('ja');
  });

  it('reads an unknown code, no storage or a throwing storage as English', () => {
    const storage = memory();
    storage.setItem('nimbytes.listenTarget', 'xx');
    expect(createListenPrefsStore(storage).readTarget()).toBe('en');
    expect(createListenPrefsStore(null).readTarget()).toBe('en');
    const throwing = memory();
    throwing.getItem = () => {
      throw new Error('denied');
    };
    throwing.setItem = () => {
      throw new Error('denied');
    };
    const store = createListenPrefsStore(throwing);
    store.writeTarget('zh');
    expect(store.readTarget()).toBe('en');
  });
});
