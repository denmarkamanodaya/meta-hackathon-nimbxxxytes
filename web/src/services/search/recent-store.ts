// Recent search queries in localStorage. Storage may be missing or throw (private mode,
// quota), so every access is wrapped; failure only means no recents are shown.
import { addRecentQuery } from '../../core/recent-queries';
import { isStringArray } from '../api/json-guards';

const KEY = 'nimbytes.recentQueries';

/** Reads and records recent queries. Never throws. */
export interface RecentQueryStore {
  read: () => string[];
  /** Records a query and returns the new list. */
  record: (query: string) => string[];
  clear: () => void;
}

/**
 * Builds the store over a `Storage`.
 * @param storage - `localStorage`, or null when the browser denies it.
 * @returns The store.
 */
export function createRecentQueryStore(storage: Storage | null): RecentQueryStore {
  const read = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
      return isStringArray(parsed) ? parsed : [];
    } catch {
      return []; // Recovers: unreadable storage shows no recents.
    }
  };
  return {
    read,
    record: (query) => {
      const next = addRecentQuery(read(), query);
      try {
        storage?.setItem(KEY, JSON.stringify(next));
      } catch {
        // Recovers: quota or private mode; recents just are not remembered.
      }
      return next;
    },
    clear: () => {
      try {
        storage?.removeItem(KEY);
      } catch {
        // Recovers: nothing to clear when storage is blocked.
      }
    },
  };
}
