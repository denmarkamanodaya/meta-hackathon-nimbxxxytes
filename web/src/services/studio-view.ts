// Which list the Studio shows (Shorts or Productions), remembered for the browser session in
// sessionStorage. Storage may be missing or throw, so every access is wrapped; failure only means
// the Studio opens on Shorts.

/** The Studio's two lists. */
export type StudioView = 'shorts' | 'productions';

const KEY = 'nimbytes.studioView';

/** Reads and remembers the Studio list. Never throws. */
export interface StudioViewStore {
  read: () => StudioView;
  write: (view: StudioView) => void;
}

/**
 * Builds the store.
 * @param storage - `sessionStorage`, or null when the browser denies it.
 * @returns The store; it reads Shorts until Productions was chosen.
 */
export function createStudioViewStore(storage: Storage | null): StudioViewStore {
  return {
    read: () => {
      try {
        return storage?.getItem(KEY) === 'productions' ? 'productions' : 'shorts';
      } catch {
        return 'shorts'; // Recovers: blocked storage opens on Shorts.
      }
    },
    write: (view) => {
      try {
        storage?.setItem(KEY, view);
      } catch {
        // Recovers: private mode or quota; the choice is just not remembered.
      }
    },
  };
}
