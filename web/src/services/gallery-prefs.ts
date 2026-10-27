// The Gallery's grid/list choice and thumbnail size, remembered in localStorage (small UI prefs).
// Storage may be missing or throw, so every access is wrapped; failure only means the Gallery
// opens as a grid at the middle size.
import { parseGallerySize, parseGalleryView, type GalleryPrefs } from '../core/gallery';

const VIEW_KEY = 'nimbytes.galleryView';
const SIZE_KEY = 'nimbytes.gallerySize';

/** Reads and remembers the Gallery prefs. Never throws. */
export interface GalleryPrefsStore {
  read: () => GalleryPrefs;
  write: (prefs: GalleryPrefs) => void;
}

/**
 * Builds the store.
 * @param storage - `localStorage`, or null when the browser denies it.
 * @returns The store.
 */
export function createGalleryPrefsStore(storage: Storage | null): GalleryPrefsStore {
  return {
    read: () => {
      try {
        return { view: parseGalleryView(storage?.getItem(VIEW_KEY) ?? null), size: parseGallerySize(storage?.getItem(SIZE_KEY) ?? null) };
      } catch {
        return { view: parseGalleryView(null), size: parseGallerySize(null) }; // Recovers: blocked storage opens the default.
      }
    },
    write: (prefs) => {
      try {
        storage?.setItem(VIEW_KEY, prefs.view);
        storage?.setItem(SIZE_KEY, String(prefs.size));
      } catch {
        // Recovers: private mode or quota; the choice lasts until the window closes.
      }
    },
  };
}
