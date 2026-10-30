import { beforeEach, describe, expect, it } from 'vitest';
import { createGalleryPrefsStore } from './gallery-prefs';

const blocked = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
} as unknown as Storage;

beforeEach(() => {
  localStorage.clear();
});

describe('createGalleryPrefsStore', () => {
  it('opens as a grid at the middle size', () => {
    expect(createGalleryPrefsStore(localStorage).read()).toEqual({ view: 'grid', size: 3, kind: 'all' });
  });

  it('remembers the list view, size and kind filter across instances', () => {
    createGalleryPrefsStore(localStorage).write({ view: 'list', size: 5, kind: 'recordings' });

    expect(createGalleryPrefsStore(localStorage).read()).toEqual({ view: 'list', size: 5, kind: 'recordings' });
  });

  it('never throws when storage is blocked or missing', () => {
    for (const storage of [blocked, null]) {
      const store = createGalleryPrefsStore(storage);
      expect(store.read()).toEqual({ view: 'grid', size: 3, kind: 'all' });
      expect(() => {
        store.write({ view: 'list', size: 1, kind: 'documents' });
      }).not.toThrow();
    }
  });
});
