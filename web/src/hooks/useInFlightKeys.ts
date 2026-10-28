// Things the user asked the server to draw (a cover redraw, a footage board) whose run the page
// only sees as "busy". Each key is kept until an answer that was requested after it says nothing
// runs any more, so an answer already on its way when the user clicked cannot clear it early.
import { useCallback, useMemo, useState } from 'react';

/** The keys and how to change them. */
export interface InFlightKeys {
  /** Keys asked for and not settled yet. */
  keys: ReadonlySet<string>;
  /** Marks a key as asked for now. */
  add: (key: string) => void;
  /**
   * Called with every answer: once one says nothing runs, drops the keys added before it was
   * requested.
   * @param isBusy - The answer says a run is in flight.
   * @param requestedAt - When that answer was requested, ms.
   */
  settle: (isBusy: boolean, requestedAt: number) => void;
}

/**
 * Tracks keys of runs in flight.
 * @param clock - Time in ms; tests pass a fake.
 * @returns The keys and their actions.
 */
export function useInFlightKeys(clock: () => number = Date.now): InFlightKeys {
  const [added, setAdded] = useState<ReadonlyMap<string, number>>(new Map());
  const add = useCallback(
    (key: string) => {
      const at = clock();
      setAdded((prev) => new Map(prev).set(key, at));
    },
    [clock],
  );
  const settle = useCallback((isBusy: boolean, requestedAt: number) => {
    if (isBusy) return;
    setAdded((prev) => {
      const kept = [...prev].filter(([, at]) => at > requestedAt);
      return kept.length === prev.size ? prev : new Map(kept);
    });
  }, []);
  const keys = useMemo(() => new Set(added.keys()), [added]);
  return { keys, add, settle };
}
