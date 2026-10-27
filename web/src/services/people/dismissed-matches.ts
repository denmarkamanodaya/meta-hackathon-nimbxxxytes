// Face-match suggestions the owner answered "Not them" to. Kept in memory for this app session
// only: the server keeps the group, and the suggestion comes back after a reload.

/** A subscribable set of dismissed card keys. */
export interface DismissedMatches {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ReadonlySet<string>;
  dismiss: (key: string) => void;
}

/**
 * Creates an empty store.
 * @returns The store.
 */
export function createDismissedMatches(): DismissedMatches {
  let keys: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => keys,
    dismiss: (key) => {
      if (keys.has(key)) return;
      keys = new Set([...keys, key]);
      for (const listener of listeners) listener();
    },
  };
}
