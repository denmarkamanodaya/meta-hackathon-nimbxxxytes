// Keeps the screen awake while uploads run (Screen Wake Lock API). The browser drops the lock
// whenever the page is hidden, so it is requested again when the page becomes visible.

/** Turns the screen wake lock on or off. */
export interface WakeLockKeeper {
  /** True while uploads need the screen on. */
  setActive(active: boolean): void;
  /** Releases the lock and stops listening for visibility changes. */
  dispose(): void;
}

/**
 * Builds the keeper over the browser API.
 * @param wakeLock - `navigator.wakeLock`, or undefined where unsupported (then a no-op).
 * @param doc - The document, for `visibilityState` and `visibilitychange`.
 * @returns The keeper.
 */
export function createWakeLockKeeper(
  wakeLock: WakeLock | undefined,
  doc: Document,
): WakeLockKeeper {
  let active = false;
  let sentinel: WakeLockSentinel | null = null;
  let requesting = false;
  // Read through a function: `active` can flip while a request is awaited.
  const isActive = () => active;

  async function acquire() {
    if (wakeLock === undefined || requesting || sentinel !== null) return;
    if (!active || doc.visibilityState !== 'visible') return;
    requesting = true;
    try {
      const lock = await wakeLock.request('screen');
      lock.addEventListener('release', () => {
        if (sentinel === lock) sentinel = null;
      });
      sentinel = lock;
      if (!isActive()) await release();
    } catch {
      // Recovers: denied (battery saver, not visible); the notice still asks to keep the screen on.
    } finally {
      requesting = false;
    }
  }

  async function release() {
    const lock = sentinel;
    sentinel = null;
    try {
      await lock?.release();
    } catch {
      // Recovers: already released by the browser.
    }
  }

  const onVisibility = () => {
    void acquire();
  };
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    setActive: (next) => {
      active = next;
      void (next ? acquire() : release());
    },
    dispose: () => {
      active = false;
      doc.removeEventListener('visibilitychange', onVisibility);
      void release();
    },
  };
}
