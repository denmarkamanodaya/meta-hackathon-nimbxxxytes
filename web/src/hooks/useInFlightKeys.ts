// Things the user asked the server to draw (a cover redraw, a footage board) whose run the page
// only sees as "busy". Each key is kept until an answer that was requested after it says nothing
// runs any more, so an answer already on its way when the user clicked cannot clear it early.
// Order comes from one counter, not the clock: two events in the same millisecond still have a
// strict order, so which answer may clear a key never depends on timing.
import { useCallback, useMemo, useRef, useState } from 'react';

/** The keys and how to change them. */
export interface InFlightKeys {
  /** Keys asked for and not settled yet. */
  keys: ReadonlySet<string>;
  /** Marks a key as asked for now. */
  add: (key: string) => void;
  /**
   * Stamps a status request as it goes out; pass the stamp to `settle` with its answer.
   * @returns A number greater than every earlier stamp and every earlier `add`.
   */
  stamp: () => number;
  /**
   * Called with every answer: once one says nothing runs, drops the keys added before it was
   * requested (an `add` with a smaller stamp). A key added after the request went out stays.
   * @param isBusy - The answer says a run is in flight.
   * @param requestedAt - The request's stamp.
   */
  settle: (isBusy: boolean, requestedAt: number) => void;
}

/**
 * Tracks keys of runs in flight.
 * @returns The keys and their actions.
 */
export function useInFlightKeys(): InFlightKeys {
  const [added, setAdded] = useState<ReadonlyMap<string, number>>(new Map());
  const counter = useRef(0);
  const stamp = useCallback(() => {
    counter.current += 1;
    return counter.current;
  }, []);
  const add = useCallback(
    (key: string) => {
      const at = stamp();
      setAdded((prev) => new Map(prev).set(key, at));
    },
    [stamp],
  );
  const settle = useCallback((isBusy: boolean, requestedAt: number) => {
    if (isBusy) return;
    // Strictly before: stamps are unique, so a request never ties with an add.
    setAdded((prev) => {
      const kept = [...prev].filter(([, at]) => at > requestedAt);
      return kept.length === prev.size ? prev : new Map(kept);
    });
  }, []);
  const keys = useMemo(() => new Set(added.keys()), [added]);
  return { keys, add, stamp, settle };
}
