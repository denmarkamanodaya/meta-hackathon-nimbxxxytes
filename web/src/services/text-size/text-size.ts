// The Mac app's text-size adapter: keeps the size in localStorage (a small UI pref, wrapped:
// storage may throw, then the app opens at 100%) and zooms the whole window through the webview's
// own page zoom, so every px token, gap and pointer position scales together.
import { parseTextSize } from '../../core/text-size';
import type { TextSizeControl } from '../../core/ports/text-size';

const STORAGE_KEY = 'nimbytes.textSize';

/** What the adapter needs. */
export interface WindowTextSizeDeps {
  /** `localStorage`, or null when denied. */
  storage: Storage | null;
  /** Sets the webview's zoom (1 is 100%); a failure only leaves the old zoom. */
  zoom: (scale: number) => Promise<void>;
}

/**
 * Applies the stored size now and returns the control.
 * @param deps - See `WindowTextSizeDeps`.
 * @returns The control.
 */
export function createWindowTextSize(deps: WindowTextSizeDeps): TextSizeControl {
  let current = (() => {
    try {
      return parseTextSize(deps.storage?.getItem(STORAGE_KEY) ?? null);
    } catch {
      return parseTextSize(null); // Recovers: storage blocked; open at 100%.
    }
  })();
  const listeners = new Set<() => void>();
  const apply = () => {
    try {
      deps.zoom(current).catch(() => undefined); // Recovers: the window keeps its old zoom.
    } catch {
      // Recovers: a webview that cannot zoom (it threw before returning) keeps its old zoom.
    }
  };
  apply();
  return {
    get: () => current,
    set: (size) => {
      current = parseTextSize(String(size));
      try {
        deps.storage?.setItem(STORAGE_KEY, String(current));
      } catch {
        // Recovers: the size lasts until the app quits.
      }
      apply();
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
