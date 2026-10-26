// Resume state per file fingerprint: IndexedDB first, localStorage as fallback. Browser storage
// can be missing or throw (private mode, quota), so every access is wrapped and failures only
// cost the ability to resume, never the upload itself.
import type { CompletedPart } from '../api/types';
import { safeLocalStorage } from '../browser-storage';

/** What survives a reload for one file: the server upload and the parts already in S3. */
export interface ResumeState {
  uploadId: string;
  clipId: string;
  /** Part size in bytes that the server chose for this upload. */
  partSizeBytes: number;
  /** Finished parts with their ETags, needed again for `complete`. */
  doneParts: CompletedPart[];
}

/** Keyed store of `ResumeState`; keys are file fingerprints. Never rejects. */
export interface ResumeStore {
  load(key: string): Promise<ResumeState | null>;
  save(key: string, state: ResumeState): Promise<void>;
  remove(key: string): Promise<void>;
}

const LOCAL_PREFIX = 'nimbytes.upload.';
const DB_NAME = 'nimbytes';
const DB_STORE = 'uploads';

const isPart = (value: unknown): value is CompletedPart =>
  typeof value === 'object' &&
  value !== null &&
  Number.isInteger((value as CompletedPart).n) &&
  typeof (value as CompletedPart).etag === 'string';

/**
 * Validates a stored value, so a corrupt or old entry reads as "nothing to resume".
 * @param value - Whatever storage returned.
 * @returns The state, or null when the shape is wrong.
 */
export function parseResumeState(value: unknown): ResumeState | null {
  if (typeof value !== 'object' || value === null) return null;
  const state = value as Partial<ResumeState>;
  if (typeof state.uploadId !== 'string' || typeof state.clipId !== 'string') return null;
  if (!Number.isInteger(state.partSizeBytes) || (state.partSizeBytes ?? 0) <= 0) return null;
  if (!Array.isArray(state.doneParts) || !state.doneParts.every(isPart)) return null;
  return {
    uploadId: state.uploadId,
    clipId: state.clipId,
    partSizeBytes: state.partSizeBytes ?? 0,
    doneParts: state.doneParts,
  };
}

/**
 * Resume store over `localStorage` (or any `Storage`).
 * @param storage - The storage, or null when the browser denies it.
 * @returns A store; with null storage it remembers nothing.
 */
export function createLocalStorageResumeStore(storage: Storage | null): ResumeStore {
  return {
    load: (key) => {
      try {
        const raw = storage?.getItem(LOCAL_PREFIX + key) ?? null;
        return Promise.resolve(raw === null ? null : parseResumeState(JSON.parse(raw)));
      } catch {
        return Promise.resolve(null); // Recovers: unreadable entry means no resume.
      }
    },
    save: (key, state) => {
      try {
        storage?.setItem(LOCAL_PREFIX + key, JSON.stringify(state));
      } catch {
        // Recovers: quota or private mode; the upload continues without resume.
      }
      return Promise.resolve();
    },
    remove: (key) => {
      try {
        storage?.removeItem(LOCAL_PREFIX + key);
      } catch {
        // Recovers: a stale entry is ignored once its upload is gone on the server.
      }
      return Promise.resolve();
    },
  };
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(DB_STORE);
  };
  return promised(request);
}

/**
 * Resume store over IndexedDB that falls back to `fallback` whenever IndexedDB fails.
 * @param factory - `indexedDB`, or null when unavailable.
 * @param fallback - Store used when IndexedDB is missing or throws.
 * @returns A store that never rejects.
 */
export function createIndexedDbResumeStore(
  factory: IDBFactory | null,
  fallback: ResumeStore,
): ResumeStore {
  let db: Promise<IDBDatabase> | null = null;

  async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) {
    if (factory === null) throw new Error('IndexedDB unavailable');
    db ??= openDb(factory);
    const store = (await db).transaction(DB_STORE, mode).objectStore(DB_STORE);
    return promised(op(store));
  }

  return {
    load: async (key) => {
      try {
        return parseResumeState(await run('readonly', (s) => s.get(key)));
      } catch {
        return fallback.load(key); // Recovers: IndexedDB blocked, read the fallback.
      }
    },
    save: async (key, state) => {
      try {
        await run('readwrite', (s) => s.put(state, key));
      } catch {
        await fallback.save(key, state); // Recovers: IndexedDB blocked, write the fallback.
      }
    },
    remove: async (key) => {
      try {
        await run('readwrite', (s) => s.delete(key));
      } catch {
        // Recovers: nothing to delete when IndexedDB is unavailable.
      }
      await fallback.remove(key);
    },
  };
}

/**
 * Builds the browser's resume store: IndexedDB, with localStorage as fallback.
 * @returns A store that never rejects.
 */
export function createBrowserResumeStore(): ResumeStore {
  let factory: IDBFactory | null = null;
  try {
    factory = globalThis.indexedDB;
  } catch {
    // Recovers: Safari can throw on access in some privacy modes; IndexedDB is then skipped.
  }
  const fallback = createLocalStorageResumeStore(safeLocalStorage());
  return createIndexedDbResumeStore(factory ?? null, fallback);
}
