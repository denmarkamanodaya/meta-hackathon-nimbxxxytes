import { describe, expect, it } from 'vitest';
import {
  createIndexedDbResumeStore,
  createLocalStorageResumeStore,
  parseResumeState,
  type ResumeState,
} from './resume-store';

const state: ResumeState = {
  uploadId: 'u1',
  clipId: 'c1',
  partSizeBytes: 8,
  doneParts: [{ n: 1, etag: '"a"' }],
};

describe('localStorage resume store', () => {
  it('round-trips a state under its fingerprint key', async () => {
    localStorage.clear();
    const store = createLocalStorageResumeStore(localStorage);

    await store.save('a.mp4|42|1', state);

    expect(await store.load('a.mp4|42|1')).toEqual(state);
    expect(await store.load('other')).toBeNull();
  });

  it('forgets the state on remove', async () => {
    localStorage.clear();
    const store = createLocalStorageResumeStore(localStorage);
    await store.save('k', state);

    await store.remove('k');

    expect(await store.load('k')).toBeNull();
  });

  it('never rejects when storage throws', async () => {
    const broken = {
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
    const store = createLocalStorageResumeStore(broken);

    await expect(store.save('k', state)).resolves.toBeUndefined();
    await expect(store.load('k')).resolves.toBeNull();
    await expect(store.remove('k')).resolves.toBeUndefined();
  });

  it('reads a corrupt entry as nothing to resume', async () => {
    localStorage.clear();
    localStorage.setItem('nimbytes.upload.k', '{not json');
    const store = createLocalStorageResumeStore(localStorage);

    expect(await store.load('k')).toBeNull();
  });
});

describe('IndexedDB resume store', () => {
  it('falls back to localStorage when IndexedDB is unavailable', async () => {
    localStorage.clear();
    const fallback = createLocalStorageResumeStore(localStorage);
    const store = createIndexedDbResumeStore(null, fallback);

    await store.save('k', state);

    expect(await fallback.load('k')).toEqual(state);
    expect(await store.load('k')).toEqual(state);
  });
});

describe('parseResumeState', () => {
  it('rejects a state with a part missing its ETag', () => {
    expect(parseResumeState({ ...state, doneParts: [{ n: 1 }] })).toBeNull();
  });

  it('rejects a zero part size', () => {
    expect(parseResumeState({ ...state, partSizeBytes: 0 })).toBeNull();
  });
});
