// iListen's output language, remembered in localStorage (a small UI pref). Storage may be missing
// or throw, so every access is wrapped; failure only means summaries start in English.
import { DEFAULT_TARGET, isOutputLanguage } from '../core/ilisten/languages';

const TARGET_KEY = 'nimbytes.listenTarget';

/** Reads and remembers the output language. Never throws. */
export interface ListenPrefsStore {
  /** The saved language code, or English when none (or an unknown one) is saved. */
  readTarget: () => string;
  writeTarget: (target: string) => void;
}

/**
 * Builds the store.
 * @param storage - `localStorage`, or null when the browser denies it.
 * @returns The store.
 */
export function createListenPrefsStore(storage: Storage | null): ListenPrefsStore {
  return {
    readTarget: () => {
      try {
        const saved = storage?.getItem(TARGET_KEY) ?? null;
        return saved !== null && isOutputLanguage(saved) ? saved : DEFAULT_TARGET;
      } catch {
        return DEFAULT_TARGET; // Recovers: blocked storage starts in English.
      }
    },
    writeTarget: (target) => {
      try {
        storage?.setItem(TARGET_KEY, target);
      } catch {
        // Recovers: private mode or quota; the choice lasts until the window closes.
      }
    },
  };
}
