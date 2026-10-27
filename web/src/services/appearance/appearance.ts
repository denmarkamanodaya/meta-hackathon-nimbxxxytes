// The Mac app's appearance adapter: keeps the choice in localStorage (a small UI pref, wrapped:
// storage may throw, then the app uses the default, Night), and draws the window by setting
// `data-theme` on <html>, which tokens.css reads. Follows macOS dark mode live while the choice is
// System, and other windows' changes through the `storage` event.
import { DEFAULT_APPEARANCE, parseAppearance, resolveTheme, type Appearance } from '../../core/appearance';
import type { AppearanceControl } from '../../core/ports/appearance';

const STORAGE_KEY = 'nimbytes.appearance';

/** The stored choice. Never throws. */
export interface AppearanceStore {
  read(): Appearance;
  write(appearance: Appearance): void;
}

/**
 * Builds the store over a `Storage`.
 * @param storage - `localStorage`, or null when denied.
 * @returns The store.
 */
export function createAppearanceStore(storage: Storage | null): AppearanceStore {
  return {
    read: () => {
      try {
        return parseAppearance(storage?.getItem(STORAGE_KEY) ?? null);
      } catch {
        return DEFAULT_APPEARANCE; // Recovers: storage blocked; draw the default.
      }
    },
    write: (appearance) => {
      try {
        storage?.setItem(STORAGE_KEY, appearance);
      } catch {
        // Recovers: the choice lasts until the app quits.
      }
    },
  };
}

/** The parts of `MediaQueryList` the adapter uses (`(prefers-color-scheme: dark)`). */
export interface DarkModeQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
}

/** The parts of `window` the adapter listens on for other windows' changes. */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}

/** What the adapter needs. */
export interface DocumentAppearanceDeps {
  store: AppearanceStore;
  /** macOS dark mode, or null when the webview cannot tell (then System means light). */
  darkMode: DarkModeQuery | null;
  /** The element that carries `data-theme` (<html>). */
  root: HTMLElement;
  /** Where `storage` events arrive, or null. */
  events: StorageEvents | null;
}

/**
 * Applies the stored choice now and returns the control.
 * @param deps - See `DocumentAppearanceDeps`.
 * @returns The control.
 */
export function createDocumentAppearance(deps: DocumentAppearanceDeps): AppearanceControl {
  let current = deps.store.read();
  const listeners = new Set<() => void>();
  const apply = () => {
    deps.root.dataset.theme = resolveTheme(current, deps.darkMode?.matches === true);
  };
  const changed = () => {
    apply();
    for (const listener of listeners) listener();
  };
  apply();
  deps.darkMode?.addEventListener('change', () => {
    if (current === 'system') changed();
  });
  deps.events?.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = parseAppearance(event.newValue);
    changed();
  });
  return {
    get: () => current,
    set: (appearance) => {
      current = appearance;
      deps.store.write(appearance);
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
