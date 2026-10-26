// Safe access to localStorage: Safari can throw on the property read itself in some privacy
// modes, so callers get null instead of an exception.

/**
 * Returns `localStorage`, or null when the browser denies it.
 * @returns The storage or null.
 */
export function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null; // Recovers: features that use storage degrade to "nothing remembered".
  }
}
